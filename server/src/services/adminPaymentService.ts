import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../prisma";
import { queryPage, querySize } from "../utils/query";
import { Errors } from "../utils/response";
import {
  amountCentsToMoney,
  buildEpayCallbackUrls,
  buildEpaySubmitPayload,
  getEpayConfig,
  moneyToAmountCents,
  resolvePaymentOrigin,
  updateEpayConfig,
} from "./epay";
import { logMarketAdminAction } from "./marketTrust";
import {
  closeExpiredSponsorOrders,
  formatSponsorOrder,
  getSponsorConfig,
  updateSponsorConfig,
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
const DISPLAY_MODES = ["public", "anonymous", "hidden"] as const;
const MAX_SPONSOR_AMOUNT_CENTS = 99_999_900;

export type AdminPaymentActor = {
  userId: number;
  role: string;
  ip?: string;
};

function requireAdmin(actor: AdminPaymentActor) {
  if (actor.role !== "admin") {
    throw Errors.forbidden("仅超级管理员可操作");
  }
}

const moneyInputSchema = z.union([z.string(), z.number()]).superRefine(
  (value, context) => {
    try {
      const cents = moneyToAmountCents(value);
      if (cents > MAX_SPONSOR_AMOUNT_CENTS) {
        context.addIssue({
          code: "custom",
          message: "金额超出允许范围",
        });
      }
    } catch {
      context.addIssue({
        code: "custom",
        message: "金额必须是最多两位小数的正数",
      });
    }
  },
);

export const adminEpayConfigPatchSchema = z.object({
  enabled: z.boolean().optional(),
  gatewayUrl: z.string().trim().max(240).optional(),
  pid: z.string().trim().max(80).optional(),
  merchantKey: z.string().trim().min(1).max(240).optional(),
  clearMerchantKey: z.boolean().optional(),
  signType: z.literal("MD5").optional(),
  defaultType: z.enum(PAY_TYPES).optional(),
  enabledTypes: z.array(z.enum(PAY_TYPES)).min(1).max(
    PAY_TYPES.length,
  ).optional(),
}).strict().refine(
  (value) => Object.keys(value).length > 0,
  "至少需要提供一个修改字段",
).refine(
  (value) => !(value.clearMerchantKey && value.merchantKey),
  "不能同时设置并清空商户密钥",
);

export const adminEpayPreviewSchema = z.object({
  outTradeNo: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(120),
  money: moneyInputSchema,
  type: z.enum(PAY_TYPES).optional(),
  clientIp: z.string().trim().max(80).optional(),
  device: z.string().trim().max(40).optional(),
  param: z.string().trim().max(200).optional(),
}).strict();

export const adminSponsorConfigPatchSchema = z.object({
  title: z.string().trim().min(1).max(40).optional(),
  description: z.string().trim().min(1).max(300).optional(),
  presetAmounts: z.array(moneyInputSchema).min(1).max(8).optional(),
  minAmount: moneyInputSchema.optional(),
  maxAmount: moneyInputSchema.optional(),
  wallEnabled: z.boolean().optional(),
  allowMessage: z.boolean().optional(),
}).strict().refine(
  (value) => Object.keys(value).length > 0,
  "至少需要提供一个修改字段",
);

export const adminSponsorOrderListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(["all", ...SPONSOR_STATUSES]).optional(),
  page: z.coerce.number().int().min(1).max(100_000).optional(),
  size: z.coerce.number().int().min(10).max(100).optional(),
}).strict();

export const adminSponsorOrderPatchSchema = z.object({
  status: z.enum(["paid", "closed"]).optional(),
  message: z.string().trim().max(80).optional(),
  displayMode: z.enum(DISPLAY_MODES).optional(),
  adminNote: z.string().trim().max(500).optional(),
}).strict().refine(
  (value) => (
    value.status !== undefined
    || value.message !== undefined
    || value.displayMode !== undefined
  ),
  "至少需要提供一个修改字段",
).superRefine((value, context) => {
  if (value.status === "paid" && !value.adminNote) {
    context.addIssue({
      code: "custom",
      path: ["adminNote"],
      message: "手动标记已支付必须填写对账说明",
    });
  }
});

export const adminSponsorLogsQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  signOk: z.enum(["0", "1"]).optional(),
  page: z.coerce.number().int().min(1).max(100_000).optional(),
  size: z.coerce.number().int().min(10).max(100).optional(),
}).strict();

