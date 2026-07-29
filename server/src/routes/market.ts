import { Router } from "express";
import { authOptional } from "../middleware/auth";
import { learningMaterialsRouter } from "./learningMaterials";
import { learningCommerceRouter } from "./learningCommerce";
import { marketAdminRouter } from "./marketAdmin";
import { marketCatalogRouter } from "./marketCatalog";
import { marketConversationRouter } from "./marketConversation";
import { marketGovernanceRouter } from "./marketGovernance";
import { marketItemWriteRouter } from "./marketItemWrite";
import { marketOrderRouter } from "./marketOrder";
import { marketPaymentRouter } from "./marketPayment";
import { marketPromotionsRouter } from "./marketPromotions";
import { marketTradeRouter } from "./marketTrade";
import { marketWantedCatalogRouter } from "./marketWantedCatalog";
import { marketWantedResponseRouter } from "./marketWantedResponse";
import { marketWantedWriteRouter } from "./marketWantedWrite";
import { marketWorkspaceRouter } from "./marketWorkspace";

export const marketRouter = Router();

marketRouter.use(authOptional);
marketRouter.use((_req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  next();
});

marketRouter.use("/", marketCatalogRouter);
marketRouter.use("/", marketItemWriteRouter);
marketRouter.use("/", marketWantedCatalogRouter);
marketRouter.use("/", marketWantedWriteRouter);
marketRouter.use("/", marketWantedResponseRouter);
marketRouter.use("/", marketTradeRouter);
marketRouter.use("/", marketOrderRouter);
marketRouter.use("/", marketConversationRouter);
marketRouter.use("/", marketGovernanceRouter);
marketRouter.use("/", marketWorkspaceRouter);
marketRouter.use("/", marketPaymentRouter);
marketRouter.use("/", marketAdminRouter);
marketRouter.use("/materials/commerce", learningCommerceRouter);
marketRouter.use("/materials", learningMaterialsRouter);
marketRouter.use("/", marketPromotionsRouter);
