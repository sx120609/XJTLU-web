import crypto from "node:crypto";
import {
  Prisma,
  type LearningCollectionProvider,
  type LearningCommerceOrderStatus,
  type LearningMaterialCommerceMode,
  type LearningOrderIssueStatus,
} from "@prisma/client";
import { prisma } from "../prisma";
import { Errors } from "../utils/response";
import { amountCentsToMoney } from "./epay";
import { requireVerifiedMarketUser } from "./marketAccessService";
import { acquireMarketItemLock } from "./marketItemLockService";
import { acquireMarketOrderLock } from "./marketOrderLockService";
import { MARKET_PUBLIC_USER_SELECT } from "./marketPublicUser";
import { notifyMarketUser } from "./marketNotificationService";
import {
  LEARNING_COMPLETION_DUE_MS,
  LEARNING_MATERIAL_MAX_PRICE_CENTS,
  LEARNING_MATERIAL_MIN_PRICE_CENTS,
  LEARNING_PAYMENT_DUE_MS,
  LEARNING_SELLER_CONFIRM_DUE_MS,
  PAID_LEARNING_MATERIALS_ENABLED,
  PAID_MATERIAL_DISABLED_MESSAGE,
  isAllowedLearningMaterialPrice,
} from "./marketPolicy";
import {
  canTransitionLearningOrder,
  type LearningCommerceOrderStatus as ContractOrderStatus,
} from "./learningCommerceContracts";
import type { PreparedLearningPrivateAsset } from "./learningPrivateAssetService";
import {
  parseDeclaredFormats,
  publishedMaterialProfileErrors,
} from "./learningMaterials";

const CATEGORY = "digital_goods";
const COMMAND_TTL_MS = 24 * 60 * 60 * 1000;
const ACTIVE_ORDER_STATUSES: LearningCommerceOrderStatus[] = [
  "pending_payment",
  "awaiting_seller_confirmation",
  "disputed",
  "delivered",
];
const ACTIVE_ISSUE_STATUSES: LearningOrderIssueStatus[] = [
  "open",
  "waiting_buyer",
  "waiting_seller",
  "refund_requested",
];

export type LearningCommerceActor = {
  userId: number;
  role: string;
  requestId?: string;
};

type TransactionClient = Prisma.TransactionClient;

const publicUserSelect = MARKET_PUBLIC_USER_SELECT;

const commerceOrderInclude = Prisma.validator<Prisma.LearningCommerceOrderInclude>()({
  order: {
    include: {
      item: {
        include: {
          images: { orderBy: [{ sort: "asc" as const }, { id: "asc" as const }], take: 1 },
          learningMaterial: { include: { type: true } },
        },
      },
      buyer: { select: publicUserSelect },
      seller: { select: publicUserSelect },
    },
  },
  version: {
    include: {
      files: {
        where: { status: "active" },
        select: {
          id: true,
          originalName: true,
          mimeType: true,
          fileSize: true,
          format: true,
          pageCount: true,
          status: true,
          createdAt: true,
        },
        orderBy: { id: "asc" as const },
      },
    },
  },
  collectionMethod: {
    select: {
      id: true,
      provider: true,
      label: true,
      versionNumber: true,
      status: true,
      assetId: true,
    },
  },
  paymentEvidence: {
    orderBy: [{ attempt: "desc" as const }, { id: "desc" as const }],
    select: {
      id: true,
      attempt: true,
      status: true,
      claimedPaidAt: true,
      buyerNote: true,
      handledReason: true,
      handledAt: true,
      assetId: true,
      submittedById: true,
      handledById: true,
      createdAt: true,
      updatedAt: true,
    },
  },
  events: {
    orderBy: { sequence: "asc" as const },
    select: {
      id: true,
      sequence: true,
      type: true,
      actorId: true,
      fromStatus: true,
      toStatus: true,
      createdAt: true,
    },
  },
  issues: {
    orderBy: { createdAt: "desc" as const },
    select: {
      id: true,
      type: true,
      status: true,
      reason: true,
      detail: true,
      refundAmountCents: true,
      resolution: true,
      resolvedAt: true,
      requestedById: true,
      resolvedById: true,
      createdAt: true,
      updatedAt: true,
    },
  },
});

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function requestHash(payload: unknown) {
  return crypto.createHash("sha256").update(stableJson(payload)).digest("hex");
}

function commandLockKey(actorId: number, operation: string, idempotencyKey: string) {
  const digest = crypto
    .createHash("sha256")
    .update(`${actorId}:${operation}:${idempotencyKey}`)
    .digest();
  return digest.readBigInt64BE(0);
}

async function executeIdempotentCommand<T>(
  actor: LearningCommerceActor,
  operation: string,
  idempotencyKey: string,
  payload: unknown,
  handler: (tx: TransactionClient) => Promise<T>,
): Promise<{ value: T; reused: boolean }> {
  const hash = requestHash(payload);
  return prisma.$transaction(async (tx) => {
    const lockKey = commandLockKey(actor.userId, operation, idempotencyKey);
    await tx.$queryRaw`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(${lockKey})`;
    let command = await tx.learningCommerceCommand.findUnique({
      where: {
        actorId_operation_idempotencyKey: {
          actorId: actor.userId,
          operation,
          idempotencyKey,
        },
      },
    });
    if (command && command.requestHash !== hash) {
      throw Errors.conflict("相同幂等键不能用于不同请求");
    }
    if (command?.status === "completed" && command.responseBody) {
      return { value: JSON.parse(command.responseBody) as T, reused: true };
    }
    if (command && command.expiresAt <= new Date()) {
      await tx.learningCommerceCommand.delete({ where: { id: command.id } });
      command = null;
    }
    if (!command) {
      command = await tx.learningCommerceCommand.create({
        data: {
          actorId: actor.userId,
          operation,
          idempotencyKey,
          requestHash: hash,
          expiresAt: new Date(Date.now() + COMMAND_TTL_MS),
        },
      });
    }
    const value = await handler(tx);
    await tx.learningCommerceCommand.update({
      where: { id: command.id },
      data: {
        status: "completed",
        responseCode: 0,
        responseBody: JSON.stringify(value),
        resourceType: operation,
        resourceId: String((value as { id?: unknown })?.id ?? ""),
      },
    });
    return { value, reused: false };
  });
}

function ensurePaidCommerceEnabled() {
  if (!PAID_LEARNING_MATERIALS_ENABLED) throw Errors.forbidden(PAID_MATERIAL_DISABLED_MESSAGE);
}

function assertTransition(from: LearningCommerceOrderStatus, to: LearningCommerceOrderStatus) {
  if (!canTransitionLearningOrder(from as ContractOrderStatus, to as ContractOrderStatus)) {
    throw Errors.conflict(`订单不能从 ${from} 切换到 ${to}`);
  }
}

function projectOrderStatus(status: LearningCommerceOrderStatus) {
  if (status === "awaiting_seller_confirmation") return "pending_payment";
  if (status === "delivered") return "delivering";
  return status;
}

async function nextEventSequence(tx: TransactionClient, commerceOrderId: number) {
  const result = await tx.learningOrderEvent.aggregate({
    where: { commerceOrderId },
    _max: { sequence: true },
  });
  return (result._max.sequence || 0) + 1;
}

