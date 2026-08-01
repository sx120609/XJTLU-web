import { Router, type Request } from "express";
import { managementPermission, managementRequired } from "../middleware/managementAuth";
import { validate } from "../middleware/validate";
import { materialReviewDecisionSchema } from "../services/learningCommerceContracts";
import { decideMaterialReview, listMaterialReviews } from "../services/learningCommerceService";
import {
  decideManagementMarketReview,
  listManagementMarketReviews,
  managementMarketReviewDecisionSchema,
  managementMarketReviewQuerySchema,
  managementRouteId,
  type ManagementMarketReviewQuery,
} from "../services/managementCommerceService";
import { Errors, ok } from "../utils/response";

export const managementCommerceRouter = Router();

function actor(req: Request) {
  if (!req.management) throw Errors.unauthorized("请先登录管理后台");
  return req.management;
}

managementCommerceRouter.use(managementRequired);

managementCommerceRouter.get(
  "/market/reviews",
  managementPermission("market.review"),
  validate(managementMarketReviewQuerySchema, "query"),
  async (req, res, next) => {
    try {
      ok(res, await listManagementMarketReviews(req.query as unknown as ManagementMarketReviewQuery));
    } catch (error) { next(error); }
  },
);

managementCommerceRouter.patch(
  "/market/reviews/:id",
  managementPermission("market.review"),
  validate(managementMarketReviewDecisionSchema),
  async (req, res, next) => {
    try {
      ok(res, await decideManagementMarketReview(
        actor(req),
        managementRouteId(req.params.id, "商品"),
        req.body,
        req.ip || "",
      ));
    } catch (error) { next(error); }
  },
);

managementCommerceRouter.get(
  "/learning/reviews",
  managementPermission("learning.review"),
  async (req, res, next) => {
    try {
      const status = typeof req.query.status === "string" ? req.query.status : "submitted";
      ok(res, await listMaterialReviews(status));
    } catch (error) { next(error); }
  },
);

managementCommerceRouter.patch(
  "/learning/reviews/:id",
  managementPermission("learning.review"),
  validate(materialReviewDecisionSchema),
  async (req, res, next) => {
    try {
      ok(res, await decideMaterialReview(
        actor(req),
        managementRouteId(req.params.id, "资料审核"),
        req.body,
        req.ip || "",
      ));
    } catch (error) { next(error); }
  },
);
