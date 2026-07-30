import { Router } from "express";
import { authOptional, authRequired } from "../middleware/auth";
import { authRouter } from "./auth";
import { userRouter } from "./user";
import { homeRouter } from "./home";
import { boardRouter } from "./board";
import { topicRouter } from "./topic";
import { replyRouter } from "./reply";
import { likeRouter } from "./like";
import { courseRouter } from "./course";
import { servicesRouter } from "./services";
import { messageRouter } from "./message";
import { searchRouter } from "./search";
import { adminRouter } from "./admin";
import { siteRouter } from "./site";
import { uploadRouter } from "./upload";
import { toolsRouter } from "./tools";
import { paymentsRouter } from "./payments";
import { storageRouter } from "./storage";
import { weiwallAuthRouter } from "./weiwallAuth";
import { courseBotRouter } from "./courseBot";
import { ehallRouter } from "./ehall";
import { academicRouter } from "./academic";
import { marketRouter } from "./market";
import { productAnalyticsRouter } from "./productAnalytics";

export const router = Router();

// 公开路径
router.use("/auth", authRouter);
router.use("/boards", authOptional, boardRouter);
router.use("/topics", authOptional, topicRouter);
router.use("/replies", authOptional, replyRouter);
router.use("/services", servicesRouter);
router.use("/courses", courseRouter);
router.use("/search", searchRouter);
router.use("/home", authOptional, homeRouter);
router.use("/site", siteRouter);
router.use("/storage", storageRouter);
router.use("/tools", toolsRouter);
router.use("/payments", paymentsRouter);
router.use("/weiwall-auth", weiwallAuthRouter);
router.use("/course-bot", authRequired, courseBotRouter);
router.use("/ehall", authRequired, ehallRouter);
router.use("/academic", authRequired, academicRouter);
router.use("/market", marketRouter);
router.use("/product", authRequired, productAnalyticsRouter);

// 站内登录后
router.use("/user", authRequired, userRouter);
router.use("/likes", authRequired, likeRouter);
router.use("/messages", authRequired, messageRouter);
router.use("/uploads", uploadRouter);

// 管理后台：需登录 + 内部按 role 分级
router.use("/admin", authRequired, adminRouter);
