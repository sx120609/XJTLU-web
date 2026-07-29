import { Router, type RequestHandler } from "express";
import multer from "multer";
import { authRequired } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { requestIdFromResponse } from "../middleware/requestObservability";
import { Errors, ok } from "../utils/response";
import { positiveRouteInteger } from "../utils/query";
import {
  cancelLearningOrderSchema,
  collectionMethodMetadataSchema,
  createLearningOrderSchema,
  creatorApplicationInputSchema,
  creatorApplicationReviewSchema,
  learningOrderIssueDecisionSchema,
  learningOrderIssueInputSchema,
  learningOrderIssueMessageSchema,
  learningMaterialRatingSchema,
  learningCreatorAppealDecisionSchema,
  learningCreatorAppealSchema,
  learningCreatorViolationSchema,
  materialReviewDecisionSchema,
  normalizeIdempotencyKey,
  paymentEvidenceMetadataSchema,
  rejectPaymentEvidenceSchema,
} from "../services/learningCommerceContracts";
import {
  cancelLearningCommerceOrder,
  addLearningOrderIssueMessage,
  claimLearningOrderIssue,
  completeLearningCommerceOrder,
  confirmPaymentEvidence,
  createCollectionMethod,
  createPaidLearningOrder,
  decideLearningOrderIssue,
  decideMaterialReview,
  disableCollectionMethod,
  getAuthorizedLearningPrivateAsset,
  getLearningCommerceOrder,
  getLearningCreatorContext,
  getLearningOperationsOverview,
  learningCommercePublicStatus,
  listCreatorApplications,
  listLearningCommerceOrders,
  listLearningOrderIssues,
  listMaterialReviews,
  openLearningOrderIssue,
  rejectPaymentEvidence,
  reviewCreatorApplication,
  submitLearningCreatorApplication,
  submitMaterialVersionReview,
  submitPaymentEvidence,
  type LearningCommerceActor,
} from "../services/learningCommerceService";
import {
  MAX_LEARNING_PRIVATE_ASSET_BYTES,
  prepareLearningPrivateAsset,
  resolveLearningPrivateAssetPath,
} from "../services/learningPrivateAssetService";
import {
  appealLearningCreatorViolation,
  createLearningCreatorViolation,
  decideLearningCreatorAppeal,
  listLearningCreatorViolations,
  rateLearningMaterialOrder,
} from "../services/learningTrustService";

export const learningCommerceRouter = Router();

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fileSize: MAX_LEARNING_PRIVATE_ASSET_BYTES },
});

const staffRequired: RequestHandler = (req, _res, next) => {
  if (!req.user || !["admin", "mod"].includes(req.user.role)) {
    return next(Errors.forbidden("需要学习资料审核权限"));
  }
  next();
};

function actor(req: any, res: any): LearningCommerceActor {
  return {
    userId: req.user.userId,
    role: req.user.role,
    requestId: requestIdFromResponse(res),
  };
}

function routeId(value: unknown, label: string) {
  const id = positiveRouteInteger(value);
  if (!id) throw Errors.badRequest(`${label}不合法`);
  return id;
}

function idempotencyKey(req: any) {
  const key = normalizeIdempotencyKey(req.headers["idempotency-key"]);
  if (!key) throw Errors.badRequest("请提供有效的 Idempotency-Key 请求头");
  return key;
}

function parseSingleImage(req: any, res: any, next: any) {
  imageUpload.single("image")(req, res, (error: any) => {
    if (!error) return next();
    if (error?.code === "LIMIT_FILE_SIZE") return next(Errors.badRequest("图片大小不能超过 5MB"));
    if (error?.code === "LIMIT_FILE_COUNT" || error?.code === "LIMIT_UNEXPECTED_FILE") {
      return next(Errors.badRequest("每次只能上传一张图片，字段名必须为 image"));
    }
    return next(error);
  });
}

learningCommerceRouter.get("/status", (_req, res) => {
  ok(res, learningCommercePublicStatus());
});

