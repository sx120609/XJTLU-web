import { Router } from "express";
import { managementPermission, managementRequired } from "../middleware/managementAuth";
import { getManagementOverview } from "../services/managementOverviewService";
import { ok } from "../utils/response";

export const managementOverviewRouter = Router();

managementOverviewRouter.get(
  "/overview",
  managementRequired,
  managementPermission("dashboard.read"),
  async (_req, res, next) => {
    try { ok(res, await getManagementOverview()); } catch (error) { next(error); }
  },
);