export const adminSponsorOrderParamsSchema = z.object({
  id: z.coerce.number().int().positive().max(2_147_483_647),
}).strict();

export type AdminEpayConfigPatch = z.infer<
  typeof adminEpayConfigPatchSchema
>;
export type AdminEpayPreview = z.infer<typeof adminEpayPreviewSchema>;
export type AdminSponsorConfigPatch = z.infer<
  typeof adminSponsorConfigPatchSchema
>;
export type AdminSponsorOrderListQuery = z.infer<
  typeof adminSponsorOrderListQuerySchema
>;
export type AdminSponsorOrderPatch = z.infer<
  typeof adminSponsorOrderPatchSchema
>;
export type AdminSponsorLogsQuery = z.infer<
  typeof adminSponsorLogsQuerySchema
>;

function paymentConfigError(error: unknown): never {
  const message = error instanceof Error
    ? error.message
    : "支付配置操作失败";
  if (message.includes("待支付赞助订单")) {
    throw Errors.conflict(message);
  }
  throw Errors.badRequest(message);
}

export async function getAdminEpayConfig(actor: AdminPaymentActor) {
  requireAdmin(actor);
  return getEpayConfig();
}

export async function updateAdminEpayConfig(
  actor: AdminPaymentActor,
  patch: AdminEpayConfigPatch,
) {
  requireAdmin(actor);
  try {
    return await updateEpayConfig(patch);
  } catch (error) {
    paymentConfigError(error);
  }
}

export async function previewAdminEpayPayment(
  actor: AdminPaymentActor,
  input: AdminEpayPreview,
) {
  requireAdmin(actor);
  const callbacks = buildEpayCallbackUrls(resolvePaymentOrigin());
  try {
    return await buildEpaySubmitPayload({
      ...input,
      money: String(input.money),
      ...callbacks,
    });
  } catch (error) {
    paymentConfigError(error);
  }
}

export async function getAdminSponsorConfig(actor: AdminPaymentActor) {
  requireAdmin(actor);
  return getSponsorConfig();
}

export async function updateAdminSponsorConfig(
  actor: AdminPaymentActor,
  patch: AdminSponsorConfigPatch,
) {
  requireAdmin(actor);
  try {
    return await updateSponsorConfig(patch);
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "赞助配置不正确";
    throw Errors.badRequest(message);
  }
}

export async function getAdminSponsorOverview(actor: AdminPaymentActor) {
  requireAdmin(actor);
  await closeExpiredSponsorOrders();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const monthStart = new Date(
    todayStart.getFullYear(),
    todayStart.getMonth(),
    1,
  );
  const [paid, today, month, pending, closed, sponsors, payTypes] = await Promise.all([
    prisma.sponsorOrder.aggregate({
      where: { status: "paid" },
      _sum: { amountCents: true },
      _count: true,
    }),
    prisma.sponsorOrder.aggregate({
      where: { status: "paid", paidAt: { gte: todayStart } },
      _sum: { amountCents: true },
      _count: true,
    }),
    prisma.sponsorOrder.aggregate({
      where: { status: "paid", paidAt: { gte: monthStart } },
      _sum: { amountCents: true },
      _count: true,
    }),
    prisma.sponsorOrder.count({ where: { status: "pending" } }),
    prisma.sponsorOrder.count({ where: { status: "closed" } }),
    prisma.sponsorOrder.groupBy({
      by: ["userId"],
      where: { status: "paid" },
      _sum: { amountCents: true },
    }),
    prisma.sponsorOrder.groupBy({
      by: ["payType"],
      where: { status: "paid" },
      _sum: { amountCents: true },
      _count: true,
    }),
  ]);
  return {
    totalAmount: amountCentsToMoney(paid._sum.amountCents ?? 0),
    totalPaidOrders: paid._count,
    todayAmount: amountCentsToMoney(today._sum.amountCents ?? 0),
    todayPaidOrders: today._count,
    monthAmount: amountCentsToMoney(month._sum.amountCents ?? 0),
    monthPaidOrders: month._count,
    pendingOrders: pending,
    closedOrders: closed,
    sponsorCount: sponsors.length,
    payTypes: payTypes.map((item) => ({
      payType: item.payType,
      count: item._count,
      amount: amountCentsToMoney(item._sum.amountCents ?? 0),
    })),
  };
}