learningCommerceRouter.get("/creator/me", authRequired, async (req, res, next) => {
  try {
    ok(res, await getLearningCreatorContext(actor(req, res)));
  } catch (error) { next(error); }
});

learningCommerceRouter.post(
  "/creator/applications",
  authRequired,
  validate(creatorApplicationInputSchema),
  async (req, res, next) => {
    try {
      ok(res, await submitLearningCreatorApplication(actor(req, res), req.body));
    } catch (error) { next(error); }
  },
);

learningCommerceRouter.post(
  "/creator/collection-methods",
  authRequired,
  parseSingleImage,
  async (req, res, next) => {
    try {
      const input = collectionMethodMetadataSchema.parse({
        provider: req.body.provider,
        label: req.body.label,
      });
      const prepared = await prepareLearningPrivateAsset(
        req.user!.userId,
        "collection_qr",
        req.file as any,
      );
      const method = await createCollectionMethod(actor(req, res), input, prepared);
      ok(res, {
        ...method,
        qrImageUrl: `/api/market/materials/commerce/private-assets/${method.assetId}`,
      });
    } catch (error) { next(error); }
  },
);

learningCommerceRouter.delete(
  "/creator/collection-methods/:id",
  authRequired,
  async (req, res, next) => {
    try {
      ok(res, await disableCollectionMethod(
        actor(req, res),
        routeId(req.params.id, "收款方式 ID"),
      ));
    } catch (error) { next(error); }
  },
);

learningCommerceRouter.post(
  "/items/:itemId/versions/:versionId/reviews",
  authRequired,
  async (req, res, next) => {
    try {
      ok(res, await submitMaterialVersionReview(
        actor(req, res),
        routeId(req.params.itemId, "资料 ID"),
        routeId(req.params.versionId, "版本 ID"),
      ));
    } catch (error) { next(error); }
  },
);

learningCommerceRouter.post(
  "/items/:itemId/orders",
  authRequired,
  validate(createLearningOrderSchema),
  async (req, res, next) => {
    try {
      ok(res, await createPaidLearningOrder(
        actor(req, res),
        routeId(req.params.itemId, "资料 ID"),
        req.body,
        idempotencyKey(req),
      ));
    } catch (error) { next(error); }
  },
);

learningCommerceRouter.get("/orders", authRequired, async (req, res, next) => {
  try {
    const side = req.query.side === "seller"
      ? "seller"
      : req.query.side === "all" && ["admin", "mod"].includes(req.user!.role)
        ? "all"
        : "buyer";
    ok(res, await listLearningCommerceOrders(actor(req, res), side));
  } catch (error) { next(error); }
});

learningCommerceRouter.get("/orders/:id", authRequired, async (req, res, next) => {
  try {
    ok(res, await getLearningCommerceOrder(
      actor(req, res),
      routeId(req.params.id, "订单 ID"),
    ));
  } catch (error) { next(error); }
});

learningCommerceRouter.post(
  "/orders/:id/payment-evidence",
  authRequired,
  parseSingleImage,
  async (req, res, next) => {
    try {
      const input = paymentEvidenceMetadataSchema.parse({
        claimedPaidAt: req.body.claimedPaidAt || undefined,
        buyerNote: req.body.buyerNote,
      });
      const prepared = await prepareLearningPrivateAsset(
        req.user!.userId,
        "payment_evidence",
        req.file as any,
      );
      ok(res, await submitPaymentEvidence(
        actor(req, res),
        routeId(req.params.id, "订单 ID"),
        input,
        prepared,
        idempotencyKey(req),
      ));
    } catch (error) { next(error); }
  },
);

learningCommerceRouter.post(
  "/orders/:id/payment-evidence/:evidenceId/confirm",
  authRequired,
  async (req, res, next) => {
    try {
      ok(res, await confirmPaymentEvidence(
        actor(req, res),
        routeId(req.params.id, "订单 ID"),
        routeId(req.params.evidenceId, "付款凭证 ID"),
        idempotencyKey(req),
      ));
    } catch (error) { next(error); }
  },
);

