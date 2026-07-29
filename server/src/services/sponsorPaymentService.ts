import crypto from "crypto";
import { Prisma, type SponsorOrder } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../prisma";
import { queryPage, querySize } from "../utils/query";
import { Errors } from "../utils/response";
import {
  amountCentsToMoney,
  buildEpayCallbackUrls,
  buildEpaySubmitPayload,
  getEnabledEpayTypes,
  getEpayMerchantCredentials,
  moneyToAmountCents,
  resolvePaymentOrigin,
  verifyEpayMerchantParams,
  type EpayPayType,
} from "./epay";
import { acquireEpayConfigLock } from "./epayConfigLockService";
import { isFeatureOn } from "./siteSettings";
import {
  calcSponsorOrderExpiresAt,
  closeExpiredSponsorOrderIfNeeded,
  closeExpiredSponsorOrders,
  formatSponsorOrder,
  formatSponsorWallOrder,
  getSponsorConfig,
  isSponsorOrderExpired,
  sponsorConfigToCents,
} from "./sponsor";
import { acquireSponsorOrderLock } from "./sponsorOrderLockService";

const PAY_TYPES = [
  "alipay",
  "wxpay",
  "qqpay",
  "bank",
  "jdpay",
] as const;
const SPONSOR_STATUSES = ["pending", "paid", "closed"] as const;

export type SponsorPaymentActor = {
  userId: number;
};

export const sponsorCreateSchema = z.object({
  amount: z.union([z.string(), z.number()]),
  payType: z.enum(PAY_TYPES),
  message: z.string().trim().max(80).optional(),
  displayMode: z.enum(["public", "anonymous", "hidden"]).optional(),
}).strict();

export const sponsorOrderListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100_000).optional(),
  size: z.coerce.number().int().min(5).max(50).optional(),
  status: z.enum(SPONSOR_STATUSES).optional(),
}).strict();

export const sponsorOrderParamsSchema = z.object({
  outTradeNo: z.string().trim().min(1).max(100),
}).strict();

export type SponsorCreateInput = z.infer<typeof sponsorCreateSchema>;
export type SponsorOrderListQuery = z.infer<
  typeof sponsorOrderListQuerySchema
>;

export class SponsorPaymentNotificationRejected extends Error {}

function nextSponsorTradeNo(userId: number) {
  const random = crypto.randomBytes(6).toString("hex").toUpperCase();
  return `SP${Date.now()}U${userId}${random}`;
}

function callbackUrls() {
  const callbacks = buildEpayCallbackUrls(resolvePaymentOrigin());
  if (!callbacks.notifyUrl || !callbacks.returnUrl) {
    throw Errors.badRequest("请先在后台基础配置中设置网站域名");
  }
  return callbacks;
}

function paymentInput(
  order: {
    outTradeNo: string;
    amountCents: number;
    payType: string;
    userId: number;
  },
  clientIp: string,
) {
  return {
    outTradeNo: order.outTradeNo,
    name: "赞助靠浦",
    money: amountCentsToMoney(order.amountCents),
    type: order.payType,
    ...callbackUrls(),
    clientIp,
    device: "pc",
    param: `sponsor:${order.userId}`,
  };
}

function mapPaymentBuildError(error: unknown): never {
  if (error instanceof Error) {
    throw Errors.badRequest(error.message);
  }
  throw error;
}

export async function getSponsorPaymentOptions() {
  const config = await getSponsorConfig();
  const payTypes = await getEnabledEpayTypes();
  return {
    enabled: isFeatureOn("sponsor") && payTypes.length > 0,
    payTypes,
    amounts: config.presetAmounts,
    minAmount: config.minAmount,
    maxAmount: config.maxAmount,
    title: config.title,
    description: config.description,
    wallEnabled: config.wallEnabled,
    allowMessage: config.allowMessage,
  };
}

