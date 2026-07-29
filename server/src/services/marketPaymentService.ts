import { z } from "zod";
import { prisma } from "../prisma";
import { Errors } from "../utils/response";
import {
  amountCentsToMoney,
  buildEpaySubmitPayload,
  getEnabledEpayTypes,
  getEpayMerchantCredentials,
  moneyToAmountCents,
  verifyEpayMerchantParams,
  verifyEpayParams,
  type EpayPayType,
} from "./epay";
import { closeExpiredMarketOrders } from "./marketCatalogService";
import { acquireMarketItemLock } from "./marketItemLockService";
import { notifyMarketUser } from "./marketNotificationService";
import { acquireMarketOrderLock } from "./marketOrderLockService";
import { serializeMarketOrder } from "./marketOrderService";
import {
  MARKET_PAYMENT_DISABLED_MESSAGE,
  STUDENT_MARKET_PAYMENT_ENABLED,
} from "./marketPolicy";
import { getSiteOrigin } from "./siteSettings";

const MARKET_PAY_TYPES = [
  "alipay",
  "wxpay",
  "qqpay",
  "bank",
  "jdpay",
] as const;

const IDEMPOTENT_PAID_ORDER_STATUSES = [
  "paid",
  "delivering",
  "completed",
  "refund_pending",
  "refunded",
  "disputed",
  "no_show",
];

export const marketPaySchema = z.object({
  payType: z.enum(MARKET_PAY_TYPES),
}).strict();

export type MarketPaymentActor = {
  userId: number;
  role: string;
};

export type MarketPayInput = z.infer<typeof marketPaySchema>;

export class MarketPaymentNotificationRejected extends Error {}

export function normalizeMarketPaymentParams(
  input: Record<string, unknown>,
) {
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (Array.isArray(value)) {
      params[key] = String(value[0] ?? "");
    } else if (value !== undefined && value !== null) {
      params[key] = String(value);
    }
  }
  return params;
}

export function marketPaymentReturnStatus(
  params: Record<string, string>,
  merchantKey: string,
) {
  return (
    merchantKey
    && verifyEpayParams(params, merchantKey)
    && params.trade_status === "TRADE_SUCCESS"
  ) ? "success" : "pending";
}

function requireMarketPaymentEnabled() {
  if (!STUDENT_MARKET_PAYMENT_ENABLED) {
    throw Errors.forbidden(MARKET_PAYMENT_DISABLED_MESSAGE);
  }
}

export async function createMarketPayment(
  actor: MarketPaymentActor,
  orderId: number,
  input: MarketPayInput,
  clientIp: string,
) {
  requireMarketPaymentEnabled();
  await closeExpiredMarketOrders();
  const enabled = await getEnabledEpayTypes();
  if (!enabled.includes(input.payType as EpayPayType)) {
    throw Errors.badRequest("该支付方式暂不可用");
  }
  const origin = getSiteOrigin();
  if (!origin) throw Errors.badRequest("请先在后台配置站点域名");

  const order = await prisma.$transaction(async (tx) => {
    await acquireMarketOrderLock(tx, orderId);
    const current = await tx.marketOrder.findUnique({
      where: { id: orderId },
      include: { item: true },
    });
    if (!current || current.buyerId !== actor.userId) {
      throw Errors.notFound("订单不存在");
    }
    if (current.status !== "pending_payment") {
      throw Errors.badRequest("该订单当前不可支付");
    }
    if (current.expiresAt && current.expiresAt <= new Date()) {
      throw Errors.badRequest("订单已超时关闭");
    }
    const updated = await tx.marketOrder.update({
      where: { id: orderId },
      data: { payType: input.payType },
    });
    return {
      ...updated,
      item: current.item,
    };
  });

  const epay = await buildEpaySubmitPayload({
    outTradeNo: order.outTradeNo,
    name: `靠浦校园市集 - ${order.item.title}`.slice(0, 120),
    money: amountCentsToMoney(order.amountCents),
    type: input.payType,
    notifyUrl: `${origin}/api/market/payments/notify`,
    returnUrl: `${origin}/api/market/payments/return`,
    clientIp,
    device: "pc",
    param: `market:${order.id}`,
  });
  return {
    order: serializeMarketOrder(order, actor.userId, actor.role),
    epay,
  };
}

async function notifyPaidOrder(order: any) {
  const item = await prisma.marketItem.findUnique({
    where: { id: order.itemId },
    select: { title: true },
  });
  await Promise.all([
    notifyMarketUser(
      order.buyerId,
      "商城订单支付成功",
      order.deliveryType === "digital"
        ? `「${item?.title || "商品"}」已进入我的资料库`
        : `「${item?.title || "商品"}」已支付，请与卖家确认交付安排`,
      order.deliveryType === "digital"
        ? "/market/learning-materials/library"
        : "/market/mine?tab=orders",
      {
        type: "market-paid",
        orderId: order.id,
      },
    ),
    notifyMarketUser(
      order.sellerId,
      "买家已完成支付",
      order.deliveryType === "digital"
        ? `「${item?.title || "商品"}」已自动完成线上发货，等待买家确认`
        : `「${item?.title || "商品"}」已收到平台支付，请安排交付`,
      "/market/seller?tab=orders",
      {
        type: "market-paid-seller",
        orderId: order.id,
      },
    ),
  ]);
}

