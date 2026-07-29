/**
 * 西交利物浦大学 ParaSSO 账号认证。
 *
 * 这里只验证学校身份并创建站内登录，不伪造 CPU 教务会话。密码仅在本次
 * HTTPS 请求中使用：不会写入 pending、Redis、数据库或日志。
 */
import crypto from "node:crypto";
import {
  deleteEphemeralValue,
  getEphemeralValue,
  runWithDistributedLock,
  setEphemeralValue,
} from "./cache";
import { buildRedisKey } from "./redis";
import { Errors, HttpError } from "../utils/response";
import { establishXjtluEhallSession, getXjtluEhallStatus } from "./xjtluEhallClient";
import { establishXjtluEbridgeSession, getXjtluEbridgeStatus } from "./xjtluEbridgeClient";

const BASE_URL = "https://uim.xjtlu.edu.cn";
const LOGIN_PAGE_URL = `${BASE_URL}/esc-sso/login/page`;
const POLICY_URL = `${BASE_URL}/esc-sso/api/v3/auth/policy`;
const LOGIN_URL = `${BASE_URL}/esc-sso/api/v3/auth/doLogin`;
const MFA_ENTRY_URL = `${BASE_URL}/esc-sso/login`;
const MFA_PAGE_URL = `${BASE_URL}/login/mfaLogin.html`;
const MFA_POLICY_URL = `${BASE_URL}/esc-sso/api/v3/auth/queryAllValid`;
const MFA_SMS_SEND_URL = `${BASE_URL}/esc-sso/api/v3/sms/send`;
const MFA_EMAIL_SEND_URL = `${BASE_URL}/esc-sso/api/v3/email/send`;
const IMAGE_CODE_URL = `${BASE_URL}/esc-sso/api/v1/image/getRandcode`;
const SLIDER_INIT_URL = `${BASE_URL}/esc-sso/api/v3/sliderCaptcha/init`;
const SLIDER_CHECK_URL = `${BASE_URL}/esc-sso/api/v3/sliderCaptcha/check`;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36";
const PENDING_TTL_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_JSON_BYTES = 1024 * 1024;
const PENDING_PREFIX = buildRedisKey("school-auth", "xjtlu", "pending");
const PORTAL_CONNECTION_PREFIX = buildRedisKey("school-auth", "xjtlu", "portal-connection");
const PORTAL_CONNECTION_TTL_MS = 10 * 60 * 1000;
const EXTRA_VERIFICATION_CODES = new Set(["SSO10023", "SSO10024", "SSO10093", "SSO10094"]);
const XJTLU_USERNAME_PATTERN = /^[A-Za-z][A-Za-z0-9._-]{1,63}$/;

type CookieMap = Record<string, string>;

interface PendingXjtluLogin {
  cookies: CookieMap;
  publicKey: string;
  publicKeyId: string;
  createdAt: number;
  authenticatedUsername?: string;
  verification?: {
    type: "image" | "slider";
    challengeToken?: string;
    verifiedToken?: string;
  };
  mfa?: {
    username: string;
    methods: XjtluMfaMethod[];
    currentStep: number;
    totalSteps: number;
    publicKey?: string;
    publicKeyId?: string;
  };
}

type PortalConnectionStage = "idle" | "connecting" | "ready" | "failed";

export interface XjtluPortalConnectionStatus {
  ehall: PortalConnectionStage;
  ebridge: PortalConnectionStage;
  ehallError?: string;
  ebridgeError?: string;
  startedAt?: string;
  updatedAt?: string;
}

const portalConnectionJobs = new Map<string, Promise<boolean>>();

function portalConnectionKey(userId: number) {
  return `${PORTAL_CONNECTION_PREFIX}:${userId}`;
}

async function savePortalConnectionStatus(userId: number, status: XjtluPortalConnectionStatus) {
  await setEphemeralValue(
    portalConnectionKey(userId),
    JSON.stringify({ ...status, updatedAt: new Date().toISOString() }),
    PORTAL_CONNECTION_TTL_MS,
  );
}

export async function getXjtluPortalConnectionStatus(userId: number): Promise<XjtluPortalConnectionStatus> {
  const raw = await getEphemeralValue(portalConnectionKey(userId));
  if (!raw) return { ehall: "idle", ebridge: "idle" };
  try {
    const parsed = JSON.parse(raw) as XjtluPortalConnectionStatus;
    return {
      ehall: parsed.ehall || "idle",
      ebridge: parsed.ebridge || "idle",
      ehallError: typeof parsed.ehallError === "string" ? parsed.ehallError : undefined,
      ebridgeError: typeof parsed.ebridgeError === "string" ? parsed.ebridgeError : undefined,
      startedAt: parsed.startedAt,
      updatedAt: parsed.updatedAt,
    };
  } catch {
    return { ehall: "idle", ebridge: "idle" };
  }
}

interface UpstreamEnvelope {
  code?: string | number;
  msg?: string;
  message?: string;
  data?: unknown;
}

interface PolicyData {
  param?: {
    publicKey?: string;
    publicKeyId?: string | number;
  };
}

interface RedirectData {
  redirect?: string;
}

interface SliderData {
  sourceImage?: string;
  newImage?: string;
  Y?: string | number;
  token?: string;
}

export type XjtluVerificationChallenge =
  | { type: "image"; pendingId: string; image: string }
  | {
    type: "slider";
    pendingId: string;
    sourceImage: string;
    puzzleImage: string;
    y: number;
    token: string;
  };