async function appendOrderEvents(
  tx: TransactionClient,
  commerceOrderId: number,
  events: Array<{
    type: string;
    actorId?: number | null;
    fromStatus?: LearningCommerceOrderStatus | null;
    toStatus?: LearningCommerceOrderStatus | null;
    requestId?: string;
    detail?: Record<string, unknown>;
  }>,
) {
  let sequence = await nextEventSequence(tx, commerceOrderId);
  await tx.learningOrderEvent.createMany({
    data: events.map((event) => ({
      commerceOrderId,
      sequence: sequence++,
      type: event.type,
      actorId: event.actorId ?? null,
      fromStatus: event.fromStatus ?? null,
      toStatus: event.toStatus ?? null,
      requestId: event.requestId || "",
      detail: JSON.stringify(event.detail || {}),
    })),
  });
}

function serializeCommerceOrder(row: any, actor: LearningCommerceActor) {
  const isParty = row.order.buyerId === actor.userId || row.order.sellerId === actor.userId;
  const isStaff = ["admin", "mod"].includes(actor.role);
  const canReadSensitive = isParty || isStaff;
  const canReadCollectionQr = isStaff
    || row.order.sellerId === actor.userId
    || (
      row.order.buyerId === actor.userId
      && ["pending_payment", "awaiting_seller_confirmation", "disputed"].includes(row.status)
    );
  return {
    id: row.id,
    orderId: row.orderId,
    mode: row.mode,
    status: row.status,
    statusVersion: row.statusVersion,
    priceCents: row.priceCents,
    amount: amountCentsToMoney(row.priceCents),
    currency: row.currency,
    paymentDueAt: row.paymentDueAt,
    sellerResponseDueAt: row.sellerResponseDueAt,
    deliveredAt: row.deliveredAt,
    completionDueAt: row.completionDueAt,
    completedAt: row.completedAt,
    refundedAt: row.refundedAt,
    cancelledAt: row.cancelledAt,
    cancelReason: row.cancelReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    order: {
      id: row.order.id,
      itemId: row.order.itemId,
      buyerId: row.order.buyerId,
      sellerId: row.order.sellerId,
      outTradeNo: row.order.outTradeNo,
      amountCents: row.order.amountCents,
      amount: amountCentsToMoney(row.order.amountCents),
      platformFeeCents: row.order.platformFeeCents,
      status: row.order.status,
      buyer: row.order.buyer,
      seller: row.order.seller,
      item: {
        id: row.order.item.id,
        title: row.order.item.title,
        description: row.order.item.description,
        priceCents: row.order.item.priceCents,
        cover: row.order.item.images?.[0]?.url || "",
        courseCode: row.order.item.learningMaterial?.courseCode || "",
      },
    },
    version: {
      id: row.version.id,
      versionNumber: row.version.versionNumber,
      label: row.version.label,
      releaseNotes: row.version.releaseNotes,
      files: row.status === "delivered" || row.status === "completed" || row.order.sellerId === actor.userId || isStaff
        ? row.version.files
        : row.version.files.map((file: any) => ({
          id: file.id,
          originalName: file.originalName,
          format: file.format,
          fileSize: file.fileSize,
          pageCount: file.pageCount,
        })),
    },
    collectionMethod: row.collectionMethod ? {
      id: row.collectionMethod.id,
      provider: row.collectionMethod.provider,
      label: row.collectionMethod.label,
      versionNumber: row.collectionMethod.versionNumber,
      qrImageUrl: canReadCollectionQr
        ? `/api/market/materials/commerce/private-assets/${row.collectionMethod.assetId}`
        : undefined,
    } : null,
    paymentEvidence: row.paymentEvidence.map((evidence: any) => ({
      id: evidence.id,
      attempt: evidence.attempt,
      status: evidence.status,
      claimedPaidAt: evidence.claimedPaidAt,
      buyerNote: canReadSensitive ? evidence.buyerNote : "",
      handledReason: canReadSensitive ? evidence.handledReason : "",
      handledAt: evidence.handledAt,
      createdAt: evidence.createdAt,
      imageUrl: canReadSensitive
        ? `/api/market/materials/commerce/private-assets/${evidence.assetId}`
        : undefined,
    })),
    events: row.events,
    issues: row.issues,
    mine: {
      buyer: row.order.buyerId === actor.userId,
      seller: row.order.sellerId === actor.userId,
      staff: isStaff,
    },
  };
}

async function findCommerceOrderOrThrow(
  db: TransactionClient | typeof prisma,
  id: number,
) {
  const row = await db.learningCommerceOrder.findUnique({
    where: { id },
    include: commerceOrderInclude,
  });
  if (!row) throw Errors.notFound("学习资料订单不存在");
  return row;
}

function ensureOrderParty(row: any, actor: LearningCommerceActor) {
  if (
    row.order.buyerId !== actor.userId
    && row.order.sellerId !== actor.userId
    && !["admin", "mod"].includes(actor.role)
  ) {
    throw Errors.forbidden("无权访问该学习资料订单");
  }
}

export function learningCommercePublicStatus() {
  return {
    paidEnabled: PAID_LEARNING_MATERIALS_ENABLED,
    minPriceCents: LEARNING_MATERIAL_MIN_PRICE_CENTS,
    maxPriceCents: LEARNING_MATERIAL_MAX_PRICE_CENTS,
    minPrice: amountCentsToMoney(LEARNING_MATERIAL_MIN_PRICE_CENTS),
    maxPrice: amountCentsToMoney(LEARNING_MATERIAL_MAX_PRICE_CENTS),
    platformFeeBps: 0,
    paymentMode: "seller_direct",
    notice: "买家直接向创作者付款；靠浦不代收资金。卖家确认到账后，系统自动解锁完整资料。",
  };
}