learningCommerceRouter.post(
  "/orders/:id/payment-evidence/:evidenceId/reject",
  authRequired,
  validate(rejectPaymentEvidenceSchema),
  async (req, res, next) => {
    try {
      ok(res, await rejectPaymentEvidence(
        actor(req, res),
        routeId(req.params.id, "订单 ID"),
        routeId(req.params.evidenceId, "付款凭证 ID"),
        req.body.reason,
        idempotencyKey(req),
      ));
    } catch (error) { next(error); }
  },
);

learningCommerceRouter.post("/orders/:id/complete", authRequired, async (req, res, next) => {
  try {
    ok(res, await completeLearningCommerceOrder(
      actor(req, res),
      routeId(req.params.id, "订单 ID"),
      idempotencyKey(req),
    ));
  } catch (error) { next(error); }
});

learningCommerceRouter.put(
  "/orders/:id/rating",
  authRequired,
  validate(learningMaterialRatingSchema),
  async (req, res, next) => {
    try {
      ok(res, await rateLearningMaterialOrder(
        actor(req, res),
        routeId(req.params.id, "订单 ID"),
        req.body,
      ));
    } catch (error) { next(error); }
  },
);

learningCommerceRouter.post(
  "/orders/:id/cancel",
  authRequired,
  validate(cancelLearningOrderSchema),
  async (req, res, next) => {
    try {
      ok(res, await cancelLearningCommerceOrder(
        actor(req, res),
        routeId(req.params.id, "订单 ID"),
        req.body.reason,
        idempotencyKey(req),
      ));
    } catch (error) { next(error); }
  },
);

learningCommerceRouter.post(
  "/orders/:id/issues",
  authRequired,
  validate(learningOrderIssueInputSchema),
  async (req, res, next) => {
    try {
      ok(res, await openLearningOrderIssue(
        actor(req, res),
        routeId(req.params.id, "订单 ID"),
        req.body,
      ));
    } catch (error) { next(error); }
  },
);

learningCommerceRouter.post(
  "/orders/:id/issues/:issueId/messages",
  authRequired,
  parseSingleImage,
  async (req, res, next) => {
    try {
      const input = learningOrderIssueMessageSchema.parse({
        content: req.body.content,
        attachmentKind: req.body.attachmentKind || undefined,
      });
      if (!input.content && !req.file) throw Errors.badRequest("请填写沟通内容或上传证据图片");
      const prepared = req.file
        ? await prepareLearningPrivateAsset(
          req.user!.userId,
          input.attachmentKind,
          req.file as any,
        )
        : undefined;
      ok(res, await addLearningOrderIssueMessage(
        actor(req, res),
        routeId(req.params.id, "订单 ID"),
        routeId(req.params.issueId, "售后 ID"),
        { content: input.content },
        prepared,
      ));
    } catch (error) { next(error); }
  },
);

learningCommerceRouter.get(
  "/private-assets/:id",
  authRequired,
  async (req, res, next) => {
    try {
      const asset = await getAuthorizedLearningPrivateAsset(
        actor(req, res),
        routeId(req.params.id, "私密文件 ID"),
      );
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Type", asset.mimeType);
      res.setHeader(
        "Content-Disposition",
        `inline; filename*=UTF-8''${encodeURIComponent(asset.originalName)}`,
      );
      res.sendFile(resolveLearningPrivateAssetPath(asset.relativePath));
    } catch (error) { next(error); }
  },
);

learningCommerceRouter.get(
  "/admin/creator-applications",
  authRequired,
  staffRequired,
  async (req, res, next) => {
    try {
      ok(res, await listCreatorApplications(
        typeof req.query.status === "string" ? req.query.status : undefined,
      ));
    } catch (error) { next(error); }
  },
);

learningCommerceRouter.patch(
  "/admin/creator-applications/:id",
  authRequired,
  staffRequired,
  validate(creatorApplicationReviewSchema),
  async (req, res, next) => {
    try {
      ok(res, await reviewCreatorApplication(
        actor(req, res),
        routeId(req.params.id, "创作者申请 ID"),
        req.body,
      ));
    } catch (error) { next(error); }
  },
);