export async function createSponsorOrder(
  actor: SponsorPaymentActor,
  input: SponsorCreateInput,
  clientIp: string,
) {
  if (!isFeatureOn("sponsor")) {
    throw Errors.badRequest("赞助功能当前已关闭");
  }
  const config = await getSponsorConfig();
  const { minAmountCents, maxAmountCents } = sponsorConfigToCents(config);
  let amountCents: number;
  try {
    amountCents = moneyToAmountCents(input.amount);
  } catch (error) {
    mapPaymentBuildError(error);
  }
  if (amountCents < minAmountCents || amountCents > maxAmountCents) {
    throw Errors.badRequest(
      `赞助金额需在 ${amountCentsToMoney(minAmountCents)} - ${amountCentsToMoney(maxAmountCents)} 元之间`,
    );
  }
  const enabledTypes = await getEnabledEpayTypes();
  if (!enabledTypes.includes(input.payType as EpayPayType)) {
    throw Errors.badRequest("该支付方式暂不可用");
  }

  const outTradeNo = nextSponsorTradeNo(actor.userId);
  try {
    return await prisma.$transaction(async (tx) => {
      await acquireEpayConfigLock(tx);
      const draft = {
        userId: actor.userId,
        outTradeNo,
        payType: input.payType,
        amountCents,
      };
      const epay = await buildEpaySubmitPayload(
        paymentInput(draft, clientIp),
        tx,
      );
      const order = await tx.sponsorOrder.create({
        data: {
          ...draft,
          message: config.allowMessage ? (input.message ?? "") : "",
          displayMode: input.displayMode ?? "public",
          expiresAt: calcSponsorOrderExpiresAt(),
        },
      });
      return {
        order: formatSponsorOrder(order),
        epay,
      };
    });
  } catch (error) {
    mapPaymentBuildError(error);
  }
}

export async function listSponsorOrders(
  actor: SponsorPaymentActor,
  query: SponsorOrderListQuery,
) {
  await closeExpiredSponsorOrders();
  const page = queryPage(query.page);
  const size = querySize(query.size, 20, 5, 50);
  const where: Prisma.SponsorOrderWhereInput = {
    userId: actor.userId,
  };
  if (query.status) where.status = query.status;
  const [list, total] = await Promise.all([
    prisma.sponsorOrder.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * size,
      take: size,
    }),
    prisma.sponsorOrder.count({ where }),
  ]);
  return {
    page,
    size,
    total,
    list: list.map(formatSponsorOrder),
  };
}

export async function getSponsorOrder(
  actor: SponsorPaymentActor,
  outTradeNo: string,
) {
  const current = await prisma.sponsorOrder.findFirst({
    where: { outTradeNo, userId: actor.userId },
  });
  if (!current) throw Errors.notFound("订单不存在");
  const order = await closeExpiredSponsorOrderIfNeeded(current);
  if (!order) throw Errors.notFound("订单不存在");
  return formatSponsorOrder(order);
}

export async function retrySponsorPayment(
  actor: SponsorPaymentActor,
  outTradeNo: string,
  clientIp: string,
) {
  try {
    const result = await prisma.$transaction(async (tx) => {
      await acquireEpayConfigLock(tx);
      const reference = await tx.sponsorOrder.findUnique({
        where: { outTradeNo },
        select: { id: true },
      });
      if (!reference) throw Errors.notFound("订单不存在");
      await acquireSponsorOrderLock(tx, reference.id);
      let order = await tx.sponsorOrder.findUnique({
        where: { id: reference.id },
      });
      if (!order || order.userId !== actor.userId) {
        throw Errors.notFound("订单不存在");
      }
      if (isSponsorOrderExpired(order)) {
        order = await tx.sponsorOrder.update({
          where: { id: order.id },
          data: {
            status: "closed",
            closedAt: new Date(),
          },
        });
        return { closed: true as const };
      }
      if (order.status !== "pending") {
        if (order.status === "closed") {
          throw Errors.badRequest("订单已超时关闭，请重新发起赞助");
        }
        throw Errors.badRequest("该订单不可继续支付");
      }
      const epay = await buildEpaySubmitPayload(
        paymentInput(order, clientIp),
        tx,
      );
      return {
        closed: false as const,
        value: {
          order: formatSponsorOrder(order),
          epay,
        },
      };
    });
    if (result.closed) {
      throw Errors.badRequest("订单已超时关闭，请重新发起赞助");
    }
    return result.value;
  } catch (error) {
    if (
      typeof error === "object"
      && error !== null
      && "status" in error
    ) {
      throw error;
    }
    mapPaymentBuildError(error);
  }
}

