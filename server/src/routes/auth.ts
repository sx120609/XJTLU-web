import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { signToken } from "../utils/jwt";
import { hashPassword, verifyPassword } from "../utils/password";
import { Errors, ok } from "../utils/response";
import { validate } from "../middleware/validate";
import { authRequired } from "../middleware/auth";
import { releaseExpiredMutes } from "../services/userModeration";
import { isDev } from "../config";
import { detectLoginClient } from "../utils/loginClient";
import { buildSelfUser } from "../utils/publicUser";
import { recordAdminDailyLogin } from "../services/adminStats";
import {
  beginXjtluLogin,
  checkXjtluSlider,
  sendXjtluMfaCode,
  startXjtluLoginSessionFinalize,
  submitXjtluLogin,
  submitXjtluMfa,
} from "../services/xjtluSsoClient";
import { clearXjtluEhallSession } from "../services/xjtluEhallClient";
import { clearXjtluEbridgeSession } from "../services/xjtluEbridgeClient";
import {
  enforceSchoolAuthAccountRateLimit,
  enforceSchoolAuthGlobalRateLimit,
  enforceSchoolAuthRateLimit,
  enforceSchoolAuthSourceRateLimit,
} from "../services/schoolAuthRateLimit";
import { isCookieAuthRequest, issueBrowserSession, revokeBrowserSession } from "../services/browserSession";

export const authRouter = Router();

const loginSchema = z.object({
  username: z.string().min(1, "请输入用户名"),
  password: z.string().min(1, "请输入密码"),
});

const registerSchema = z.object({
  username: z.string().min(3, "用户名至少 3 位").max(20).regex(/^[a-zA-Z0-9_]+$/, "用户名仅允许英文/数字/下划线"),
  password: z.string().min(6, "密码至少 6 位").max(64),
  nickname: z.string().min(1, "请填写昵称").max(20),
  college: z.string().max(40).optional(),
  enrollYear: z.number().int().min(2000).max(2100).optional(),
});

// 本地账号只用于开发调试；生产环境固定使用 XJTLU 统一认证。
authRouter.post("/login", validate(loginSchema), async (req, res, next) => {
  try {
    if (!isDev) throw Errors.forbidden("生产环境仅支持 XJTLU 统一认证登录");
    const { username, password } = req.body;
    await releaseExpiredMutes();
    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) throw Errors.badRequest("用户名或密码错误");
    if (user.studentSso) throw Errors.badRequest("该账号已绑定学校认证，请用「学校账号登录」入口");
    const ok2 = await verifyPassword(password, user.passwordHash);
    if (!ok2) throw Errors.badRequest("用户名或密码错误");
    if (user.status === "banned") throw Errors.forbidden("账号已被封禁");
    const client = detectLoginClient(req);
    const logged = await prisma.user.update({
      where: { id: user.id },
      data: {
        lastSeenAt: new Date(),
        lastLoginAt: new Date(),
        lastLoginClient: client.client,
        usedIosClient: client.client === "ios" ? true : undefined,
        usedAndroidClient: client.client === "android" ? true : undefined,
        usedHarmonyClient: client.client === "harmony" ? true : undefined,
      },
    });

    const token = signToken({
      userId: user.id,
      studentId: user.username,
      role: user.role,
      campus: "",
    });
    await recordAdminDailyLogin(logged.id, logged.lastLoginAt ?? new Date(), client.client).catch((error) => {
      console.warn("[admin-stats] failed to record login", error);
    });
    if (isCookieAuthRequest(req)) {
      await issueBrowserSession(res, { siteToken: token, persistent: true });
      ok(res, { sessionAuthenticated: true, user: buildSelfUser(logged) });
    } else {
      ok(res, { token, user: buildSelfUser(logged) });
    }
  } catch (e) { next(e); }
});

