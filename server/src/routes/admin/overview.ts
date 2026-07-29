import { Router, type Request } from "express";
import { modOrAbove } from "../../middleware/admin";
import { getAdminOverview } from "../../services/adminOverviewService";
import { ok } from "../../utils/response";

export const adminOverviewRouter = Router();

function actor(req: Request) {
  return { role: req.user!.role };
}

adminOverviewRouter.get(
  "/overview",
  modOrAbove,
  async (req, res, next) => {
    try {
      ok(res, await getAdminOverview(actor(req)));
    } catch (error) {
      next(error);
    }
  },
);