export async function handleMarketPaymentNotification(
  params: Record<string, string>,
) {
  requireMarketPaymentEnabled();
  const outTradeNo = params.out_trade_no || "";
  const existing = outTradeNo
    ? await prisma.marketOrder.findUnique({
      where: { outTradeNo },
      select: { id: true },
    })
    : null;
  const credentials = await getEpayMerchantCredentials();
  const signOk = verifyEpayMerchantParams(params, credentials);
  const log = await prisma.marketPaymentLog.create({
    data: {
      orderId: existing?.id || null,
      outTradeNo: outTradeNo || null,
      rawPayload: JSON.stringify(params),
      signOk,
      result: signOk ? "received" : "bad-sign",
    },
  });

  if (!signOk) {
    return {
      status: 400,
      body: "fail",
    };
  }
  if (params.trade_status !== "TRADE_SUCCESS") {
    await prisma.marketPaymentLog.update({
      where: { id: log.id },
      data: {
        handled: true,
        result: "ignored-status",
      },
    });
    return {
      status: 200,
      body: "success",
    };
  }

  try {
    if (!outTradeNo) {
      throw new MarketPaymentNotificationRejected("订单号不存在");
    }
    if (!/^\d+(?:\.\d{1,2})?$/.test(params.money || "")) {
      throw new MarketPaymentNotificationRejected("支付金额格式不正确");
    }
    let paidCents: number;
    try {
      paidCents = moneyToAmountCents(params.money);
    } catch {
      throw new MarketPaymentNotificationRejected("支付金额不正确");
    }
    const result = await prisma.$transaction(async (tx) => {
      const reference = await tx.marketOrder.findUnique({
        where: { outTradeNo },
        select: { id: true },
      });
      if (!reference) {
        throw new MarketPaymentNotificationRejected("订单不存在");
      }
      await acquireMarketOrderLock(tx, reference.id);
      const order = await tx.marketOrder.findUnique({
        where: { id: reference.id },
      });
      if (!order) {
        throw new MarketPaymentNotificationRejected("订单不存在");
      }
      if (IDEMPOTENT_PAID_ORDER_STATUSES.includes(order.status)) {
        return {
          order,
          newlyPaid: false,
        };
      }
      if (order.status !== "pending_payment") {
        throw new MarketPaymentNotificationRejected("订单状态不可支付");
      }
      if (order.amountCents !== paidCents) {
        throw new MarketPaymentNotificationRejected("支付金额与订单不一致");
      }

      const isDigital = order.deliveryType === "digital";
      if (!isDigital) await acquireMarketItemLock(tx, order.itemId);
      const paidOrder = await tx.marketOrder.update({
        where: { id: order.id },
        data: {
          status: isDigital ? "delivering" : "paid",
          tradeNo: params.trade_no || null,
          paidAt: new Date(),
          digitalDeliveredAt: isDigital ? new Date() : null,
          sellerConfirmedAt: isDigital ? new Date() : null,
        },
      });
      if (!isDigital) {
        await tx.marketItem.updateMany({
          where: {
            id: order.itemId,
            status: { not: "hidden" },
          },
          data: { status: "reserved" },
        });
      } else {
        const profile = await tx.learningMaterialProfile.findUnique({
          where: { itemId: order.itemId },
        });
        if (profile?.activeVersionId) {
          await tx.learningMaterialAccess.upsert({
            where: { orderId: order.id },
            create: {
              orderId: order.id,
              versionId: profile.activeVersionId,
              userId: order.buyerId,
            },
            update: {
              versionId: profile.activeVersionId,
              userId: order.buyerId,
              revokedAt: null,
            },
          });
        }
      }
      return {
        order: paidOrder,
        newlyPaid: true,
      };
    });

    if (result.newlyPaid) await notifyPaidOrder(result.order);
    await prisma.marketPaymentLog.update({
      where: { id: log.id },
      data: {
        handled: true,
        result: "success",
        orderId: result.order.id,
      },
    });
    return {
      status: 200,
      body: "success",
    };
  } catch (error: any) {
    await prisma.marketPaymentLog.update({
      where: { id: log.id },
      data: {
        handled: false,
        result: String(error?.message || "error"),
      },
    }).catch(() => null);
    throw error;
  }
}

export async function marketPaymentReturnTarget(
  params: Record<string, string>,
) {
  if (!STUDENT_MARKET_PAYMENT_ENABLED) {
    return "/market/mine?tab=orders&payment=disabled";
  }
  const credentials = await getEpayMerchantCredentials();
  const status = params.pid === credentials.pid
    ? marketPaymentReturnStatus(params, credentials.merchantKey)
    : "pending";
  const outTradeNo = encodeURIComponent(params.out_trade_no || "");
  return `/market/mine?tab=orders&payment=${status}${outTradeNo ? `&outTradeNo=${outTradeNo}` : ""}`;
}
