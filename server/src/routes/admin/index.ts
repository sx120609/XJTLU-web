import { Router } from "express";
import { adminOnly } from "../../middleware/admin";
import { adminBoardRouter } from "./boards";
import { adminContentRouter } from "./content";
import { adminForumRouter } from "./forum";
import { adminOverviewRouter } from "./overview";
import { adminPaymentRouter } from "./payments";
import { qqBotAdminRouter } from "./qqbot";
import { adminSiteRouter } from "./site";
import { adminStorageRouter } from "./storage";
import { adminSystemRouter } from "./system";
import { adminUserRouter } from "./users";

export const adminRouter = Router();

adminRouter.use("/qqbot", adminOnly, qqBotAdminRouter);
adminRouter.use("/", adminSystemRouter);
adminRouter.use("/", adminUserRouter);
adminRouter.use("/", adminForumRouter);
adminRouter.use("/", adminBoardRouter);
adminRouter.use("/", adminContentRouter);
adminRouter.use("/", adminPaymentRouter);
adminRouter.use("/", adminOverviewRouter);
adminRouter.use("/", adminSiteRouter);
adminRouter.use("/", adminStorageRouter);