export async function getLearningCreatorContext(actor: LearningCommerceActor) {
  await requireVerifiedMarketUser(actor.userId, actor.role, "publish");
  const [profile, application] = await Promise.all([
    prisma.learningCreatorProfile.findUnique({
      where: { userId: actor.userId },
      include: {
        collectionMethods: {
          orderBy: [{ createdAt: "desc" }],
          select: {
            id: true,
            provider: true,
            label: true,
            versionNumber: true,
            status: true,
            assetId: true,
            reviewedAt: true,
            disabledAt: true,
            createdAt: true,
          },
        },
      },
    }),
    prisma.learningCreatorApplication.findFirst({
      where: { userId: actor.userId },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  return {
    profile: profile ? {
      ...profile,
      collectionMethods: profile.collectionMethods.map((method) => ({
        ...method,
        qrImageUrl: `/api/market/materials/commerce/private-assets/${method.assetId}`,
      })),
    } : null,
    application,
  };
}

export async function submitLearningCreatorApplication(
  actor: LearningCommerceActor,
  input: {
    expertise: string;
    experience: string;
    sampleDescription: string;
    rightsCommitted: true;
  },
) {
  await requireVerifiedMarketUser(actor.userId, actor.role, "publish");
  return prisma.$transaction(async (tx) => {
    const lockKey = BigInt(9_136) * 4_294_967_296n + BigInt(actor.userId);
    await tx.$queryRaw`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(${lockKey})`;
    const activeProfile = await tx.learningCreatorProfile.findUnique({
      where: { userId: actor.userId },
    });
    if (activeProfile?.status === "active") throw Errors.conflict("你已经是认证创作者");
    const pending = await tx.learningCreatorApplication.findFirst({
      where: { userId: actor.userId, status: { in: ["submitted", "reviewing"] } },
    });
    if (pending) return pending;
    return tx.learningCreatorApplication.create({
      data: {
        userId: actor.userId,
        expertise: input.expertise,
        experience: input.experience,
        sampleDescription: input.sampleDescription,
        rightsCommitmentAt: new Date(),
        status: "submitted",
      },
    });
  });
}

export async function listCreatorApplications(status?: string) {
  const allowed = ["draft", "submitted", "reviewing", "approved", "rejected", "withdrawn"];
  if (status && !allowed.includes(status)) throw Errors.badRequest("创作者申请状态不合法");
  return prisma.learningCreatorApplication.findMany({
    where: status ? { status: status as any } : undefined,
    orderBy: [{ submittedAt: "asc" }, { id: "asc" }],
    include: { user: { select: publicUserSelect }, reviewedBy: { select: publicUserSelect } },
    take: 200,
  });
}

export async function reviewCreatorApplication(
  actor: LearningCommerceActor,
  applicationId: number,
  input: { action: "approve" | "reject"; reason: string },
) {
  if (!["admin", "mod"].includes(actor.role)) throw Errors.forbidden("需要学习资料审核权限");
  const result = await prisma.$transaction(async (tx) => {
    const lockKey = BigInt(9_137) * 4_294_967_296n + BigInt(applicationId);
    await tx.$queryRaw`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(${lockKey})`;
    const current = await tx.learningCreatorApplication.findUnique({ where: { id: applicationId } });
    if (!current) throw Errors.notFound("创作者申请不存在");
    if (!["submitted", "reviewing"].includes(current.status)) throw Errors.conflict("该申请已经处理");
    const now = new Date();
    const status = input.action === "approve" ? "approved" : "rejected";
    const application = await tx.learningCreatorApplication.update({
      where: { id: applicationId },
      data: {
        status,
        reviewedById: actor.userId,
        reviewedAt: now,
        reviewReason: input.reason,
      },
    });
    if (input.action === "approve") {
      await tx.learningCreatorProfile.upsert({
        where: { userId: current.userId },
        update: {
          status: "active",
          certifiedById: actor.userId,
          certifiedAt: now,
          lastReviewedAt: now,
          statusReason: "",
        },
        create: {
          userId: current.userId,
          status: "active",
          certifiedById: actor.userId,
          certifiedAt: now,
          lastReviewedAt: now,
        },
      });
    }
    await tx.adminActionLog.create({
      data: {
        actorId: actor.userId,
        action: `learning_creator_${status}`,
        targetType: "LearningCreatorApplication",
        targetId: String(applicationId),
        summary: input.action === "approve" ? "批准学习资料创作者申请" : "驳回学习资料创作者申请",
        detail: JSON.stringify({ applicantId: current.userId, reason: input.reason }),
      },
    });
    return application;
  });
  await notifyMarketUser(
    result.userId,
    result.status === "approved" ? "创作者认证已通过" : "创作者认证申请需要修改",
    result.status === "approved"
      ? "你现在可以配置收款码并提交付费学习资料审核。"
      : result.reviewReason,
    "/learning/creator",
    { type: "learning-creator-review", applicationId, status: result.status },
  );
  return result;
}

export async function createCollectionMethod(
  actor: LearningCommerceActor,
  input: { provider: LearningCollectionProvider; label: string },
  prepared: PreparedLearningPrivateAsset,
) {
  try {
    await requireVerifiedMarketUser(actor.userId, actor.role, "publish");
    const profile = await prisma.learningCreatorProfile.findUnique({ where: { userId: actor.userId } });
    if (!profile || profile.status !== "active") throw Errors.forbidden("认证创作者才能配置收款码");
    return await prisma.$transaction(async (tx) => {
      const lockKey = BigInt(1_205_021) * 4_294_967_296n + BigInt(actor.userId);
      await tx.$queryRaw`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(${lockKey})`;
      await tx.learningCollectionMethod.updateMany({
        where: { creatorId: actor.userId, provider: input.provider, status: "active" },
        data: { status: "disabled", disabledAt: new Date() },
      });
      const latest = await tx.learningCollectionMethod.aggregate({
        where: { creatorId: actor.userId, provider: input.provider },
        _max: { versionNumber: true },
      });
      const asset = await tx.learningPrivateAsset.create({ data: prepared.data });
      return tx.learningCollectionMethod.create({
        data: {
          creatorId: actor.userId,
          creatorProfileId: profile.id,
          provider: input.provider,
          assetId: asset.id,
          label: input.label,
          versionNumber: (latest._max.versionNumber || 0) + 1,
          status: "active",
        },
        select: {
          id: true,
          provider: true,
          label: true,
          versionNumber: true,
          status: true,
          assetId: true,
          createdAt: true,
        },
      });
    });
  } catch (error) {
    await prepared.cleanup();
    throw error;
  }
}

export async function disableCollectionMethod(actor: LearningCommerceActor, methodId: number) {
  await requireVerifiedMarketUser(actor.userId, actor.role, "publish");
  const current = await prisma.learningCollectionMethod.findUnique({ where: { id: methodId } });
  if (!current) throw Errors.notFound("收款方式不存在");
  if (current.creatorId !== actor.userId && !["admin", "mod"].includes(actor.role)) {
    throw Errors.forbidden("无权管理该收款方式");
  }
  return prisma.learningCollectionMethod.update({
    where: { id: methodId },
    data: { status: "disabled", disabledAt: new Date() },
  });
}

export async function submitMaterialVersionReview(
  actor: LearningCommerceActor,
  itemId: number,
  versionId: number,
) {
  ensurePaidCommerceEnabled();
  await requireVerifiedMarketUser(actor.userId, actor.role, "publish");
  return prisma.$transaction(async (tx) => {
    await acquireMarketItemLock(tx, itemId);
    const item = await tx.marketItem.findUnique({
      where: { id: itemId },
      include: {
        learningMaterial: true,
      },
    });
    if (!item || item.category !== CATEGORY || !item.learningMaterial) {
      throw Errors.notFound("学习资料不存在");
    }
    if (item.sellerId !== actor.userId && !["admin", "mod"].includes(actor.role)) {
      throw Errors.forbidden("无权提交该资料");
    }
    const creator = await tx.learningCreatorProfile.findUnique({ where: { userId: item.sellerId } });
    if (!creator || creator.status !== "active") throw Errors.forbidden("通过创作者认证后才能提交付费资料");
    if (!isAllowedLearningMaterialPrice(item.priceCents)) {
      throw Errors.badRequest("请设置有效的付费价格");
    }
    const profileErrors = publishedMaterialProfileErrors({
      courseCode: item.learningMaterial.courseCode || "",
      college: item.learningMaterial.college || "",
      major: item.learningMaterial.major || "",
      typeId: item.learningMaterial.typeId,
      applicableSemester: item.learningMaterial.applicableSemester as any,
      fileFormats: parseDeclaredFormats(item.learningMaterial.declaredFormats),
      pageCount: item.learningMaterial.pageCount,
      versionLabel: item.learningMaterial.versionLabel || "",
      language: item.learningMaterial.language || "",
      originalityKind: item.learningMaterial.originalityKind || "",
      originalityStatement: item.learningMaterial.originalityStatement || "",
      rightsConfirmed: Boolean(item.learningMaterial.rightsConfirmedAt),
    });
    if (profileErrors.length) throw Errors.badRequest(profileErrors[0]);
    const materialType = item.learningMaterial.typeId
      ? await tx.learningMaterialType.findUnique({ where: { id: item.learningMaterial.typeId } })
      : null;
    if (!materialType || materialType.status !== "approved" || !materialType.enabled) {
      throw Errors.badRequest("所选资料类型尚未通过审核");
    }
    const method = await tx.learningCollectionMethod.findFirst({
      where: { creatorId: item.sellerId, status: "active" },
    });
    if (!method) throw Errors.badRequest("请先配置至少一种有效收款码");
    const version = await tx.learningMaterialVersion.findUnique({
      where: { id: versionId },
      include: { files: true },
    });
    if (!version || version.profileId !== item.learningMaterial.id) throw Errors.notFound("资料版本不存在");
    if (!version.files.some((file) => file.status === "active")) throw Errors.badRequest("该版本没有可交付文件");
    const pending = await tx.learningMaterialReview.findFirst({
      where: { versionId, status: { in: ["submitted", "reviewing"] } },
    });
    if (pending) return pending;
    const latest = await tx.learningMaterialReview.aggregate({
      where: { versionId },
      _max: { round: true },
    });
    const review = await tx.learningMaterialReview.create({
      data: {
        versionId,
        round: (latest._max.round || 0) + 1,
        status: "submitted",
        submittedById: actor.userId,
      },
    });
    await tx.learningMaterialProfile.update({
      where: { id: item.learningMaterial.id },
      data: { commerceMode: "paid" },
    });
    await tx.marketItem.update({
      where: { id: itemId },
      data: { status: "reviewing", moderationNote: "付费资料正在进行人工审核" },
    });
    return review;
  });
}

export async function listMaterialReviews(status?: string) {
  const allowed = ["submitted", "reviewing", "approved", "rejected", "withdrawn"];
  if (status && !allowed.includes(status)) throw Errors.badRequest("资料审核状态不合法");
  return prisma.learningMaterialReview.findMany({
    where: status ? { status: status as any } : undefined,
    include: {
      submittedBy: { select: publicUserSelect },
      reviewedBy: { select: publicUserSelect },
      version: {
        include: {
          files: {
            select: {
              id: true,
              originalName: true,
              format: true,
              fileSize: true,
              pageCount: true,
              status: true,
            },
          },
          profile: {
            include: {
              item: { include: { images: { orderBy: { sort: "asc" }, take: 1 } } },
              type: true,
            },
          },
        },
      },
    },
    orderBy: [{ submittedAt: "asc" }, { id: "asc" }],
    take: 200,
  });
}

export async function decideMaterialReview(
  actor: LearningCommerceActor,
  reviewId: number,
  input: {
    action: "approve" | "reject";
    reason: string;
    checklist: { rights: boolean; quality: boolean; fileSafety: boolean };
  },
) {
  if (!["admin", "mod"].includes(actor.role)) throw Errors.forbidden("需要学习资料审核权限");
  const result = await prisma.$transaction(async (tx) => {
    const current = await tx.learningMaterialReview.findUnique({
      where: { id: reviewId },
      include: { version: { include: { profile: true } } },
    });
    if (!current) throw Errors.notFound("资料审核单不存在");
    await acquireMarketItemLock(tx, current.version.profile.itemId);
    const refreshed = await tx.learningMaterialReview.findUnique({ where: { id: reviewId } });
    if (!refreshed || !["submitted", "reviewing"].includes(refreshed.status)) {
      throw Errors.conflict("该资料审核单已经处理");
    }
    const now = new Date();
    const status = input.action === "approve" ? "approved" : "rejected";
    const review = await tx.learningMaterialReview.update({
      where: { id: reviewId },
      data: {
        status,
        reviewedById: actor.userId,
        reviewedAt: now,
        reason: input.reason,
        checklist: JSON.stringify(input.checklist),
      },
    });
    if (input.action === "approve") {
      await tx.learningMaterialVersion.updateMany({
        where: {
          profileId: current.version.profileId,
          status: "active",
          id: { not: current.versionId },
        },
        data: { status: "retired" },
      });
      await tx.learningMaterialVersion.update({
        where: { id: current.versionId },
        data: { status: "active", publishedAt: current.version.publishedAt || now },
      });
      await tx.learningMaterialProfile.update({
        where: { id: current.version.profileId },
        data: {
          activeVersionId: current.versionId,
          versionLabel: current.version.label || undefined,
          commerceMode: "paid",
        },
      });
      await tx.marketItem.update({
        where: { id: current.version.profile.itemId },
        data: { status: "active", moderationNote: "", moderatedAt: now },
      });
    } else {
      const hasOtherActive = Boolean(
        current.version.profile.activeVersionId
        && current.version.profile.activeVersionId !== current.versionId,
      );
      await tx.marketItem.update({
        where: { id: current.version.profile.itemId },
        data: {
          status: hasOtherActive ? "active" : "draft",
          moderationNote: input.reason,
          moderatedAt: now,
        },
      });
    }
    await tx.adminActionLog.create({
      data: {
        actorId: actor.userId,
        action: `learning_material_${status}`,
        targetType: "LearningMaterialReview",
        targetId: String(reviewId),
        summary: input.action === "approve" ? "批准付费学习资料" : "驳回付费学习资料",
        detail: JSON.stringify({
          itemId: current.version.profile.itemId,
          versionId: current.versionId,
          reason: input.reason,
          checklist: input.checklist,
        }),
      },
    });
    return {
      ...review,
      itemId: current.version.profile.itemId,
      versionId: current.versionId,
    };
  });
  await notifyMarketUser(
    result.submittedById,
    result.status === "approved" ? "学习资料审核通过" : "学习资料需要修改",
    result.status === "approved" ? "你的付费学习资料已公开上架" : result.reason,
    `/learning/materials/item/${result.itemId}`,
    { type: "learning-material-review", reviewId, status: result.status },
  );
  return result;
}

export async function createPaidLearningOrder(
  actor: LearningCommerceActor,
  itemId: number,
  input: { provider?: LearningCollectionProvider },
  idempotencyKey: string,
) {
  ensurePaidCommerceEnabled();
  await requireVerifiedMarketUser(actor.userId, actor.role);
  const command = await executeIdempotentCommand(
    actor,
    `learning-order:create:${itemId}`,
    idempotencyKey,
    input,
    async (tx) => {
      await acquireMarketItemLock(tx, itemId);
      const item = await tx.marketItem.findUnique({
        where: { id: itemId },
        include: {
          learningMaterial: {
            include: {
              activeVersion: {
                include: {
                  reviews: {
                    where: { status: "approved" },
                    orderBy: { reviewedAt: "desc" },
                    take: 1,
                  },
                },
              },
            },
          },
          seller: { select: publicUserSelect },
        },
      });
      if (
        !item
        || item.category !== CATEGORY
        || item.status !== "active"
        || item.learningMaterial?.commerceMode !== "paid"
      ) {
        throw Errors.badRequest("该付费资料当前不可购买");
      }
      if (item.sellerId === actor.userId) throw Errors.badRequest("不能购买自己发布的学习资料");
      if (!isAllowedLearningMaterialPrice(item.priceCents)) throw Errors.badRequest("该资料价格无效");
      const version = item.learningMaterial.activeVersion;
      if (!version || !version.reviews.length) throw Errors.badRequest("该资料尚未通过人工审核");
      const creator = await tx.learningCreatorProfile.findUnique({ where: { userId: item.sellerId } });
      if (!creator || creator.status !== "active") throw Errors.badRequest("该创作者当前暂停销售");
      const collectionMethod = await tx.learningCollectionMethod.findFirst({
        where: {
          creatorId: item.sellerId,
          status: "active",
          ...(input.provider ? { provider: input.provider } : {}),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });
      if (!collectionMethod) throw Errors.badRequest("卖家尚未配置可用的收款方式");
      const existing = await tx.learningCommerceOrder.findFirst({
        where: {
          versionId: version.id,
          status: { in: ACTIVE_ORDER_STATUSES },
          order: { buyerId: actor.userId },
        },
        include: commerceOrderInclude,
        orderBy: { createdAt: "desc" },
      });
      if (existing) return serializeCommerceOrder(existing, actor);
      const offer = await tx.marketOffer.create({
        data: {
          itemId,
          buyerId: actor.userId,
          priceCents: item.priceCents,
          message: "购买付费学习资料",
          status: "accepted",
        },
      });
      const now = new Date();
      const order = await tx.marketOrder.create({
        data: {
          itemId,
          offerId: offer.id,
          buyerId: actor.userId,
          sellerId: item.sellerId,
          outTradeNo: `LM${Date.now()}U${actor.userId}${crypto.randomBytes(3).toString("hex").toUpperCase()}`,
          amountCents: item.priceCents,
          platformFeeCents: 0,
          sellerAmountCents: item.priceCents,
          deliveryType: "digital",
          status: "pending_payment",
          expiresAt: new Date(now.getTime() + LEARNING_PAYMENT_DUE_MS),
        },
      });
      const commerceOrder = await tx.learningCommerceOrder.create({
        data: {
          orderId: order.id,
          versionId: version.id,
          collectionMethodId: collectionMethod.id,
          mode: "paid",
          status: "pending_payment",
          priceCents: item.priceCents,
          paymentDueAt: new Date(now.getTime() + LEARNING_PAYMENT_DUE_MS),
        },
      });
      await appendOrderEvents(tx, commerceOrder.id, [{
        type: "ORDER_CREATED",
        actorId: actor.userId,
        toStatus: "pending_payment",
        requestId: actor.requestId,
        detail: {
          itemId,
          versionId: version.id,
          collectionMethodId: collectionMethod.id,
          priceCents: item.priceCents,
          platformFeeCents: 0,
        },
      }]);
      await tx.marketItem.update({
        where: { id: itemId },
        data: { offerCount: { increment: 1 } },
      });
      const created = await findCommerceOrderOrThrow(tx, commerceOrder.id);
      return serializeCommerceOrder(created, actor);
    },
  );
  return command.value;
}

export async function listLearningCommerceOrders(
  actor: LearningCommerceActor,
  side: "buyer" | "seller" | "all" = "buyer",
) {
  await requireVerifiedMarketUser(actor.userId, actor.role);
  const staff = ["admin", "mod"].includes(actor.role);
  const where = staff && side === "all"
    ? {}
    : side === "seller"
      ? { order: { sellerId: actor.userId } }
      : { order: { buyerId: actor.userId } };
  const rows = await prisma.learningCommerceOrder.findMany({
    where,
    include: commerceOrderInclude,
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return rows.map((row) => serializeCommerceOrder(row, actor));
}

export async function getLearningCommerceOrder(actor: LearningCommerceActor, id: number) {
  await requireVerifiedMarketUser(actor.userId, actor.role);
  const row = await findCommerceOrderOrThrow(prisma, id);
  ensureOrderParty(row, actor);
  return serializeCommerceOrder(row, actor);
}

export async function submitPaymentEvidence(
  actor: LearningCommerceActor,
  commerceOrderId: number,
  input: { claimedPaidAt?: Date; buyerNote: string },
  prepared: PreparedLearningPrivateAsset,
  idempotencyKey: string,
) {
  try {
    ensurePaidCommerceEnabled();
    await requireVerifiedMarketUser(actor.userId, actor.role);
    const command = await executeIdempotentCommand(
      actor,
      `learning-order:evidence:${commerceOrderId}`,
      idempotencyKey,
      {
        claimedPaidAt: input.claimedPaidAt?.toISOString() || null,
        buyerNote: input.buyerNote,
        sha256: prepared.data.sha256,
      },
      async (tx) => {
        const current = await findCommerceOrderOrThrow(tx, commerceOrderId);
        await acquireMarketOrderLock(tx, current.orderId);
        const row = await findCommerceOrderOrThrow(tx, commerceOrderId);
        if (row.order.buyerId !== actor.userId) throw Errors.forbidden("只有订单买家可以提交付款凭证");
        if (row.status !== "pending_payment") throw Errors.conflict("当前订单不能提交付款凭证");
        if (row.paymentDueAt && row.paymentDueAt <= new Date()) throw Errors.conflict("付款时间已过，请重新下单");
        const latest = await tx.learningPaymentEvidence.aggregate({
          where: { commerceOrderId },
          _max: { attempt: true },
        });
        const asset = await tx.learningPrivateAsset.create({ data: prepared.data });
        await tx.learningPaymentEvidence.create({
          data: {
            commerceOrderId,
            assetId: asset.id,
            submittedById: actor.userId,
            attempt: (latest._max.attempt || 0) + 1,
            status: "submitted",
            claimedPaidAt: input.claimedPaidAt || new Date(),
            buyerNote: input.buyerNote,
          },
        });
        const now = new Date();
        assertTransition(row.status, "awaiting_seller_confirmation");
        await tx.learningCommerceOrder.update({
          where: { id: commerceOrderId },
          data: {
            status: "awaiting_seller_confirmation",
            statusVersion: { increment: 1 },
            sellerResponseDueAt: new Date(now.getTime() + LEARNING_SELLER_CONFIRM_DUE_MS),
          },
        });
        await tx.marketOrder.update({
          where: { id: row.orderId },
          data: { expiresAt: null },
        });
        await appendOrderEvents(tx, commerceOrderId, [{
          type: "PAYMENT_EVIDENCE_SUBMITTED",
          actorId: actor.userId,
          fromStatus: row.status,
          toStatus: "awaiting_seller_confirmation",
          requestId: actor.requestId,
          detail: { sha256: prepared.data.sha256 },
        }]);
        const updated = await findCommerceOrderOrThrow(tx, commerceOrderId);
        return serializeCommerceOrder(updated, actor);
      },
    );
    if (command.reused) await prepared.cleanup();
    const value: any = command.value;
    await notifyMarketUser(
      value.order.sellerId,
      "买家已提交付款凭证",
      `订单 ${value.order.outTradeNo} 等待你核对收款`,
      `/learning/orders/${commerceOrderId}`,
      { type: "learning-payment-evidence", commerceOrderId },
    );
    return value;
  } catch (error) {
    await prepared.cleanup();
    throw error;
  }
}

export async function confirmPaymentEvidence(
  actor: LearningCommerceActor,
  commerceOrderId: number,
  evidenceId: number,
  idempotencyKey: string,
) {
  ensurePaidCommerceEnabled();
  await requireVerifiedMarketUser(actor.userId, actor.role);
  const command = await executeIdempotentCommand(
    actor,
    `learning-order:confirm:${commerceOrderId}:${evidenceId}`,
    idempotencyKey,
    {},
    async (tx) => {
      const current = await findCommerceOrderOrThrow(tx, commerceOrderId);
      await acquireMarketOrderLock(tx, current.orderId);
      const row = await findCommerceOrderOrThrow(tx, commerceOrderId);
      const staff = ["admin", "mod"].includes(actor.role);
      if (row.order.sellerId !== actor.userId && !staff) throw Errors.forbidden("只有订单卖家或审核人员可以确认到账");
      if (!["awaiting_seller_confirmation", "disputed"].includes(row.status)) throw Errors.conflict("该订单不在待确认或争议处理状态");
      const evidence = await tx.learningPaymentEvidence.findUnique({ where: { id: evidenceId } });
      if (!evidence || evidence.commerceOrderId !== commerceOrderId || evidence.status !== "submitted") {
        throw Errors.conflict("付款凭证状态已经变化");
      }
      const now = new Date();
      assertTransition(row.status, "delivered");
      const accepted = await tx.learningPaymentEvidence.updateMany({
        where: { id: evidenceId, status: "submitted" },
        data: { status: "accepted", handledById: actor.userId, handledAt: now },
      });
      if (accepted.count !== 1) throw Errors.conflict("付款凭证状态已经变化");
      await tx.learningMaterialAccess.upsert({
        where: { orderId: row.orderId },
        update: { revokedAt: null },
        create: {
          orderId: row.orderId,
          versionId: row.versionId,
          userId: row.order.buyerId,
        },
      });
      await tx.learningCommerceOrder.update({
        where: { id: commerceOrderId },
        data: {
          status: "delivered",
          statusVersion: { increment: 1 },
          deliveredAt: now,
          completionDueAt: new Date(now.getTime() + LEARNING_COMPLETION_DUE_MS),
        },
      });
      await tx.marketOrder.update({
        where: { id: row.orderId },
        data: {
          status: projectOrderStatus("delivered"),
          paidAt: now,
          digitalDeliveredAt: now,
          sellerConfirmedAt: now,
          expiresAt: null,
        },
      });
      if (row.status === "disputed") {
        await tx.learningOrderIssue.updateMany({
          where: {
            commerceOrderId,
            status: { in: [...ACTIVE_ISSUE_STATUSES] },
          },
          data: {
            status: "resolved",
            resolvedById: actor.userId,
            resolvedAt: now,
            resolution: "已核实到账并交付资料",
          },
        });
      }
      await appendOrderEvents(tx, commerceOrderId, [
        {
          type: "PAYMENT_CONFIRMED",
          actorId: actor.userId,
          fromStatus: row.status,
          toStatus: "delivered",
          requestId: actor.requestId,
          detail: { evidenceId },
        },
        {
          type: "ACCESS_GRANTED",
          actorId: actor.userId,
          toStatus: "delivered",
          requestId: actor.requestId,
          detail: { versionId: row.versionId, buyerId: row.order.buyerId },
        },
        {
          type: "ORDER_DELIVERED",
          actorId: actor.userId,
          toStatus: "delivered",
          requestId: actor.requestId,
        },
      ]);
      const updated = await findCommerceOrderOrThrow(tx, commerceOrderId);
      return serializeCommerceOrder(updated, actor);
    },
  );
  const value: any = command.value;
  await notifyMarketUser(
    value.order.buyerId,
    "付款已确认，完整资料已解锁",
    `你购买的《${value.order.item.title}》现在可以在资料库下载`,
    "/learning/library",
    { type: "learning-access-granted", commerceOrderId },
  );
  return value;
}

export async function rejectPaymentEvidence(
  actor: LearningCommerceActor,
  commerceOrderId: number,
  evidenceId: number,
  reason: string,
  idempotencyKey: string,
) {
  ensurePaidCommerceEnabled();
  await requireVerifiedMarketUser(actor.userId, actor.role);
  const command = await executeIdempotentCommand(
    actor,
    `learning-order:reject:${commerceOrderId}:${evidenceId}`,
    idempotencyKey,
    { reason },
    async (tx) => {
      const current = await findCommerceOrderOrThrow(tx, commerceOrderId);
      await acquireMarketOrderLock(tx, current.orderId);
      const row = await findCommerceOrderOrThrow(tx, commerceOrderId);
      const staff = ["admin", "mod"].includes(actor.role);
      if (row.order.sellerId !== actor.userId && !staff) throw Errors.forbidden("只有订单卖家或审核人员可以驳回凭证");
      if (!["awaiting_seller_confirmation", "disputed"].includes(row.status)) throw Errors.conflict("该订单不在待确认或争议处理状态");
      const evidence = await tx.learningPaymentEvidence.findUnique({ where: { id: evidenceId } });
      if (!evidence || evidence.commerceOrderId !== commerceOrderId || evidence.status !== "submitted") {
        throw Errors.conflict("付款凭证状态已经变化");
      }
      const now = new Date();
      assertTransition(row.status, "pending_payment");
      await tx.learningPaymentEvidence.update({
        where: { id: evidenceId },
        data: {
          status: "rejected",
          handledById: actor.userId,
          handledReason: reason,
          handledAt: now,
        },
      });
      await tx.learningCommerceOrder.update({
        where: { id: commerceOrderId },
        data: {
          status: "pending_payment",
          statusVersion: { increment: 1 },
          paymentDueAt: new Date(now.getTime() + LEARNING_PAYMENT_DUE_MS),
          sellerResponseDueAt: null,
        },
      });
      await tx.marketOrder.update({
        where: { id: row.orderId },
        data: {
          status: "pending_payment",
          expiresAt: new Date(now.getTime() + LEARNING_PAYMENT_DUE_MS),
        },
      });
      if (row.status === "disputed") {
        await tx.learningOrderIssue.updateMany({
          where: {
            commerceOrderId,
            status: { in: [...ACTIVE_ISSUE_STATUSES] },
          },
          data: {
            status: "resolved",
            resolvedById: actor.userId,
            resolvedAt: now,
            resolution: `付款凭证未核实通过：${reason}`,
          },
        });
      }
      await appendOrderEvents(tx, commerceOrderId, [{
        type: "PAYMENT_EVIDENCE_REJECTED",
        actorId: actor.userId,
        fromStatus: row.status,
        toStatus: "pending_payment",
        requestId: actor.requestId,
        detail: { evidenceId, reason },
      }]);
      const updated = await findCommerceOrderOrThrow(tx, commerceOrderId);
      return serializeCommerceOrder(updated, actor);
    },
  );
  const value: any = command.value;
  await notifyMarketUser(
    value.order.buyerId,
    "付款凭证未通过",
    reason,
    `/learning/orders/${commerceOrderId}`,
    { type: "learning-payment-evidence-rejected", commerceOrderId, evidenceId },
  );
  return value;
}

export async function completeLearningCommerceOrder(
  actor: LearningCommerceActor,
  commerceOrderId: number,
  idempotencyKey: string,
) {
  await requireVerifiedMarketUser(actor.userId, actor.role);
  const command = await executeIdempotentCommand(
    actor,
    `learning-order:complete:${commerceOrderId}`,
    idempotencyKey,
    {},
    async (tx) => {
      const current = await findCommerceOrderOrThrow(tx, commerceOrderId);
      await acquireMarketOrderLock(tx, current.orderId);
      const row = await findCommerceOrderOrThrow(tx, commerceOrderId);
      if (row.order.buyerId !== actor.userId && !["admin", "mod"].includes(actor.role)) {
        throw Errors.forbidden("只有订单买家可以确认完成");
      }
      if (row.status === "completed") return serializeCommerceOrder(row, actor);
      if (row.status !== "delivered") throw Errors.conflict("资料交付后才能确认完成");
      if (row.issues.some((issue: { status: string }) => ACTIVE_ISSUE_STATUSES.includes(issue.status as any))) {
        throw Errors.conflict("订单仍有未处理的售后或争议，处理完成后才能确认完成");
      }
      assertTransition(row.status, "completed");
      const now = new Date();
      await tx.learningCommerceOrder.update({
        where: { id: commerceOrderId },
        data: {
          status: "completed",
          statusVersion: { increment: 1 },
          completedAt: now,
          completionDueAt: null,
        },
      });
      await tx.marketOrder.update({
        where: { id: row.orderId },
        data: {
          status: "completed",
          completedAt: now,
          buyerConfirmedAt: now,
          closedAt: now,
        },
      });
      await appendOrderEvents(tx, commerceOrderId, [{
        type: "ORDER_COMPLETED",
        actorId: actor.userId,
        fromStatus: row.status,
        toStatus: "completed",
        requestId: actor.requestId,
      }]);
      const updated = await findCommerceOrderOrThrow(tx, commerceOrderId);
      return serializeCommerceOrder(updated, actor);
    },
  );
  return command.value;
}

export async function cancelLearningCommerceOrder(
  actor: LearningCommerceActor,
  commerceOrderId: number,
  reason: string,
  idempotencyKey: string,
) {
  await requireVerifiedMarketUser(actor.userId, actor.role);
  const command = await executeIdempotentCommand(
    actor,
    `learning-order:cancel:${commerceOrderId}`,
    idempotencyKey,
    { reason },
    async (tx) => {
      const current = await findCommerceOrderOrThrow(tx, commerceOrderId);
      await acquireMarketOrderLock(tx, current.orderId);
      const row = await findCommerceOrderOrThrow(tx, commerceOrderId);
      if (row.order.buyerId !== actor.userId && !["admin", "mod"].includes(actor.role)) {
        throw Errors.forbidden("只有订单买家可以取消未付款订单");
      }
      if (row.status === "cancelled") return serializeCommerceOrder(row, actor);
      if (row.status !== "pending_payment") throw Errors.conflict("提交付款凭证后不能直接取消，请发起争议");
      assertTransition(row.status, "cancelled");
      const now = new Date();
      await tx.learningCommerceOrder.update({
        where: { id: commerceOrderId },
        data: {
          status: "cancelled",
          statusVersion: { increment: 1 },
          cancelledAt: now,
          cancelReason: reason,
          paymentDueAt: null,
        },
      });
      await tx.marketOrder.update({
        where: { id: row.orderId },
        data: {
          status: "cancelled",
          cancelReason: reason,
          cancelledById: actor.userId,
          closedAt: now,
          expiresAt: null,
        },
      });
      await appendOrderEvents(tx, commerceOrderId, [{
        type: "ORDER_CANCELLED",
        actorId: actor.userId,
        fromStatus: row.status,
        toStatus: "cancelled",
        requestId: actor.requestId,
        detail: { reason },
      }]);
      const updated = await findCommerceOrderOrThrow(tx, commerceOrderId);
      return serializeCommerceOrder(updated, actor);
    },
  );
  return command.value;
}

export async function openLearningOrderIssue(
  actor: LearningCommerceActor,
  commerceOrderId: number,
  input: { type: string; reason: string; detail: string },
) {
  await requireVerifiedMarketUser(actor.userId, actor.role);
  const current = await findCommerceOrderOrThrow(prisma, commerceOrderId);
  ensureOrderParty(current, actor);
  if (["refunded", "cancelled", "expired"].includes(current.status)) throw Errors.conflict("已关闭订单不能发起争议");
  const issue = await prisma.$transaction(async (tx) => {
    await acquireMarketOrderLock(tx, current.orderId);
    const row = await findCommerceOrderOrThrow(tx, commerceOrderId);
    ensureOrderParty(row, actor);
    if (["refunded", "cancelled", "expired"].includes(row.status)) throw Errors.conflict("已关闭订单不能发起争议");
    const existing = await tx.learningOrderIssue.findFirst({
      where: {
        commerceOrderId,
        requestedById: actor.userId,
        type: input.type,
        status: { in: [...ACTIVE_ISSUE_STATUSES] },
      },
      orderBy: { createdAt: "desc" },
    });
    if (existing) return existing;
    const created = await tx.learningOrderIssue.create({
      data: {
        commerceOrderId,
        requestedById: actor.userId,
        type: input.type,
        reason: input.reason,
        detail: input.detail,
        status: input.type === "refund" ? "refund_requested" : "open",
      },
    });
    const shouldDispute = row.status === "awaiting_seller_confirmation"
      && ["payment", "refund"].includes(input.type);
    if (shouldDispute) {
      assertTransition(row.status, "disputed");
      await tx.learningCommerceOrder.update({
        where: { id: commerceOrderId },
        data: {
          status: "disputed",
          statusVersion: { increment: 1 },
          sellerResponseDueAt: null,
        },
      });
      await tx.marketOrder.update({
        where: { id: row.orderId },
        data: { status: "disputed", expiresAt: null },
      });
    }
    await appendOrderEvents(tx, commerceOrderId, [{
      type: "ISSUE_OPENED",
      actorId: actor.userId,
      fromStatus: row.status,
      toStatus: shouldDispute ? "disputed" : row.status,
      requestId: actor.requestId,
      detail: { issueId: created.id, type: input.type, reason: input.reason },
    }]);
    return created;
  });
  await notifyMarketUser(
    current.order.buyerId === actor.userId ? current.order.sellerId : current.order.buyerId,
    "学习资料订单发起了问题处理",
    input.reason,
    `/learning/orders/${commerceOrderId}`,
    { type: "learning-order-issue", commerceOrderId, issueId: issue.id },
  );
  return issue;
}

export async function listLearningOrderIssues(
  actor: LearningCommerceActor,
  status: "active" | "resolved" | "all" = "active",
) {
  if (!["admin", "mod"].includes(actor.role)) throw Errors.forbidden("仅审核人员可以查看学习资料售后队列");
  const where: Prisma.LearningOrderIssueWhereInput | undefined = status === "active"
    ? { status: { in: ACTIVE_ISSUE_STATUSES } }
    : status === "resolved"
      ? { status: { in: ["refund_recorded", "resolved", "closed"] as LearningOrderIssueStatus[] } }
      : undefined;
  const rows = await prisma.learningOrderIssue.findMany({
    where,
    include: {
      requestedBy: { select: publicUserSelect },
      resolvedBy: { select: publicUserSelect },
      commerceOrder: { include: commerceOrderInclude },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 200,
  });
  return rows.map((row) => ({
    id: row.id,
    commerceOrderId: row.commerceOrderId,
    requestedById: row.requestedById,
    requestedBy: row.requestedBy,
    resolvedBy: row.resolvedBy,
    type: row.type,
    status: row.status,
    reason: row.reason,
    detail: row.detail,
    refundAmountCents: row.refundAmountCents,
    refundAmount: row.refundAmountCents == null ? null : amountCentsToMoney(row.refundAmountCents),
    resolution: row.resolution,
    resolvedAt: row.resolvedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    order: serializeCommerceOrder(row.commerceOrder, actor),
  }));
}

export async function decideLearningOrderIssue(
  actor: LearningCommerceActor,
  commerceOrderId: number,
  issueId: number,
  input: {
    action: "resolve" | "close" | "record_refund";
    resolution: string;
    refundAmountCents?: number;
  },
) {
  if (!["admin", "mod"].includes(actor.role)) throw Errors.forbidden("仅审核人员可以处理学习资料售后");
  const current = await findCommerceOrderOrThrow(prisma, commerceOrderId);
  const result = await prisma.$transaction(async (tx) => {
    await acquireMarketOrderLock(tx, current.orderId);
    const row = await findCommerceOrderOrThrow(tx, commerceOrderId);
    const issue = await tx.learningOrderIssue.findFirst({
      where: {
        id: issueId,
        commerceOrderId,
        status: { in: [...ACTIVE_ISSUE_STATUSES] },
      },
    });
    if (!issue) throw Errors.conflict("该售后记录已处理或不存在");
    const now = new Date();

    if (input.action === "record_refund") {
      const refundAmountCents = input.refundAmountCents || 0;
      if (refundAmountCents < 1 || refundAmountCents > row.priceCents) {
        throw Errors.badRequest("退款金额必须大于 0 且不能超过订单实付金额");
      }
      if (!["awaiting_seller_confirmation", "disputed", "delivered", "completed"].includes(row.status)) {
        throw Errors.conflict("当前订单状态不能登记退款");
      }
      assertTransition(row.status, "refunded");
      await tx.learningOrderIssue.update({
        where: { id: issueId },
        data: {
          status: "refund_recorded",
          refundAmountCents,
          resolution: input.resolution,
          resolvedById: actor.userId,
          resolvedAt: now,
        },
      });
      await tx.learningOrderIssue.updateMany({
        where: {
          commerceOrderId,
          id: { not: issueId },
          status: { in: [...ACTIVE_ISSUE_STATUSES] },
        },
        data: {
          status: "closed",
          resolution: "订单已登记退款，其他进行中问题同步关闭",
          resolvedById: actor.userId,
          resolvedAt: now,
        },
      });
      await tx.learningMaterialAccess.updateMany({
        where: { orderId: row.orderId, revokedAt: null },
        data: { revokedAt: now },
      });
      await tx.learningCommerceOrder.update({
        where: { id: commerceOrderId },
        data: {
          status: "refunded",
          statusVersion: { increment: 1 },
          refundedAt: now,
          paymentDueAt: null,
          sellerResponseDueAt: null,
          completionDueAt: null,
        },
      });
      await tx.marketOrder.update({
        where: { id: row.orderId },
        data: {
          status: "refunded",
          refundedAt: now,
          closedAt: now,
          expiresAt: null,
        },
      });
      await appendOrderEvents(tx, commerceOrderId, [{
        type: "REFUND_RECORDED",
        actorId: actor.userId,
        fromStatus: row.status,
        toStatus: "refunded",
        requestId: actor.requestId,
        detail: { issueId, refundAmountCents, resolution: input.resolution },
      }]);
    } else {
      if (row.status === "disputed") {
        throw Errors.conflict("付款争议必须先核验最新付款凭证，并选择确认到账或驳回凭证");
      }
      await tx.learningOrderIssue.update({
        where: { id: issueId },
        data: {
          status: input.action === "resolve" ? "resolved" : "closed",
          resolution: input.resolution,
          resolvedById: actor.userId,
          resolvedAt: now,
        },
      });
      await appendOrderEvents(tx, commerceOrderId, [{
        type: input.action === "resolve" ? "ISSUE_RESOLVED" : "ISSUE_CLOSED",
        actorId: actor.userId,
        fromStatus: row.status,
        toStatus: row.status,
        requestId: actor.requestId,
        detail: { issueId, resolution: input.resolution },
      }]);
    }
    return serializeCommerceOrder(
      await findCommerceOrderOrThrow(tx, commerceOrderId),
      actor,
    );
  });
  await Promise.all([
    notifyMarketUser(
      result.order.buyerId,
      input.action === "record_refund" ? "学习资料订单已登记退款" : "学习资料售后已处理",
      input.resolution,
      `/learning/orders/${commerceOrderId}`,
      { type: "learning-order-issue-resolved", commerceOrderId, issueId, action: input.action },
    ),
    notifyMarketUser(
      result.order.sellerId,
      input.action === "record_refund" ? "学习资料订单已登记退款" : "学习资料售后已处理",
      input.resolution,
      `/learning/orders/${commerceOrderId}`,
      { type: "learning-order-issue-resolved", commerceOrderId, issueId, action: input.action },
    ),
  ]);
  return result;
}

export async function getAuthorizedLearningPrivateAsset(
  actor: LearningCommerceActor,
  assetId: number,
) {
  await requireVerifiedMarketUser(actor.userId, actor.role);
  const asset = await prisma.learningPrivateAsset.findUnique({
    where: { id: assetId },
    include: {
      collectionMethod: {
        select: { id: true, creatorId: true },
      },
      paymentEvidence: {
        include: {
          commerceOrder: {
            include: { order: { select: { buyerId: true, sellerId: true } } },
          },
        },
      },
      refundIssue: {
        include: {
          commerceOrder: {
            include: { order: { select: { buyerId: true, sellerId: true } } },
          },
        },
      },
    },
  });
  if (!asset || asset.status !== "active") throw Errors.notFound("私密文件不存在");
  const staff = ["admin", "mod"].includes(actor.role);
  const owner = asset.ownerId === actor.userId;
  const collectionParty = asset.collectionMethod
    ? Boolean(await prisma.learningCommerceOrder.findFirst({
      where: {
        collectionMethodId: asset.collectionMethod.id,
        OR: [
          { order: { sellerId: actor.userId } },
          {
            status: { in: ["pending_payment", "awaiting_seller_confirmation", "disputed"] },
            order: { buyerId: actor.userId },
          },
        ],
      },
      select: { id: true },
    }))
    : false;
  const evidenceParty = asset.paymentEvidence
    && (
      asset.paymentEvidence.commerceOrder.order.buyerId === actor.userId
      || asset.paymentEvidence.commerceOrder.order.sellerId === actor.userId
    );
  const issueParty = asset.refundIssue
    && (
      asset.refundIssue.commerceOrder.order.buyerId === actor.userId
      || asset.refundIssue.commerceOrder.order.sellerId === actor.userId
    );
  if (!staff && !owner && !collectionParty && !evidenceParty && !issueParty) {
    throw Errors.forbidden("无权查看该私密文件");
  }
  if (staff && !owner) {
    await prisma.adminActionLog.create({
      data: {
        actorId: actor.userId,
        action: "learning_private_asset_read",
        targetType: "LearningPrivateAsset",
        targetId: String(assetId),
        summary: "审核人员查看学习资料交易私密文件",
        detail: JSON.stringify({ kind: asset.kind }),
      },
    });
  }
  return asset;
}

export function learningCommerceModeIsPaid(mode: LearningMaterialCommerceMode | string | null | undefined) {
  return mode === "paid";
}