export async function closeSponsorOrder(
  actor: SponsorPaymentActor,
  outTradeNo: string,
) {
  return prisma.$transaction(async (tx) => {
    const reference = await tx.sponsorOrder.findUnique({
      where: { outTradeNo },
      select: { id: true },
    });
    if (!reference) throw Errors.notFound("订单不存在");
    await acquireSponsorOrderLock(tx, reference.id);
    let order = await tx.sponsorOrder.findUnique({
      where: { id: reference.id },
    });
    if (!order || order.userId !== actor.userId) {
      throw Errors.notFound("订单不存在");
    }
    if (isSponsorOrderExpired(order)) {
      order = await tx.sponsorOrder.update({
        where: { id: order.id },
        data: {
          status: "closed",
          closedAt: new Date(),
        },
      });
      return formatSponsorOrder(order);
    }
    if (order.status !== "pending") {
      throw Errors.badRequest("只有待支付订单可以关闭");
    }
    const updated = await tx.sponsorOrder.update({
      where: { id: order.id },
      data: {
        status: "closed",
        closedAt: new Date(),
      },
    });
    return formatSponsorOrder(updated);
  });
}

export async function getSponsorWall() {
  const config = await getSponsorConfig();
  if (!config.wallEnabled) {
    return { enabled: false, total: 0, totalAmount: "0.00", list: [] };
  }
  const where: Prisma.SponsorOrderWhereInput = {
    status: "paid",
    displayMode: { not: "hidden" },
  };
  const [list, totalAmount] = await Promise.all([
    prisma.sponsorOrder.findMany({
      where,
      orderBy: [{ paidAt: "desc" }, { id: "desc" }],
      take: 30,
      include: {
        user: {
          select: {
            id: true,
            nickname: true,
            avatar: true,
          },
        },
      },
    }),
    prisma.sponsorOrder.aggregate({
      where: { status: "paid" },
      _sum: { amountCents: true },
      _count: true,
    }),
  ]);
  return {
    enabled: true,
    total: totalAmount._count,
    totalAmount: amountCentsToMoney(totalAmount._sum.amountCents ?? 0),
    list: list.map(formatSponsorWallOrder),
  };
}