// 旧式注册（保留给开发，前端不暴露入口）
authRouter.post("/register", validate(registerSchema), async (req, res, next) => {
  try {
    if (!isDev) throw Errors.forbidden("仅支持学校账号登录");
    const { username, password, nickname, college, enrollYear } = req.body;
    const exists = await prisma.user.findUnique({ where: { username } });
    if (exists) throw Errors.conflict("该用户名已被占用");
    const passwordHash = await hashPassword(password);
    const client = detectLoginClient(req);
    const user = await prisma.user.create({
      data: {
        username,
        passwordHash,
        nickname,
        college,
        enrollYear,
        lastSeenAt: new Date(),
        lastLoginAt: new Date(),
        lastLoginClient: client.client,
        usedIosClient: client.client === "ios",
        usedAndroidClient: client.client === "android",
        usedHarmonyClient: client.client === "harmony",
      },
    });
    await prisma.messageSetting.create({ data: { userId: user.id } });
    const token = signToken({ userId: user.id, studentId: user.username, role: user.role, campus: "" });
    await recordAdminDailyLogin(user.id, user.lastLoginAt ?? new Date(), client.client).catch((error) => {
      console.warn("[admin-stats] failed to record register login", error);
    });
    if (isCookieAuthRequest(req)) {
      await issueBrowserSession(res, { siteToken: token, persistent: true });
      ok(res, { sessionAuthenticated: true, user: buildSelfUser(user) });
    } else {
      ok(res, { token, user: buildSelfUser(user) });
    }
  } catch (e) { next(e); }
});

async function finishXjtluSiteLogin(
  req: Request,
  res: Response,
  sourceUsername: string,
  pendingId: string,
  remember: boolean,
) {
  const studentId = sourceUsername.trim().toLowerCase();
  let user = await prisma.user.findUnique({ where: { username: studentId } });
  const dummyHash = "$$sso$$";

  if (!user) {
    user = await prisma.user.create({
      data: {
        username: studentId,
        passwordHash: dummyHash,
        nickname: "",
        studentSso: true,
        role: "user",
      },
    });
    await prisma.messageSetting.create({ data: { userId: user.id } });
  } else if (!user.studentSso) {
    throw Errors.conflict("该 XJTLU 账号标识与现有站内账号冲突，请联系管理员处理");
  }

  await releaseExpiredMutes();
  if (user.status === "banned") throw Errors.forbidden("账号已被封禁");
  const client = detectLoginClient(req);
  user = await prisma.user.update({
    where: { id: user.id },
    data: {
      lastSeenAt: new Date(),
      lastLoginAt: new Date(),
      lastLoginClient: client.client,
      usedIosClient: client.client === "ios" ? true : undefined,
      usedAndroidClient: client.client === "android" ? true : undefined,
      usedHarmonyClient: client.client === "harmony" ? true : undefined,
    },
  });
  const siteToken = signToken({
    userId: user.id,
    studentId: user.username,
    role: user.role,
    campus: "",
  });
  await recordAdminDailyLogin(user.id, user.lastLoginAt ?? new Date(), client.client).catch((error) => {
    console.warn("[admin-stats] failed to record sso login", error);
  });
  if (isCookieAuthRequest(req)) {
    if (req.browserSession) await revokeBrowserSession(req, res);
    await issueBrowserSession(res, { siteToken, persistent: remember });
    startXjtluLoginSessionFinalize({ pendingId, userId: user.id, username: studentId });
    return ok(res, {
      ok: true,
      sessionAuthenticated: true,
      user: buildSelfUser(user),
      needNickname: !user.nickname || user.nickname.trim() === "",
      portalReady: false,
      portalConnecting: true,
    });
  }
  startXjtluLoginSessionFinalize({ pendingId, userId: user.id, username: studentId });
  return ok(res, {
    ok: true,
    siteToken,
    user: buildSelfUser(user),
    needNickname: !user.nickname || user.nickname.trim() === "",
    portalReady: false,
    portalConnecting: true,
  });
}

// ============ 学校 SSO 登录（主路径）============

/** 第一步：初始化 XJTLU ParaSSO 会话并取得一次性公钥。 */
authRouter.post("/xjtlu-sso-begin", async (req, res, next) => {
  try {
    await enforceSchoolAuthRateLimit(req, "begin");
    ok(res, await beginXjtluLogin());
  } catch (e) { next(e); }
});

/** 校验 XJTLU 风控滑块，成功后返回一次性 vcode 供登录请求继续使用。 */
authRouter.post(
  "/xjtlu-sso-slider-check",
  validate(z.object({
    school: z.literal("xjtlu"),
    pendingId: z.string().regex(/^[a-f0-9]{48}$/i),
    x: z.number().finite().min(0).max(4096),
    y: z.number().finite().min(0).max(4096),
    token: z.string().min(1).max(512),
  })),
  async (req, res, next) => {
    try {
      await enforceSchoolAuthSourceRateLimit(req, "submit");
      await enforceSchoolAuthGlobalRateLimit("submit");
      ok(res, await checkXjtluSlider(req.body));
    } catch (e) { next(e); }
  },
);