learningCommerceRouter.get(
  "/admin/material-reviews",
  authRequired,
  staffRequired,
  async (req, res, next) => {
    try {
      ok(res, await listMaterialReviews(
        typeof req.query.status === "string" ? req.query.status : undefined,
      ));
    } catch (error) { next(error); }
  },
);

learningCommerceRouter.patch(
  "/admin/material-reviews/:id",
  authRequired,
  staffRequired,
  validate(materialReviewDecisionSchema),
  async (req, res, next) => {
    try {
      ok(res, await decideMaterialReview(
        actor(req, res),
        routeId(req.params.id, "资料审核 ID"),
        req.body,
      ));
    } catch (error) { next(error); }
  },
);

learningCommerceRouter.get(
  "/admin/issues",
  authRequired,
  staffRequired,
  async (req, res, next) => {
    try {
      const status = req.query.status === "resolved" || req.query.status === "all"
        ? req.query.status
        : "active";
      ok(res, await listLearningOrderIssues(actor(req, res), status));
    } catch (error) { next(error); }
  },
);

learningCommerceRouter.get(
  "/admin/operations",
  authRequired,
  staffRequired,
  async (req, res, next) => {
    try {
      ok(res, await getLearningOperationsOverview(actor(req, res)));
    } catch (error) { next(error); }
  },
);

learningCommerceRouter.get(
  "/creator/violations",
  authRequired,
  async (req, res, next) => {
    try {
      ok(res, await listLearningCreatorViolations(actor(req, res)));
    } catch (error) { next(error); }
  },
);

learningCommerceRouter.post(
  "/creator/violations/:id/appeal",
  authRequired,
  validate(learningCreatorAppealSchema),
  async (req, res, next) => {
    try {
      ok(res, await appealLearningCreatorViolation(
        actor(req, res),
        routeId(req.params.id, "违规记录 ID"),
        req.body.content,
      ));
    } catch (error) { next(error); }
  },
);

learningCommerceRouter.get(
  "/admin/creator-violations",
  authRequired,
  staffRequired,
  async (req, res, next) => {
    try {
      const creatorId = positiveRouteInteger(req.query.creatorId);
      ok(res, await listLearningCreatorViolations(actor(req, res), creatorId || undefined));
    } catch (error) { next(error); }
  },
);

learningCommerceRouter.post(
  "/admin/creator-violations",
  authRequired,
  staffRequired,
  validate(learningCreatorViolationSchema),
  async (req, res, next) => {
    try {
      ok(res, await createLearningCreatorViolation(actor(req, res), req.body));
    } catch (error) { next(error); }
  },
);

learningCommerceRouter.patch(
  "/admin/creator-appeals/:id",
  authRequired,
  staffRequired,
  validate(learningCreatorAppealDecisionSchema),
  async (req, res, next) => {
    try {
      ok(res, await decideLearningCreatorAppeal(
        actor(req, res),
        routeId(req.params.id, "申诉 ID"),
        req.body,
      ));
    } catch (error) { next(error); }
  },
);

learningCommerceRouter.patch(
  "/admin/orders/:orderId/issues/:issueId",
  authRequired,
  staffRequired,
  validate(learningOrderIssueDecisionSchema),
  async (req, res, next) => {
    try {
      ok(res, await decideLearningOrderIssue(
        actor(req, res),
        routeId(req.params.orderId, "订单 ID"),
        routeId(req.params.issueId, "售后 ID"),
        req.body,
      ));
    } catch (error) { next(error); }
  },
);

learningCommerceRouter.post(
  "/admin/orders/:orderId/issues/:issueId/claim",
  authRequired,
  staffRequired,
  async (req, res, next) => {
    try {
      ok(res, await claimLearningOrderIssue(
        actor(req, res),
        routeId(req.params.orderId, "订单 ID"),
        routeId(req.params.issueId, "售后 ID"),
      ));
    } catch (error) { next(error); }
  },
);