export function normalizeSponsorPaymentParams(
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

async function notifySponsorPaid(order: SponsorOrder) {
  await prisma.notification.create({
    data: {
      userId: order.userId,
      category: "system",
      level: "normal",
      title: "赞助已到账",
      content: `感谢赞助 ¥${amountCentsToMoney(order.amountCents)}，你的支持已经记录在个人资料中。`,
      link: "/profile",
      source: "赞助",
      payload: JSON.stringify({
        type: "sponsor-paid",
        outTradeNo: order.outTradeNo,
        amount: amountCentsToMoney(order.amountCents),
      }),
    },
  }).catch(() => null);
  const admins = await prisma.user.findMany({
    where: { role: "admin" },
    select: { id: true },
  });
  if (!admins.length) return;
  await prisma.notification.createMany({
    data: admins.map((admin) => ({
      userId: admin.id,
      category: "system",
      level: "weak",
      title: "收到一笔赞助",
      content: `订单 ${order.outTradeNo} 已支付 ¥${amountCentsToMoney(order.amountCents)}。`,
      link: "/admin",
      source: "赞助",
      payload: JSON.stringify({
        type: "sponsor-admin",
        outTradeNo: order.outTradeNo,
      }),
    })),
  }).catch(() => null);
}

export async function handleSponsorPaymentNotification(
  params: Record<string, string>,
) {
  const outTradeNo = params.out_trade_no || "";
  const existing = outTradeNo
    ? await prisma.sponsorOrder.findUnique({
      where: { outTradeNo },
      select: { id: true },
    })
    : null;
  const credentials = await getEpayMerchantCredentials();
  const signOk = verifyEpayMerchantParams(params, credentials);
  const log = await prisma.sponsorPaymentLog.create({
    data: {
      orderId: existing?.id ?? null,
      outTradeNo: outTradeNo || null,
      rawPayload: JSON.stringify(params),
      signOk,
      result: signOk ? "received" : "bad-sign",
    },
  });
  if (!signOk) {
    return { status: 400, body: "fail" };
  }
  if (params.trade_status !== "TRADE_SUCCESS") {
    await prisma.sponsorPaymentLog.update({
      where: { id: log.id },
      data: { handled: true, result: "ignored-status" },
    });
    return { status: 200, body: "success" };
  }

  try {
    if (!outTradeNo) {
      throw new SponsorPaymentNotificationRejected("订单号不存在");
    }
    let paidCents: number;
    try {
      paidCents = moneyToAmountCents(params.money || "");
    } catch {
      throw new SponsorPaymentNotificationRejected("支付金额不正确");
    }
    const result = await prisma.$transaction(async (tx) => {
      const reference = await tx.sponsorOrder.findUnique({
        where: { outTradeNo },
        select: { id: true },
      });
      if (!reference) {
        throw new SponsorPaymentNotificationRejected("订单不存在");
      }
      await acquireSponsorOrderLock(tx, reference.id);
      const order = await tx.sponsorOrder.findUnique({
        where: { id: reference.id },
      });
      if (!order) {
        throw new SponsorPaymentNotificationRejected("订单不存在");
      }
      if (order.amountCents !== paidCents) {
        throw new SponsorPaymentNotificationRejected(
          "支付金额与订单不一致",
        );
      }
      if (order.status === "paid") {
        return { order, newlyPaid: false };
      }
      if (!["pending", "closed"].includes(order.status)) {
        throw new SponsorPaymentNotificationRejected(
          "订单状态不可支付",
        );
      }
      const paidOrder = await tx.sponsorOrder.update({
        where: { id: order.id },
        data: {
          status: "paid",
          tradeNo: params.trade_no || null,
          paidAt: new Date(),
          closedAt: null,
        },
      });
      await tx.user.update({
        where: { id: order.userId },
        data: {
          sponsorTotalCents: { increment: order.amountCents },
        },
      });
      return { order: paidOrder, newlyPaid: true };
    });
    if (result.newlyPaid) await notifySponsorPaid(result.order);
    await prisma.sponsorPaymentLog.update({
      where: { id: log.id },
      data: {
        handled: true,
        result: "success",
        orderId: result.order.id,
      },
    });
    return { status: 200, body: "success" };
  } catch (error) {
    await prisma.sponsorPaymentLog.update({
      where: { id: log.id },
      data: {
        handled: false,
        result: error instanceof Error ? error.message : "error",
      },
    }).catch(() => null);
    throw error;
  }
}

export async function sponsorPaymentReturnTarget(
  params: Record<string, string>,
) {
  const credentials = await getEpayMerchantCredentials();
  const status = (
    verifyEpayMerchantParams(params, credentials)
    && params.trade_status === "TRADE_SUCCESS"
  )
    ? "success"
    : "pending";
  const outTradeNo = encodeURIComponent(params.out_trade_no || "");
  return `/profile?sponsor=${status}${outTradeNo ? `&outTradeNo=${outTradeNo}` : ""}`;
}