export async function listAdminSponsorOrders(
  actor: AdminPaymentActor,
  query: AdminSponsorOrderListQuery,
) {
  requireAdmin(actor);
  await closeExpiredSponsorOrders();
  const page = queryPage(query.page);
  const size = querySize(query.size, 20, 10, 100);
  const where: Prisma.SponsorOrderWhereInput = {};
  if (query.status && query.status !== "all") {
    where.status = query.status;
  }
  if (query.q) {
    where.OR = [
      { outTradeNo: { contains: query.q } },
      { tradeNo: { contains: query.q } },
      { user: { is: { username: { contains: query.q } } } },
      { user: { is: { nickname: { contains: query.q } } } },
    ];
  }
  const [list, total] = await Promise.all([
    prisma.sponsorOrder.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * size,
      take: size,
      include: {
        user: {
          select: {
            id: true,
            username: true,
            nickname: true,
            avatar: true,
          },
        },
      },
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

export async function updateAdminSponsorOrder(
  actor: AdminPaymentActor,
  orderId: number,
  patch: AdminSponsorOrderPatch,
) {
  requireAdmin(actor);
  return prisma.$transaction(async (tx) => {
    await acquireSponsorOrderLock(tx, orderId);
    const current = await tx.sponsorOrder.findUnique({
      where: { id: orderId },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            nickname: true,
            avatar: true,
          },
        },
      },
    });
    if (!current) throw Errors.notFound("订单不存在");
    if (current.status === "paid" && patch.status === "closed") {
      throw Errors.conflict("已支付订单不能直接改为已关闭，请走退款或冲正流程");
    }

    const data: Prisma.SponsorOrderUncheckedUpdateInput = {};
    if (patch.message !== undefined) data.message = patch.message;
    if (patch.displayMode !== undefined) data.displayMode = patch.displayMode;
    let newlyPaid = false;
    if (patch.status && patch.status !== current.status) {
      if (patch.status === "paid") {
        data.status = "paid";
        data.paidAt = current.paidAt ?? new Date();
        data.closedAt = null;
        newlyPaid = true;
      } else {
        if (current.status !== "pending") {
          throw Errors.conflict("只有待支付订单可以关闭");
        }
        data.status = "closed";
        data.closedAt = current.closedAt ?? new Date();
      }
    }

    const updated = await tx.sponsorOrder.update({
      where: { id: orderId },
      data,
      include: {
        user: {
          select: {
            id: true,
            username: true,
            nickname: true,
            avatar: true,
          },
        },
      },
    });
    if (newlyPaid) {
      await tx.user.update({
        where: { id: current.userId },
        data: {
          sponsorTotalCents: { increment: current.amountCents },
        },
      });
    }
    await logMarketAdminAction(tx, {
      actorId: actor.userId,
      action: "sponsor.order.update",
      targetType: "sponsor_order",
      targetId: orderId,
      summary: newlyPaid
        ? "人工对账标记赞助订单已支付"
        : "更新赞助订单",
      detail: {
        before: {
          status: current.status,
          message: current.message,
          displayMode: current.displayMode,
        },
        after: {
          status: updated.status,
          message: updated.message,
          displayMode: updated.displayMode,
        },
        adminNote: patch.adminNote || "",
        amount: amountCentsToMoney(current.amountCents),
        outTradeNo: current.outTradeNo,
      },
      ip: actor.ip,
    });
    return formatSponsorOrder(updated);
  });
}

export async function listAdminSponsorLogs(
  actor: AdminPaymentActor,
  query: AdminSponsorLogsQuery,
) {
  requireAdmin(actor);
  const page = queryPage(query.page);
  const size = querySize(query.size, 20, 10, 100);
  const where: Prisma.SponsorPaymentLogWhereInput = {};
  if (query.q) {
    where.OR = [
      { outTradeNo: { contains: query.q } },
      { result: { contains: query.q } },
    ];
  }
  if (query.signOk !== undefined) {
    where.signOk = query.signOk === "1";
  }
  const [list, total] = await Promise.all([
    prisma.sponsorPaymentLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * size,
      take: size,
      include: {
        order: {
          select: {
            id: true,
            amountCents: true,
            status: true,
          },
        },
      },
    }),
    prisma.sponsorPaymentLog.count({ where }),
  ]);
  return { page, size, total, list };
}