export type XjtluMfaMethodType = "email" | "otp" | "sms";

export interface XjtluMfaMethod {
  type: XjtluMfaMethodType;
  authType: "webExtendEmailCodeAuth" | "webOtpAuth" | "webSmsAuth";
  label: string;
  destination?: string;
  codeLength: number;
  codeRequired: boolean;
  cooldownSeconds: number;
  passwordRequired: boolean;
}

export interface XjtluMfaChallenge {
  pendingId: string;
  reason: "abnormal-login";
  methods: XjtluMfaMethod[];
  currentStep: number;
  totalSteps: number;
}

export interface XjtluLoginAttempt {
  ok: boolean;
  username?: string;
  error?: string;
  needVerification?: boolean;
  verification?: XjtluVerificationChallenge;
  needMfa?: boolean;
  mfa?: XjtluMfaChallenge;
}

async function markAuthenticated(pendingId: string, pending: PendingXjtluLogin, username: string) {
  pending.authenticatedUsername = username.trim().toLowerCase();
  pending.verification = undefined;
  pending.mfa = undefined;
  await savePending(pendingId, pending);
}

type PortalSessionResult = PromiseSettledResult<unknown>;

interface PortalSessionDependencies {
  getEhallStatus: typeof getXjtluEhallStatus;
  getEbridgeStatus: typeof getXjtluEbridgeStatus;
  establishEhall: typeof establishXjtluEhallSession;
  establishEbridge: typeof establishXjtluEbridgeSession;
}

const portalSessionDependencies: PortalSessionDependencies = {
  getEhallStatus: getXjtluEhallStatus,
  getEbridgeStatus: getXjtluEbridgeStatus,
  establishEhall: establishXjtluEhallSession,
  establishEbridge: establishXjtluEbridgeSession,
};

async function settlePortalSession(task: () => Promise<unknown>): Promise<PortalSessionResult> {
  try {
    return { status: "fulfilled", value: await task() };
  } catch (reason) {
    return { status: "rejected", reason };
  }
}

/**
 * UIM may rotate its authentication cookie while issuing OAuth/OIDC grants.
 * Establishing eHall and eBridge concurrently with cloned cookie jars can make
 * the second exchange use an obsolete cookie. Keep both handshakes sequential
 * and share the same jar so every Set-Cookie is visible to the next portal.
 */
export async function establishXjtluPortalSessions(
  args: {
    userId: number;
    username: string;
    uimCookies: CookieMap;
  },
  dependencies: PortalSessionDependencies = portalSessionDependencies,
) {
  const [existingEhall, existingEbridge] = await Promise.all([
    dependencies.getEhallStatus(args.userId),
    dependencies.getEbridgeStatus(args.userId, true),
  ]);
  const ehall = existingEhall.active
    ? { status: "fulfilled", value: existingEhall } as const
    : await settlePortalSession(() => dependencies.establishEhall(
      args.userId,
      args.username,
      args.uimCookies,
    ));
  const ebridge = existingEbridge.active
    ? { status: "fulfilled", value: existingEbridge } as const
    : await settlePortalSession(() => dependencies.establishEbridge(
      args.userId,
      args.username,
      args.uimCookies,
    ));
  return { ehall, ebridge };
}

function portalSessionError(result: PortalSessionResult) {
  if (result.status === "fulfilled") return undefined;
  const message = result.reason instanceof Error ? result.reason.message : "学校服务连接失败";
  return message.replace(/[\r\n\t]+/g, " ").trim().slice(0, 180) || "学校服务连接失败";
}

export async function finalizeXjtluLoginSession(args: {
  pendingId: string;
  userId: number;
  username: string;
}) {
  const pendingId = String(args.pendingId ?? "").trim();
  if (!/^[a-f0-9]{48}$/i.test(pendingId)) return false;
  const pending = await loadPending(pendingId);
  if (!pending?.authenticatedUsername || pending.authenticatedUsername !== args.username.trim().toLowerCase()) {
    await deleteEphemeralValue(pendingKey(pendingId));
    return false;
  }
  try {
    const startedAt = new Date().toISOString();
    await savePortalConnectionStatus(args.userId, {
      ehall: "connecting",
      ebridge: "connecting",
      startedAt,
    });
    const results = await establishXjtluPortalSessions({
      userId: args.userId,
      username: pending.authenticatedUsername,
      uimCookies: pending.cookies,
    });
    const entries = [
      ["xjtlu-ehall", results.ehall],
      ["xjtlu-ebridge", results.ebridge],
    ] as const;
    entries.forEach(([label, result]) => {
      if (result.status === "rejected") {
        console.warn(`[${label}] unable to establish portal session`, portalSessionError(result));
      }
    });
    await savePortalConnectionStatus(args.userId, {
      ehall: results.ehall.status === "fulfilled" ? "ready" : "failed",
      ebridge: results.ebridge.status === "fulfilled" ? "ready" : "failed",
      ehallError: portalSessionError(results.ehall),
      ebridgeError: portalSessionError(results.ebridge),
      startedAt,
    });
    return results.ehall.status === "fulfilled" || results.ebridge.status === "fulfilled";
  } finally {
    await deleteEphemeralValue(pendingKey(pendingId));
  }
}