/**
 * 第二步：用 XJTLU 账号完成验证 → 自动建/复用 User → 返回站内 JWT。
 */
authRouter.post(
  "/xjtlu-sso-login",
  validate(z.object({
    school: z.literal("xjtlu"),
    // 兼容旧页面/并发初始化尚未拿到 pendingId 的情况；路由内会自动补一次 begin。
    pendingId: z.string().max(2048).optional().default(""),
    username: z.string().min(1).max(64),
    password: z.string().min(1).max(100),
    captcha: z.string().max(16).optional(),
    verificationToken: z.string().max(1024).optional(),
    remember: z.boolean().optional().default(false),
  })),
  async (req, res, next) => {
    try {
      let { pendingId } = req.body;
      const { username, password } = req.body;
      await enforceSchoolAuthSourceRateLimit(req, "submit");
      if (String(pendingId || "").length < 8) {
        await enforceSchoolAuthGlobalRateLimit("begin");
        const fresh = await beginXjtluLogin();
        pendingId = fresh.pendingId;
      }
      const r = await submitXjtluLogin({
        pendingId,
        username,
        password,
        verificationToken: req.body.verificationToken || req.body.captcha,
        beforeAuthenticate: async () => {
          await enforceSchoolAuthAccountRateLimit(req, username);
          await enforceSchoolAuthGlobalRateLimit("submit");
        },
      });
      if (!r.ok) {
        return ok(res, {
          ok: false,
          error: r.error,
          needVerification: r.needVerification ?? false,
          verification: r.verification,
          needMfa: r.needMfa ?? false,
          mfa: r.mfa,
        });
      }
      return finishXjtluSiteLogin(req, res, r.username || username, pendingId, req.body.remember);
    } catch (e) { next(e); }
  }
);

authRouter.post(
  "/xjtlu-sso-mfa-send",
  validate(z.object({
    school: z.literal("xjtlu"),
    pendingId: z.string().regex(/^[a-f0-9]{48}$/i),
    method: z.enum(["email", "sms"]),
  })),
  async (req, res, next) => {
    try {
      await enforceSchoolAuthSourceRateLimit(req, "submit");
      const result = await sendXjtluMfaCode({
        ...req.body,
        beforeSend: async (username) => {
          await enforceSchoolAuthAccountRateLimit(req, username);
          await enforceSchoolAuthGlobalRateLimit("submit");
        },
      });
      ok(res, result);
    } catch (e) { next(e); }
  },
);

authRouter.post(
  "/xjtlu-sso-mfa-verify",
  validate(z.object({
    school: z.literal("xjtlu"),
    pendingId: z.string().regex(/^[a-f0-9]{48}$/i),
    method: z.enum(["email", "otp", "sms"]),
    code: z.string().max(32).default(""),
    password: z.string().min(1).max(100).optional(),
    verificationToken: z.string().max(1024).optional(),
    remember: z.boolean().optional().default(false),
  })),
  async (req, res, next) => {
    try {
      await enforceSchoolAuthSourceRateLimit(req, "submit");
      const result = await submitXjtluMfa({
        ...req.body,
        beforeAuthenticate: async (username) => {
          await enforceSchoolAuthAccountRateLimit(req, username);
          await enforceSchoolAuthGlobalRateLimit("submit");
        },
      });
      if (!result.ok) {
        return ok(res, {
          ok: false,
          error: result.error,
          needVerification: result.needVerification ?? false,
          verification: result.verification,
          needMfa: result.needMfa ?? true,
          mfa: result.mfa,
        });
      }
      return finishXjtluSiteLogin(req, res, result.username || "", req.body.pendingId, req.body.remember);
    } catch (e) { next(e); }
  },
);

authRouter.post("/logout", authRequired, async (req, res, next) => {
  try {
    await Promise.all([
      clearXjtluEhallSession(req.user!.userId),
      clearXjtluEbridgeSession(req.user!.userId),
    ]);
    await revokeBrowserSession(req, res);
    ok(res, { ok: true });
  } catch (error) {
    next(error);
  }
});