export function startXjtluLoginSessionFinalize(args: {
  pendingId: string;
  userId: number;
  username: string;
}) {
  const jobKey = `${args.userId}:${args.pendingId}`;
  if (portalConnectionJobs.has(jobKey)) return;
  const job = finalizeXjtluLoginSession(args).catch((error) => {
    console.warn("[xjtlu-portal] background connection failed", error instanceof Error ? error.message : "unknown error");
    return false;
  });
  portalConnectionJobs.set(jobKey, job);
  void job.finally(() => portalConnectionJobs.delete(jobKey));
}

function pendingKey(id: string) {
  return `${PENDING_PREFIX}:${id}`;
}

function getSetCookie(headers: Headers): string[] {
  const values = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.();
  if (values?.length) return values;
  const combined = headers.get("set-cookie");
  if (!combined) return [];
  return combined.split(/,(?=\s*[!#$%&'*+\-.^_`|~0-9A-Za-z]+=)/g);
}

function ingestCookies(cookies: CookieMap, headers: Headers) {
  for (const raw of getSetCookie(headers)) {
    const pair = raw.split(";", 1)[0];
    const separator = pair.indexOf("=");
    if (separator <= 0) continue;
    const name = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    if (!name || name.length > 256 || value.length > 8192) continue;
    if (value) cookies[name] = value;
    else delete cookies[name];
  }
}

function serializeCookies(cookies: CookieMap) {
  return Object.entries(cookies).map(([name, value]) => `${name}=${value}`).join("; ");
}

async function readLimitedBuffer(response: Response, controller: AbortController) {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_JSON_BYTES) {
      controller.abort();
      throw new HttpError(502, 5502, "西交利物浦统一认证返回的数据过大");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

async function readLimitedBody(response: Response, controller: AbortController) {
  return (await readLimitedBuffer(response, controller)).toString("utf8");
}

async function fetchUpstream(url: string, init: RequestInit = {}, readBody = false) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  timer.unref?.();
  try {
    const response = await fetch(url, {
      ...init,
      redirect: "manual",
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json, text/plain, */*",
        ...init.headers,
      },
    });
    if (readBody) {
      return { response, text: await readLimitedBody(response, controller) };
    }
    await response.body?.cancel();
    return { response, text: "" };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new HttpError(504, 5504, "西交利物浦统一认证请求超时，请稍后重试");
    }
    throw new HttpError(502, 5502, "暂时无法连接西交利物浦统一认证，请稍后重试");
  } finally {
    clearTimeout(timer);
  }
}

async function fetchUpstreamImage(url: string, cookies: CookieMap) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  timer.unref?.();
  try {
    const response = await fetch(url, {
      redirect: "manual",
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        Cookie: serializeCookies(cookies),
        Referer: LOGIN_PAGE_URL,
      },
    });
    const body = await readLimitedBuffer(response, controller);
    return { response, body };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new HttpError(504, 5504, "XJTLU 统一认证验证码请求超时，请重试");
    }
    throw new HttpError(502, 5502, "暂时无法获取 XJTLU 统一认证验证码，请重试");
  } finally {
    clearTimeout(timer);
  }
}

function throwForUpstreamStatus(response: Response) {
  if (response.status === 429) {
    throw new HttpError(429, 5529, "统一认证请求过于频繁，请稍后重试");
  }
  if (!response.ok) {
    const message = response.status >= 500
      ? "西交利物浦统一认证暂时不可用，请稍后重试"
      : `西交利物浦统一认证请求失败 (${response.status})`;
    const status = response.status >= 500 ? 503 : 502;
    throw new HttpError(status, 5500 + Math.min(199, Math.max(0, response.status - 400)), message);
  }
}

function readJson(text: string): UpstreamEnvelope {
  if (!text) {
    throw Errors.server("西交利物浦统一认证返回了无效响应");
  }
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid envelope");
    return parsed as UpstreamEnvelope;
  } catch {
    throw Errors.server("西交利物浦统一认证返回了无效响应");
  }
}

function encryptPassword(password: string, publicKey: string) {
  try {
    const key = crypto.createPublicKey({
      key: Buffer.from(publicKey, "base64"),
      format: "der",
      type: "spki",
    });
    return crypto.publicEncrypt({ key, padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.from(password, "utf8"))
      .toString("base64");
  } catch {
    throw Errors.server("无法使用西交利物浦统一认证公钥，请稍后重试");
  }
}

function safeUpstreamMessage(input: unknown) {
  const message = String(input ?? "").replace(/<[^>]*>/g, "").replace(/[\r\n\t]+/g, " ").trim().slice(0, 160);
  return message || "账号或密码错误";
}

function validateSuccessRedirect(input: unknown) {
  if (typeof input !== "string" || !input.trim()) return false;
  try {
    // ParaSSO may return either an absolute URL or a same-origin relative path.
    const url = new URL(input, BASE_URL);
    return url.origin === BASE_URL
      && url.pathname.startsWith("/selfcare/")
      && !url.username
      && !url.password;
  } catch {
    return false;
  }
}

function isMfaRedirect(input: unknown) {
  if (typeof input !== "string" || !input.trim()) return false;
  try {
    const url = new URL(input, BASE_URL);
    return url.origin === BASE_URL
      && (url.pathname === "/esc-sso/login" || url.pathname === "/login/mfaLogin.html")
      && !url.username
      && !url.password;
  } catch {
    return false;
  }
}

function asRecord(input: unknown): Record<string, unknown> | null {
  return input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : null;
}

function isUsablePending(pending: PendingXjtluLogin) {
  return Boolean(
    pending.cookies
    && pending.publicKey
    && pending.publicKeyId
    && Number.isFinite(pending.createdAt)
    && Date.now() - pending.createdAt <= PENDING_TTL_MS,
  );
}

async function savePending(pendingId: string, pending: PendingXjtluLogin) {
  await setEphemeralValue(pendingKey(pendingId), JSON.stringify(pending), PENDING_TTL_MS);
}

async function loadPending(pendingId: string) {
  const raw = await getEphemeralValue(pendingKey(pendingId));
  if (!raw) return null;
  try {
    const pending = JSON.parse(raw) as PendingXjtluLogin;
    if (isUsablePending(pending)) return pending;
  } catch {
    // Fall through and invalidate the malformed pending value.
  }
  await deleteEphemeralValue(pendingKey(pendingId));
  return null;
}

async function createImageChallenge(
  pendingId: string,
  pending: PendingXjtluLogin,
): Promise<XjtluVerificationChallenge> {
  const result = await fetchUpstreamImage(`${IMAGE_CODE_URL}?_=${Date.now()}`, pending.cookies);
  throwForUpstreamStatus(result.response);
  ingestCookies(pending.cookies, result.response.headers);
  const contentType = String(result.response.headers.get("content-type") ?? "image/png")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (!/^image\/(?:png|jpeg|gif|webp|bmp)$/.test(contentType) || result.body.length === 0) {
    throw Errors.server("XJTLU 统一认证返回了无效的图片验证码");
  }
  pending.verification = { type: "image" };
  await savePending(pendingId, pending);
  return {
    type: "image",
    pendingId,
    image: `data:${contentType};base64,${result.body.toString("base64")}`,
  };
}

function readSliderData(input: unknown): { sourceImage: string; newImage: string; Y: number; token: string } | null {
  const value = asRecord(input);
  if (!value) return null;
  const sourceImage = String(value.sourceImage ?? "").trim();
  const newImage = String(value.newImage ?? "").trim();
  const token = String(value.token ?? "").trim();
  const y = Number(value.Y);
  if (
    !sourceImage
    || !newImage
    || !token
    || sourceImage.length > MAX_JSON_BYTES
    || newImage.length > MAX_JSON_BYTES
    || token.length > 512
    || !Number.isFinite(y)
    || y < 0
    || y > 4096
  ) return null;
  return { sourceImage, newImage, token, Y: y };
}

async function createSliderChallenge(
  pendingId: string,
  pending: PendingXjtluLogin,
): Promise<XjtluVerificationChallenge> {
  const result = await fetchUpstream(SLIDER_INIT_URL, {
    method: "POST",
    headers: {
      Cookie: serializeCookies(pending.cookies),
      Referer: LOGIN_PAGE_URL,
      Origin: BASE_URL,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: "{}",
  }, true);
  throwForUpstreamStatus(result.response);
  ingestCookies(pending.cookies, result.response.headers);
  const envelope = readJson(result.text);
  const slider = String(envelope.code ?? "") === "0" ? readSliderData(envelope.data) : null;
  if (!slider) throw Errors.server("无法初始化 XJTLU 统一认证滑块验证");
  pending.verification = { type: "slider", challengeToken: slider.token };
  await savePending(pendingId, pending);
  return {
    type: "slider",
    pendingId,
    sourceImage: `data:image/png;base64,${slider.sourceImage}`,
    puzzleImage: `data:image/png;base64,${slider.newImage}`,
    y: slider.Y,
    token: slider.token,
  };
}

async function createVerificationChallenge(
  code: string,
  pendingId: string,
  pending: PendingXjtluLogin,
) {
  return code === "SSO10023" || code === "SSO10093"
    ? createImageChallenge(pendingId, pending)
    : createSliderChallenge(pendingId, pending);
}

function boundedInteger(input: unknown, fallback: number, min: number, max: number) {
  const value = Number(input);
  return Number.isInteger(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function readMfaMethods(input: unknown): {
  username: string;
  methods: XjtluMfaMethod[];
  currentStep: number;
  totalSteps: number;
  publicKey?: string;
  publicKeyId?: string;
} | null {
  const root = asRecord(input);
  const config = asRecord(root?.config);
  const mfaAuth = asRecord(config?.mfaAuth);
  const auths = Array.isArray(mfaAuth?.auths) ? mfaAuth.auths : [];
  const login = asRecord(root?.login);
  const loginExtends = asRecord(root?.loginExtends);
  const param = asRecord(root?.param);
  const username = String(config?.username ?? "").trim();
  const mobile = String(config?.mobile ?? "").trim();
  const email = String(config?.email ?? "").trim();
  if (!XJTLU_USERNAME_PATTERN.test(username) || auths.length === 0) return null;

  const methods: XjtluMfaMethod[] = [];
  for (const raw of auths) {
    const auth = asRecord(raw);
    const authType = String(auth?.type ?? "");
    if (authType === "webSmsAuth" && mobile) {
      const settings = asRecord(login?.webSmsAuth);
      methods.push({
        type: "sms",
        authType,
        label: "SMS Code",
        destination: mobile,
        codeLength: boundedInteger(settings?.codeLength, 6, 4, 12),
        codeRequired: true,
        cooldownSeconds: boundedInteger(settings?.resend, 60, 15, 300),
        passwordRequired: String(settings?.staticPassword ?? "0") === "1",
      });
    } else if (authType === "webExtendEmailCodeAuth" && email) {
      const settings = asRecord(loginExtends?.webExtendEmailCodeAuth);
      methods.push({
        type: "email",
        authType,
        label: "Email Code",
        destination: email,
        codeLength: boundedInteger(settings?.codeLength, 6, 4, 12),
        codeRequired: true,
        cooldownSeconds: boundedInteger(settings?.timeout, 60, 15, 300),
        passwordRequired: String(settings?.staticPassword ?? "0") === "1",
      });
    } else if (authType === "webOtpAuth") {
      const settings = asRecord(login?.webOtpAuth);
      methods.push({
        type: "otp",
        authType,
        label: "OTP",
        codeLength: boundedInteger(settings?.otpLength, 6, 4, 12),
        codeRequired: String(settings?.passwordType ?? "0") !== "2",
        cooldownSeconds: 0,
        passwordRequired: String(settings?.passwordType ?? "0") !== "0",
      });
    }
  }
  if (methods.length === 0) return null;
  return {
    username,
    methods,
    currentStep: boundedInteger(mfaAuth?.currentStep, 1, 1, 10),
    totalSteps: boundedInteger(mfaAuth?.count, 1, 1, 10),
    publicKey: String(param?.publicKey ?? "").trim() || undefined,
    publicKeyId: String(param?.publicKeyId ?? "").trim() || undefined,
  };
}

async function createMfaChallenge(
  pendingId: string,
  pending: PendingXjtluLogin,
  redirect?: unknown,
): Promise<XjtluMfaChallenge | null> {
  // ParaSSO currently uses both an intermediate entry and a direct MFA page
  // redirect. Start from the exact trusted URL it returned so a direct
  // /login/mfaLogin.html response is not sent through the entry flow again.
  let currentUrl = isMfaRedirect(redirect)
    ? new URL(String(redirect), BASE_URL)
    : new URL(MFA_ENTRY_URL);
  let referer = LOGIN_PAGE_URL;
  let reachedMfaPage = false;
  for (let hop = 0; hop < 8; hop += 1) {
    const entry = await fetchUpstream(currentUrl.toString(), {
      headers: {
        Cookie: serializeCookies(pending.cookies),
        Referer: referer,
        Accept: "text/html,application/xhtml+xml",
      },
    });
    ingestCookies(pending.cookies, entry.response.headers);
    if (entry.response.status >= 300 && entry.response.status < 400) {
      const location = entry.response.headers.get("location");
      let target: URL;
      try {
        target = new URL(String(location ?? ""), currentUrl);
      } catch {
        throw Errors.server("XJTLU 二次认证返回了无效跳转");
      }
      if (target.origin === BASE_URL && target.pathname.startsWith("/selfcare/")) {
        return null;
      }
      const allowedPath = target.pathname === "/"
        || target.pathname === "/ngw/login"
        || target.pathname === "/esc-sso/oauth2.0/authorize"
        || target.pathname === "/login/mfaLogin.html";
      if (target.origin !== BASE_URL || !allowedPath) {
        console.warn("[xjtlu-sso] unexpected MFA transition", {
          origin: target.origin,
          pathname: target.pathname,
        });
        throw Errors.server("XJTLU 二次认证返回了非预期跳转");
      }
      referer = currentUrl.toString();
      currentUrl = target;
      continue;
    }
    throwForUpstreamStatus(entry.response);
    if (currentUrl.pathname === "/login/mfaLogin.html") {
      reachedMfaPage = true;
      break;
    }
    throw Errors.server("XJTLU 二次认证入口返回了非预期页面");
  }
  if (!reachedMfaPage) throw Errors.server("XJTLU 二次认证跳转次数过多");

  const policyResult = await fetchUpstream(MFA_POLICY_URL, {
    headers: {
      Cookie: serializeCookies(pending.cookies),
      Referer: MFA_PAGE_URL,
    },
  }, true);
  throwForUpstreamStatus(policyResult.response);
  ingestCookies(pending.cookies, policyResult.response.headers);
  const envelope = readJson(policyResult.text);
  const parsed = String(envelope.code ?? "") === "0" ? readMfaMethods(envelope.data) : null;
  if (!parsed) throw Errors.server("无法读取 XJTLU 二次认证方式，请稍后重试");
  pending.mfa = parsed;
  pending.verification = undefined;
  await savePending(pendingId, pending);
  return {
    pendingId,
    reason: "abnormal-login",
    methods: parsed.methods,
    currentStep: parsed.currentStep,
    totalSteps: parsed.totalSteps,
  };
}

export async function beginXjtluLogin(): Promise<{
  pendingId: string;
  needCaptcha: false;
}> {
  const cookies: CookieMap = {};
  const pageResult = await fetchUpstream(LOGIN_PAGE_URL, {
    headers: { Accept: "text/html,application/xhtml+xml" },
  });
  const pageResponse = pageResult.response;
  throwForUpstreamStatus(pageResponse);
  ingestCookies(cookies, pageResponse.headers);

  const policyResult = await fetchUpstream(POLICY_URL, {
    headers: {
      Cookie: serializeCookies(cookies),
      Referer: LOGIN_PAGE_URL,
    },
  }, true);
  const policyResponse = policyResult.response;
  throwForUpstreamStatus(policyResponse);
  ingestCookies(cookies, policyResponse.headers);
  const policy = readJson(policyResult.text);
  const policyData = (asRecord(policy.data) ?? {}) as PolicyData;
  const publicKey = String(policyData.param?.publicKey ?? "").trim();
  const publicKeyId = String(policyData.param?.publicKeyId ?? "").trim();
  if (String(policy.code) !== "0" || !publicKey || !publicKeyId || publicKey.length > 8192 || publicKeyId.length > 256) {
    throw Errors.server("无法读取西交利物浦统一认证登录参数，请稍后重试");
  }

  const pendingId = crypto.randomBytes(24).toString("hex");
  const pending: PendingXjtluLogin = { cookies, publicKey, publicKeyId, createdAt: Date.now() };
  await setEphemeralValue(pendingKey(pendingId), JSON.stringify(pending), PENDING_TTL_MS);
  return { pendingId, needCaptcha: false };
}

export async function submitXjtluLogin(args: {
  pendingId: string;
  username: string;
  password: string;
  verificationToken?: string;
  beforeAuthenticate?: () => Promise<void>;
}): Promise<XjtluLoginAttempt> {
  const pendingId = String(args.pendingId ?? "").trim();
  const username = String(args.username ?? "").trim();
  const verificationToken = String(args.verificationToken ?? "").trim();
  if (!/^[a-f0-9]{48}$/i.test(pendingId)) {
    return { ok: false, error: "登录会话已过期，请刷新页面重试" };
  }
  if (!XJTLU_USERNAME_PATTERN.test(username)) {
    return { ok: false, error: "请使用 XJTLU 用户名登录，暂不支持手机号" };
  }
  if (!args.password || args.password.length > 100) {
    return { ok: false, error: "请输入有效的 XJTLU 账号和密码" };
  }

  const locked = await runWithDistributedLock(`xjtlu-sso-submit:${pendingId}`, PENDING_TTL_MS, async () => {
    const pending = await loadPending(pendingId);
    if (!pending) return { ok: false, error: "登录会话已过期，请刷新页面重试" } as XjtluLoginAttempt;
    if (pending.authenticatedUsername) {
      await deleteEphemeralValue(pendingKey(pendingId));
      return { ok: false, error: "登录会话已过期，请刷新页面重试" } as XjtluLoginAttempt;
    }

    if (verificationToken.length > 1024) {
      return { ok: false, error: "安全验证码无效，请重新验证" } as XjtluLoginAttempt;
    }
    if (pending.verification?.type === "slider") {
      if (!pending.verification.verifiedToken || verificationToken !== pending.verification.verifiedToken) {
        const verification = await createSliderChallenge(pendingId, pending);
        return {
          ok: false,
          error: "请先完成滑块安全验证",
          needVerification: true,
          verification,
        } as XjtluLoginAttempt;
      }
    }

    await args.beforeAuthenticate?.();
    const encryptedPassword = encryptPassword(args.password, pending.publicKey);
    let loginResult: Awaited<ReturnType<typeof fetchUpstream>>;
    try {
      loginResult = await fetchUpstream(LOGIN_URL, {
        method: "POST",
        headers: {
          Cookie: serializeCookies(pending.cookies),
          Referer: LOGIN_PAGE_URL,
          Origin: BASE_URL,
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({
          authType: "webLocalAuth",
          dataField: {
            username,
            password: encryptedPassword,
            publicKeyId: pending.publicKeyId,
            ...(verificationToken ? { vcode: verificationToken } : {}),
          },
        }),
      }, true);
    } catch (error) {
      await deleteEphemeralValue(pendingKey(pendingId));
      throw error;
    }
    const response = loginResult.response;
    throwForUpstreamStatus(response);
    ingestCookies(pending.cookies, response.headers);
    const result = readJson(loginResult.text);
    const code = String(result.code ?? "");
    const redirect = (asRecord(result.data) as RedirectData | null)?.redirect;
    if (code === "0" && validateSuccessRedirect(redirect)) {
      await markAuthenticated(pendingId, pending, username);
      return { ok: true, username } as XjtluLoginAttempt;
    }
    if (code === "0" && isMfaRedirect(redirect)) {
      const mfa = await createMfaChallenge(pendingId, pending, redirect);
      if (!mfa) {
        await markAuthenticated(pendingId, pending, username);
        return { ok: true, username } as XjtluLoginAttempt;
      }
      return {
        ok: false,
        error: "需要完成 XJTLU 二次认证",
        needMfa: true,
        mfa,
      } as XjtluLoginAttempt;
    }
    if (code === "0") {
      try {
        const rejected = new URL(String(redirect ?? ""), BASE_URL);
        console.warn("[xjtlu-sso] rejected success redirect", {
          origin: rejected.origin,
          pathname: rejected.pathname,
        });
      } catch {
        const data = asRecord(result.data);
        console.warn("[xjtlu-sso] rejected success response without a valid redirect", {
          dataType: Array.isArray(result.data) ? "array" : typeof result.data,
          dataKeys: data ? Object.keys(data).slice(0, 20) : [],
          nestedKeys: data
            ? Object.fromEntries(Object.entries(data)
              .filter(([, value]) => Boolean(asRecord(value)))
              .slice(0, 10)
              .map(([key, value]) => [key, Object.keys(asRecord(value)!).slice(0, 20)]))
            : {},
        });
      }
      await deleteEphemeralValue(pendingKey(pendingId));
      return { ok: false, error: "统一认证未返回可信的登录结果，请重试" } as XjtluLoginAttempt;
    }
    if (EXTRA_VERIFICATION_CODES.has(code)) {
      const verification = await createVerificationChallenge(code, pendingId, pending);
      return {
        ok: false,
        error: verification.type === "image" ? "请输入图片安全验证码" : "请完成滑块安全验证",
        needVerification: true,
        verification,
      } as XjtluLoginAttempt;
    }
    await deleteEphemeralValue(pendingKey(pendingId));
    return {
      ok: false,
      error: safeUpstreamMessage(result.msg ?? result.message),
    } as XjtluLoginAttempt;
  });

  if (!locked.acquired) {
    return { ok: false, error: "这个登录会话正在处理中，请勿重复提交" };
  }
  return locked.result as XjtluLoginAttempt;
}

export async function checkXjtluSlider(args: {
  pendingId: string;
  x: number;
  y: number;
  token: string;
}) {
  const pendingId = String(args.pendingId ?? "").trim();
  const token = String(args.token ?? "").trim();
  if (!/^[a-f0-9]{48}$/i.test(pendingId)) {
    return { ok: false as const, error: "登录会话已过期，请刷新页面重试" };
  }
  if (!Number.isFinite(args.x) || !Number.isFinite(args.y) || args.x < 0 || args.y < 0 || !token) {
    return { ok: false as const, error: "滑块位置无效，请重试" };
  }

  const locked = await runWithDistributedLock(`xjtlu-sso-slider:${pendingId}`, PENDING_TTL_MS, async () => {
    const pending = await loadPending(pendingId);
    if (!pending) return { ok: false as const, error: "登录会话已过期，请刷新页面重试" };
    if (pending.verification?.type !== "slider" || pending.verification.challengeToken !== token) {
      const verification = await createSliderChallenge(pendingId, pending);
      return { ok: false as const, error: "滑块验证已刷新，请重试", verification };
    }

    const url = new URL(SLIDER_CHECK_URL);
    url.searchParams.set("X", String(Math.round(args.x)));
    url.searchParams.set("Y", String(Math.round(args.y)));
    url.searchParams.set("token", token);
    const result = await fetchUpstream(url.toString(), {
      headers: {
        Cookie: serializeCookies(pending.cookies),
        Referer: LOGIN_PAGE_URL,
        Origin: BASE_URL,
      },
    }, true);
    throwForUpstreamStatus(result.response);
    ingestCookies(pending.cookies, result.response.headers);
    const envelope = readJson(result.text);
    const verifiedToken = String(envelope.data ?? "").trim();
    if (String(envelope.code ?? "") === "0" && verifiedToken && verifiedToken.length <= 1024) {
      pending.verification.verifiedToken = verifiedToken;
      await savePending(pendingId, pending);
      return { ok: true as const, verificationToken: verifiedToken };
    }
    const verification = await createSliderChallenge(pendingId, pending);
    return { ok: false as const, error: "滑块位置不正确，请重试", verification };
  });

  if (!locked.acquired) return { ok: false as const, error: "滑块验证正在处理中，请稍候" };
  return locked.result!;
}

function mfaChallengeFromPending(pendingId: string, pending: PendingXjtluLogin): XjtluMfaChallenge | null {
  if (!pending.mfa) return null;
  return {
    pendingId,
    reason: "abnormal-login",
    methods: pending.mfa.methods,
    currentStep: pending.mfa.currentStep,
    totalSteps: pending.mfa.totalSteps,
  };
}

export async function sendXjtluMfaCode(args: {
  pendingId: string;
  method: "email" | "sms";
  beforeSend?: (username: string) => Promise<void>;
}) {
  const pendingId = String(args.pendingId ?? "").trim();
  if (!/^[a-f0-9]{48}$/i.test(pendingId)) {
    return { ok: false as const, error: "二次认证会话已过期，请重新登录" };
  }
  const locked = await runWithDistributedLock(`xjtlu-sso-mfa-send:${pendingId}`, PENDING_TTL_MS, async () => {
    const pending = await loadPending(pendingId);
    if (!pending?.mfa) return { ok: false as const, error: "二次认证会话已过期，请重新登录" };
    const method = pending.mfa.methods.find((item) => item.type === args.method);
    if (!method || (method.type !== "email" && method.type !== "sms")) {
      return { ok: false as const, error: "该二次认证方式不可用" };
    }
    await args.beforeSend?.(pending.mfa.username);
    const url = new URL(method.type === "email" ? MFA_EMAIL_SEND_URL : MFA_SMS_SEND_URL);
    url.searchParams.set("username", pending.mfa.username);
    const result = await fetchUpstream(url.toString(), {
      headers: {
        Cookie: serializeCookies(pending.cookies),
        Referer: MFA_PAGE_URL,
      },
    }, true);
    throwForUpstreamStatus(result.response);
    ingestCookies(pending.cookies, result.response.headers);
    const envelope = readJson(result.text);
    if (String(envelope.code ?? "") !== "0") {
      return { ok: false as const, error: safeUpstreamMessage(envelope.msg ?? envelope.message) };
    }
    await savePending(pendingId, pending);
    return {
      ok: true as const,
      method: method.type,
      destination: method.destination,
      cooldownSeconds: method.cooldownSeconds,
    };
  });
  if (!locked.acquired) return { ok: false as const, error: "验证码正在发送，请勿重复点击" };
  return locked.result!;
}

export async function submitXjtluMfa(args: {
  pendingId: string;
  method: XjtluMfaMethodType;
  code: string;
  password?: string;
  verificationToken?: string;
  beforeAuthenticate?: (username: string) => Promise<void>;
}): Promise<XjtluLoginAttempt> {
  const pendingId = String(args.pendingId ?? "").trim();
  const codeInput = String(args.code ?? "").trim();
  const verificationToken = String(args.verificationToken ?? "").trim();
  if (!/^[a-f0-9]{48}$/i.test(pendingId)) {
    return { ok: false, error: "二次认证会话已过期，请重新登录" };
  }
  if (codeInput.length > 32) {
    return { ok: false, error: "请输入有效的二次认证验证码" };
  }

  const locked = await runWithDistributedLock(`xjtlu-sso-mfa-submit:${pendingId}`, PENDING_TTL_MS, async () => {
    const pending = await loadPending(pendingId);
    if (!pending?.mfa) return { ok: false, error: "二次认证会话已过期，请重新登录" } as XjtluLoginAttempt;
    const method = pending.mfa.methods.find((item) => item.type === args.method);
    if (!method) return { ok: false, error: "该二次认证方式不可用" } as XjtluLoginAttempt;
    if (method.codeRequired && !codeInput) {
      return { ok: false, error: method.type === "otp" ? "请输入动态口令 OTP" : "请输入验证码" } as XjtluLoginAttempt;
    }
    if (codeInput.length > method.codeLength) {
      return { ok: false, error: `验证码不能超过 ${method.codeLength} 位` } as XjtluLoginAttempt;
    }
    if (method.passwordRequired && !args.password) {
      return { ok: false, error: "该认证方式还需要输入 XJTLU 密码" } as XjtluLoginAttempt;
    }
    if (pending.verification?.type === "slider"
      && (!pending.verification.verifiedToken || verificationToken !== pending.verification.verifiedToken)) {
      const verification = await createSliderChallenge(pendingId, pending);
      return {
        ok: false,
        error: "请先完成滑块安全验证",
        needVerification: true,
        verification,
        needMfa: true,
        mfa: mfaChallengeFromPending(pendingId, pending) ?? undefined,
      } as XjtluLoginAttempt;
    }

    await args.beforeAuthenticate?.(pending.mfa.username);
    const dataField: Record<string, string> = { username: pending.mfa.username };
    if (method.type === "otp") {
      dataField.password = "";
      if (method.codeRequired) dataField.otp = codeInput;
    } else {
      dataField.smsCode = codeInput;
      dataField.password = "";
      dataField.vcode = verificationToken;
    }
    if (method.passwordRequired && args.password) {
      const key = pending.mfa.publicKey || pending.publicKey;
      dataField.password = encryptPassword(args.password, key);
      if (pending.mfa.publicKeyId) dataField.publicKeyId = pending.mfa.publicKeyId;
    }
    if (verificationToken) dataField.vcode = verificationToken;

    const loginResult = await fetchUpstream(LOGIN_URL, {
      method: "POST",
      headers: {
        Cookie: serializeCookies(pending.cookies),
        Referer: MFA_PAGE_URL,
        Origin: BASE_URL,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({ authType: method.authType, dataField, redirectUri: "" }),
    }, true);
    throwForUpstreamStatus(loginResult.response);
    ingestCookies(pending.cookies, loginResult.response.headers);
    const result = readJson(loginResult.text);
    const resultCode = String(result.code ?? "");
    const redirect = (asRecord(result.data) as RedirectData | null)?.redirect;
    if (resultCode === "0" && validateSuccessRedirect(redirect)) {
      const authenticatedUsername = pending.mfa.username;
      await markAuthenticated(pendingId, pending, authenticatedUsername);
      return { ok: true, username: authenticatedUsername } as XjtluLoginAttempt;
    }
    if (resultCode === "0" && isMfaRedirect(redirect)) {
      const mfa = await createMfaChallenge(pendingId, pending, redirect);
      if (!mfa) {
        const authenticatedUsername = pending.mfa.username;
        await markAuthenticated(pendingId, pending, authenticatedUsername);
        return { ok: true, username: authenticatedUsername } as XjtluLoginAttempt;
      }
      return {
        ok: false,
        error: "还需要完成下一步 XJTLU 二次认证",
        needMfa: true,
        mfa,
      } as XjtluLoginAttempt;
    }
    if (EXTRA_VERIFICATION_CODES.has(resultCode)) {
      const verification = await createVerificationChallenge(resultCode, pendingId, pending);
      return {
        ok: false,
        error: verification.type === "image" ? "请输入图片安全验证码" : "请完成滑块安全验证",
        needVerification: true,
        verification,
        needMfa: true,
        mfa: mfaChallengeFromPending(pendingId, pending) ?? undefined,
      } as XjtluLoginAttempt;
    }
    if (resultCode === "0") {
      await deleteEphemeralValue(pendingKey(pendingId));
      return { ok: false, error: "XJTLU 二次认证未返回可信结果，请重新登录" } as XjtluLoginAttempt;
    }
    pending.verification = undefined;
    await savePending(pendingId, pending);
    return { ok: false, error: safeUpstreamMessage(result.msg ?? result.message) } as XjtluLoginAttempt;
  });

  if (!locked.acquired) return { ok: false, error: "二次认证正在处理中，请勿重复提交" };
  return locked.result as XjtluLoginAttempt;
}
