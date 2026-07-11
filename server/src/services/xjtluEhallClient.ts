import crypto from "node:crypto";
import { config } from "../config";
import { Errors, HttpError } from "../utils/response";
import {
  deleteEphemeralValue,
  getEphemeralValue,
  setEphemeralValue,
} from "./cache";
import { buildRedisKey } from "./redis";

const EHALL_ORIGIN = "https://ehall.xjtlu.edu.cn";
const SSO_ORIGIN = "https://sso.xjtlu.edu.cn";
const UIM_ORIGIN = "https://uim.xjtlu.edu.cn";
const EHALL_LOGIN_URL = `${EHALL_ORIGIN}/auth-protocol-core/login?service=${encodeURIComponent(`${EHALL_ORIGIN}/login`)}`;
const EHALL_HOME_URL = `${EHALL_ORIGIN}/default/index.html#/hall`;
const EHALL_STUDENT_HOME_URL = `${EHALL_ORIGIN}/default/index.html#/homeXS`;
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const ALL_SERVICE_ITEM_CARD_ID = "CUS_CARD_ALLSERVICEITEM";
const ALL_SERVICE_ITEM_CARD_WID = "5221461526271929";
const NEWS_ANNOUNCEMENT_CARD_ID = "CUS_CARD_NEWSANNOUNCEMENT";
const NEWS_ANNOUNCEMENT_CARD_WID = "7633185986201947";
const SESSION_PREFIX = buildRedisKey("school-auth", "xjtlu", "ehall-session");
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36";

type CookieMap = Record<string, string>;

interface EhallSession {
  cookies: CookieMap;
  username: string;
  displayName: string;
  createdAt: number;
}

export interface XjtluEhallService {
  id: string;
  kind: "item" | "service";
  name: string;
  description: string;
  category: string;
  department: string;
  icon: string;
  favorite: boolean;
  permission: boolean;
  serviceStation: number;
  online: boolean;
}

export interface XjtluEhallNotice {
  id: string;
  title: string;
  publishedAt: string;
  author: string;
  category: string;
  url: string;
}

function sessionKey(userId: number) {
  return `${SESSION_PREFIX}:${userId}`;
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

function sessionEncryptionKey() {
  return crypto.createHash("sha256").update(`xjtlu-ehall-session:${config.jwtSecret}`).digest();
}

function sealSession(session: EhallSession) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", sessionEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(session), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString("base64url")).join(".");
}

function openSession(value: string): EhallSession | null {
  try {
    const [ivRaw, tagRaw, encryptedRaw] = value.split(".");
    if (!ivRaw || !tagRaw || !encryptedRaw) return null;
    const decipher = crypto.createDecipheriv("aes-256-gcm", sessionEncryptionKey(), Buffer.from(ivRaw, "base64url"));
    decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(encryptedRaw, "base64url")),
      decipher.final(),
    ]).toString("utf8");
    const parsed = JSON.parse(plaintext) as EhallSession;
    if (!parsed || typeof parsed.username !== "string" || !parsed.cookies || typeof parsed.cookies !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

async function saveSession(userId: number, session: EhallSession) {
  await setEphemeralValue(sessionKey(userId), sealSession(session), SESSION_TTL_MS);
}

async function loadSession(userId: number) {
  const raw = await getEphemeralValue(sessionKey(userId));
  if (!raw) return null;
  const session = openSession(raw);
  if (!session) await deleteEphemeralValue(sessionKey(userId));
  return session;
}

/**
 * Export an encrypted copy of an already-authorized eHall session for a
 * server-side background job. The payload is AES-GCM sealed with JWT_SECRET.
 */
export async function exportXjtluEhallSession(userId: number) {
  const session = await loadSession(userId);
  if (!session) throw Errors.conflict("当前账号尚未建立融合门户连接，请重新连接学校服务后再授权公告同步");
  return {
    encryptedSession: sealSession(session),
    username: session.username,
    displayName: session.displayName,
  };
}

async function readLimitedText(response: Response) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) throw new HttpError(502, 5502, "XJTLU 融合门户返回的数据过大");
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total).toString("utf8");
}

async function request(url: string, cookies: CookieMap, init: RequestInit = {}, readBody = false) {
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
        ...(Object.keys(cookies).length ? { Cookie: serializeCookies(cookies) } : {}),
        ...(init.headers ?? {}),
      },
    });
    ingestCookies(cookies, response.headers);
    return { response, text: readBody ? await readLimitedText(response) : "" };
  } catch (error) {
    if ((error as { name?: string })?.name === "AbortError") throw Errors.server("连接 XJTLU 融合门户超时，请稍后重试");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function isAllowedOauthUrl(url: URL) {
  if (url.protocol !== "https:") return false;
  if (url.origin === SSO_ORIGIN && url.pathname === "/esc-sso/oauth2.0/authorize") return true;
  if (url.origin === UIM_ORIGIN) {
    return url.pathname === "/"
      || url.pathname === "/ngw/login"
      || url.pathname === "/esc-sso/login"
      || url.pathname === "/esc-sso/oauth2.0/authorize";
  }
  if (url.origin !== EHALL_ORIGIN) return false;
  return url.pathname === "/"
    || url.pathname === "/index.html"
    || url.pathname === "/login"
    || url.pathname.startsWith("/default/")
    || url.pathname === "/auth-protocol-core/login"
    || url.pathname === "/auth-protocol-core/loginSuccess";
}

function parseEnvelope(text: string) {
  try {
    const parsed = JSON.parse(text) as { errcode?: string | number; errmsg?: string; data?: unknown };
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

async function fetchEhallEnvelope(session: EhallSession, path: string, init: RequestInit = {}) {
  const url = new URL(path, EHALL_ORIGIN);
  if (url.origin !== EHALL_ORIGIN) throw Errors.badRequest("无效的 XJTLU 融合门户接口");
  const result = await request(url.toString(), session.cookies, {
    ...init,
    headers: {
      Referer: EHALL_HOME_URL,
      "X-Requested-With": "XMLHttpRequest",
      ...(init.headers ?? {}),
    },
  }, true);
  if (result.response.status < 200 || result.response.status >= 300) throw Errors.server("XJTLU 融合门户暂时不可用");
  const envelope = parseEnvelope(result.text);
  if (!envelope) throw Errors.server("XJTLU 融合门户返回了无效数据");
  return envelope;
}

export async function establishXjtluEhallSession(
  userId: number,
  expectedUsername: string,
  uimCookies: CookieMap,
) {
  const jars: Record<string, CookieMap> = {
    [EHALL_ORIGIN]: {},
    [SSO_ORIGIN]: {},
    [UIM_ORIGIN]: uimCookies,
  };
  let currentUrl = new URL(EHALL_LOGIN_URL);
  let referer = EHALL_HOME_URL;
  let reachedEhall = false;

  for (let hop = 0; hop < 12; hop += 1) {
    if (!isAllowedOauthUrl(currentUrl)) throw Errors.server("XJTLU 融合门户返回了非预期跳转");
    const jar = jars[currentUrl.origin];
    const result = await request(currentUrl.toString(), jar, {
      headers: { Referer: referer, Accept: "text/html,application/xhtml+xml" },
    });
    if (result.response.status >= 300 && result.response.status < 400) {
      const location = result.response.headers.get("location");
      let target: URL;
      try {
        target = new URL(String(location ?? ""), currentUrl);
      } catch {
        throw Errors.server("XJTLU 融合门户返回了无效跳转");
      }
      if (!isAllowedOauthUrl(target)) {
        console.warn("[xjtlu-ehall] rejected OAuth redirect", {
          fromOrigin: currentUrl.origin,
          fromPath: currentUrl.pathname,
          targetOrigin: target.origin,
          targetPath: target.pathname,
        });
        throw Errors.server("XJTLU 融合门户返回了非预期跳转");
      }
      referer = currentUrl.toString();
      currentUrl = target;
      continue;
    }
    if (result.response.status < 200 || result.response.status >= 300) throw Errors.server("XJTLU 融合门户登录失败");
    reachedEhall = currentUrl.origin === EHALL_ORIGIN;
    break;
  }
  if (!reachedEhall) throw Errors.server("XJTLU 融合门户登录跳转次数过多");

  const probeSession: EhallSession = {
    cookies: jars[EHALL_ORIGIN],
    username: expectedUsername.trim().toLowerCase(),
    displayName: "",
    createdAt: Date.now(),
  };
  const envelope = await fetchEhallEnvelope(probeSession, "/getLoginUser");
  const user = envelope.data && typeof envelope.data === "object" ? envelope.data as Record<string, unknown> : null;
  const actualUsername = String(user?.userAccount ?? "").trim().toLowerCase();
  if (String(envelope.errcode ?? "") !== "0" || !actualUsername) throw Errors.unauthorized("XJTLU 融合门户连接未建立，请重新连接学校服务");
  if (actualUsername !== probeSession.username) throw Errors.forbidden("XJTLU 融合门户返回了不匹配的账号");
  probeSession.displayName = String(user?.userName ?? "").trim();
  await saveSession(userId, probeSession);
  return { username: actualUsername, displayName: probeSession.displayName };
}

export async function getXjtluEhallStatus(userId: number) {
  const session = await loadSession(userId);
  if (!session) return { active: false as const };
  try {
    const envelope = await fetchEhallEnvelope(session, "/getLoginUser");
    const user = envelope.data && typeof envelope.data === "object" ? envelope.data as Record<string, unknown> : null;
    const username = String(user?.userAccount ?? "").trim().toLowerCase();
    if (String(envelope.errcode ?? "") !== "0" || !username || username !== session.username) {
      await deleteEphemeralValue(sessionKey(userId));
      return { active: false as const };
    }
    await saveSession(userId, session);
    return { active: true as const, username, displayName: String(user?.userName ?? session.displayName ?? "").trim() };
  } catch {
    return { active: true as const, username: session.username, displayName: session.displayName };
  }
}

function stringField(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return "";
}

function numberField(record: Record<string, unknown>, key: string, fallback = 0) {
  const value = Number(record[key]);
  return Number.isFinite(value) ? value : fallback;
}

function booleanField(value: unknown, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "string") return value !== "0" && value.toLowerCase() !== "false";
  return Boolean(value);
}

function flattenServices(input: unknown) {
  const services = new Map<string, XjtluEhallService>();
  const seen = new Set<unknown>();
  const visit = (value: unknown, category = "") => {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.length > 1 && trimmed.length <= MAX_BODY_BYTES && (trimmed.startsWith("{") || trimmed.startsWith("["))) {
        try { visit(JSON.parse(trimmed), category); } catch { /* not embedded JSON */ }
      }
      return;
    }
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, category));
      return;
    }
    const record = value as Record<string, unknown>;
    const nextCategory = stringField(record, "folderName", "categoryName", "columnName", "groupName") || category;
    const id = stringField(record, "serviceWid", "serviceId");
    const name = stringField(record, "serviceName", "name");
    const looksLikeService = Boolean(id && name && (
      "pcAccessUrl" in record
      || "mobileAccessUrl" in record
      || "serviceStation" in record
      || "permission" in record
      || "iconLink" in record
      || "iconUrl" in record
    ));
    if (looksLikeService && !services.has(id)) {
      services.set(id, {
        id,
        kind: "service",
        name,
        description: stringField(record, "serviceDesc", "description", "detail"),
        category: nextCategory,
        department: stringField(record, "departmentName", "deptName", "responsibleDept"),
        icon: stringField(record, "iconLink", "iconUrl", "mobileIconLink"),
        favorite: Boolean(record.favorite),
        permission: record.permission !== false && record.permission !== 0,
        serviceStation: numberField(record, "serviceStation", 0),
        online: true,
      });
    }
    Object.values(record).forEach((child) => visit(child, nextCategory));
  };
  visit(input);
  return Array.from(services.values());
}

function flattenServiceItems(input: unknown) {
  const items = new Map<string, XjtluEhallService>();
  const seen = new Set<unknown>();
  const visit = (value: unknown, category = "") => {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.length > 1 && trimmed.length <= MAX_BODY_BYTES && (trimmed.startsWith("{") || trimmed.startsWith("["))) {
        try { visit(JSON.parse(trimmed), category); } catch { /* not embedded JSON */ }
      }
      return;
    }
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, category));
      return;
    }
    const record = value as Record<string, unknown>;
    const nextCategory = stringField(
      record,
      "categoryName",
      "subjectName",
      "folderName",
      "columnName",
      "groupName",
    ) || category;
    const id = stringField(record, "itemWid", "itemId");
    const name = stringField(record, "itemName", "serviceItemName");
    if (id && name && !items.has(id)) {
      const permission = record.isAuthorized !== 0
        && record.isAuthorized !== false
        && record.permission !== 0
        && record.permission !== false;
      items.set(id, {
        id,
        kind: "item",
        name,
        description: stringField(record, "itemDesc", "itemDescription", "serviceDesc", "description", "detail"),
        category: nextCategory,
        department: stringField(record, "deptName", "departmentName", "responsibleDept", "unitName"),
        icon: stringField(record, "iconLink", "iconUrl", "itemIcon", "mobileIconLink", "logoUrl"),
        favorite: booleanField(record.favorite),
        permission,
        serviceStation: 0,
        online: booleanField(record.onlineServiceType) && permission,
      });
    }
    Object.values(record).forEach((child) => visit(child, nextCategory));
  };
  visit(input);
  return Array.from(items.values());
}

function collectCardReferences(input: unknown) {
  const found = new Map<string, { cardId: string; cardWid: string; name: string; keys: string[] }>();
  const seen = new Set<unknown>();
  const visit = (value: unknown) => {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.length > 1 && trimmed.length <= MAX_BODY_BYTES && (trimmed.startsWith("{") || trimmed.startsWith("["))) {
        try { visit(JSON.parse(trimmed)); } catch { /* not embedded JSON */ }
      }
      return;
    }
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const record = value as Record<string, unknown>;
    const cardId = stringField(record, "cardId");
    const cardWid = stringField(record, "cardWid", "wid");
    if (cardId && cardWid) {
      found.set(`${cardWid}:${cardId}`, {
        cardId,
        cardWid,
        name: stringField(record, "cardName", "name", "title"),
        keys: Object.keys(record).slice(0, 30),
      });
    }
    Object.values(record).forEach(visit);
  };
  visit(input);
  return Array.from(found.values());
}

async function getAllServiceItemCard(session: EhallSession) {
  const query = new URLSearchParams({
    pageCode: "hall",
    originalUrl: EHALL_HOME_URL,
    lang: "zh_CN",
  });
  const pageView = await fetchEhallEnvelope(session, `/getPageView?${query.toString()}`, {
    headers: { localPageUrl: encodeURIComponent(EHALL_HOME_URL) },
  });
  const reference = collectCardReferences(pageView.data)
    .find((card) => card.cardId === ALL_SERVICE_ITEM_CARD_ID);
  return {
    cardId: reference?.cardId || ALL_SERVICE_ITEM_CARD_ID,
    cardWid: reference?.cardWid || ALL_SERVICE_ITEM_CARD_WID,
  };
}

async function getNewsAnnouncementCard(session: EhallSession) {
  const query = new URLSearchParams({
    pageCode: "homeXS",
    originalUrl: EHALL_STUDENT_HOME_URL,
    lang: "zh_CN",
  });
  const pageView = await fetchEhallEnvelope(session, `/getPageView?${query.toString()}`, {
    headers: { localPageUrl: encodeURIComponent(EHALL_STUDENT_HOME_URL) },
  });
  const reference = collectCardReferences(pageView.data)
    .find((card) => card.cardId === NEWS_ANNOUNCEMENT_CARD_ID);
  return {
    cardId: reference?.cardId || NEWS_ANNOUNCEMENT_CARD_ID,
    cardWid: reference?.cardWid || NEWS_ANNOUNCEMENT_CARD_WID,
  };
}

function findNewsChannelState(input: unknown) {
  let configured: Record<string, unknown>[] = [];
  let subscribed: Record<string, unknown>[] = [];
  const seen = new Set<unknown>();
  const visit = (value: unknown) => {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.length > 1 && trimmed.length <= MAX_BODY_BYTES && (trimmed.startsWith("{") || trimmed.startsWith("["))) {
        try { visit(JSON.parse(trimmed)); } catch { /* not embedded JSON */ }
      }
      return;
    }
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.configuredChannel)) configured = record.configuredChannel.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"));
    if (Array.isArray(record.subscribedChannel)) subscribed = record.subscribedChannel.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"));
    Object.values(record).forEach(visit);
  };
  visit(input);
  return { configured, subscribed };
}

function flattenNewsNotices(input: unknown) {
  const notices = new Map<string, XjtluEhallNotice>();
  const seen = new Set<unknown>();
  const visit = (value: unknown) => {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.length > 1 && trimmed.length <= MAX_BODY_BYTES && (trimmed.startsWith("{") || trimmed.startsWith("["))) {
        try { visit(JSON.parse(trimmed)); } catch { /* not embedded JSON */ }
      }
      return;
    }
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const record = value as Record<string, unknown>;
    const id = stringField(record, "wid", "newsWid", "newsId", "id");
    const title = stringField(record, "title", "newsTitle");
    if (id && title && !notices.has(id)) {
      const sideFlag = numberField(record, "sideFlag", 0);
      const rawUrl = stringField(record, "url", "newsUrl", "linkUrl", "detailUrl");
      let url = `${EHALL_ORIGIN}/default/index.html#/newsDetail?wid=${encodeURIComponent(id)}`;
      if (sideFlag !== 2 && rawUrl) {
        try {
          const parsed = new URL(rawUrl, EHALL_ORIGIN);
          if (parsed.protocol === "https:" || parsed.protocol === "http:") url = parsed.toString();
        } catch { /* keep the official detail fallback */ }
      }
      notices.set(id, {
        id,
        title,
        publishedAt: stringField(record, "pubTime", "publishTime", "publishedAt", "publishDate", "date"),
        author: stringField(record, "author", "publisher", "source", "departmentName"),
        category: stringField(record, "channelName", "categoryName", "typeName", "newsType") || "通知",
        url,
      });
    }
    Object.values(record).forEach(visit);
  };
  visit(input);
  return Array.from(notices.values());
}

function findNewsPageMeta(input: unknown) {
  let total = 0;
  let pageSize = 0;
  const seen = new Set<unknown>();
  const visit = (value: unknown) => {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.length > 1 && trimmed.length <= MAX_BODY_BYTES && (trimmed.startsWith("{") || trimmed.startsWith("["))) {
        try { visit(JSON.parse(trimmed)); } catch { /* not embedded JSON */ }
      }
      return;
    }
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const record = value as Record<string, unknown>;
    total = Math.max(total, numberField(record, "totalSize", 0), numberField(record, "total", 0));
    pageSize = Math.max(pageSize, numberField(record, "pageSize", 0));
    Object.values(record).forEach(visit);
  };
  visit(input);
  return { total, pageSize };
}

async function execNewsCardMethod(
  session: EhallSession,
  card: { cardId: string; cardWid: string },
  method: string,
  param: Record<string, unknown> = {},
) {
  const envelope = await fetchEhallEnvelope(
    session,
    `/execCardMethod/${encodeURIComponent(card.cardWid)}/${encodeURIComponent(card.cardId)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        cardId: card.cardId,
        cardWid: card.cardWid,
        method,
        param,
        n: encodeURIComponent(Math.random()),
      }),
    },
  );
  if (String(envelope.errcode ?? "") !== "0") {
    if (envelope.errmsg === "notLogin") throw Errors.unauthorized("融合门户连接已失效，请重新连接学校服务");
    throw Errors.server(String(envelope.errmsg || "融合门户通知加载失败"));
  }
  return envelope.data;
}

async function fetchAllServiceItems(session: EhallSession) {
  const card = await getAllServiceItemCard(session);
  const envelope = await fetchEhallEnvelope(
    session,
    `/execCardMethod/${encodeURIComponent(card.cardWid)}/${encodeURIComponent(card.cardId)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        cardId: card.cardId,
        cardWid: card.cardWid,
        method: "searchServiceItem",
        param: {
          searchKey: "",
          categoryWids: "",
          deptWids: "",
          roleWids: "",
          srvDeptWids: "",
          dimensions: "",
          availableOnline: false,
          orderByVisitCount: false,
          pageNumber: 1,
          pageSize: 500,
        },
        n: encodeURIComponent(Math.random()),
      }),
    },
  );
  if (String(envelope.errcode ?? "") !== "0") {
    if (envelope.errmsg === "notLogin") throw Errors.unauthorized("融合门户连接已失效，请重新连接学校服务");
    throw Errors.server(String(envelope.errmsg || "融合门户办事大厅加载失败"));
  }
  return flattenServiceItems(envelope.data);
}

async function requireSession(userId: number) {
  const session = await loadSession(userId);
  if (!session) throw Errors.unauthorized("融合门户连接不存在，请重新连接学校服务");
  return session;
}

export async function getXjtluEhallServices(userId: number) {
  const session = await requireSession(userId);
  const envelope = await fetchEhallEnvelope(session, "/queryFolderAndService", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ n: encodeURIComponent(Math.random()) }),
  });
  if (String(envelope.errcode ?? "") !== "0") {
    if (envelope.errmsg === "notLogin") await deleteEphemeralValue(sessionKey(userId));
    throw Errors.unauthorized("融合门户连接已失效，请重新连接学校服务");
  }
  const favorites = flattenServices(envelope.data);
  const items = await fetchAllServiceItems(session);
  const services = new Map<string, XjtluEhallService>();
  for (const service of [...items, ...favorites]) services.set(`${service.kind}:${service.id}`, service);
  await saveSession(userId, session);
  return Array.from(services.values());
}

async function fetchXjtluEhallNotices(session: EhallSession) {
    const card = await getNewsAnnouncementCard(session);
    const channelData = await execNewsCardMethod(session, card, "getConfiguredAndSubscribedChannel");
    const { subscribed } = findNewsChannelState(channelData);
    const noticeSubscriptions = subscribed.filter((item) => {
      const name = stringField(item, "name", "channelName", "title");
      return name.includes("通知") || /notice/i.test(name);
    });
    const selected = noticeSubscriptions.length ? noticeSubscriptions : subscribed;
    const channelIds = selected
      .filter((item) => numberField(item, "type", 0) === 0)
      .map((item) => stringField(item, "wid", "id"))
      .filter(Boolean)
      .join(",");
    const programIds = selected
      .filter((item) => numberField(item, "type", 0) === 1)
      .map((item) => stringField(item, "wid", "id"))
      .filter(Boolean)
      .join(",");
    const loadPage = (pageNumber: number) => execNewsCardMethod(session, card, "getChannelNews", {
      channelIds,
      programIds,
      pageNumber,
      pageSize: 30,
    });
    const firstPage = await loadPage(1);
    const noticesById = new Map(flattenNewsNotices(firstPage).map((item) => [item.id, item]));
    const pageMeta = findNewsPageMeta(firstPage);
    const expectedPages = pageMeta.total && pageMeta.pageSize
      ? Math.ceil(pageMeta.total / pageMeta.pageSize)
      : 10;
    // 首页卡片固定只回很小的一页；继续按官方新闻列表的页码读取，最多保留 50 条。
    for (let pageNumber = 2; pageNumber <= Math.min(10, expectedPages); pageNumber += 1) {
      const pageItems = flattenNewsNotices(await loadPage(pageNumber));
      if (!pageItems.length) break;
      let added = 0;
      for (const item of pageItems) {
        if (!noticesById.has(item.id)) added += 1;
        noticesById.set(item.id, item);
      }
      if (!added) break;
    }
    let notices = Array.from(noticesById.values()).slice(0, 50);
    if (!noticeSubscriptions.length) {
      const explicitlyCategorized = notices.filter((item) => item.category.includes("通知") || /notice/i.test(item.category));
      if (explicitlyCategorized.length) notices = explicitlyCategorized;
    }
    return notices;
}

export async function getXjtluEhallNoticesFromEncryptedSession(encryptedSession: string) {
  const session = openSession(encryptedSession);
  if (!session) throw Errors.conflict("公告同步授权已失效，请管理员重新连接学校服务并授权");
  const notices = await fetchXjtluEhallNotices(session);
  return {
    notices,
    encryptedSession: sealSession(session),
    username: session.username,
  };
}

export async function getXjtluEhallNotices(userId: number) {
  const session = await loadSession(userId);
  if (!session) return { active: false as const, notices: [] as XjtluEhallNotice[] };
  try {
    const notices = await fetchXjtluEhallNotices(session);
    await saveSession(userId, session);
    return { active: true as const, notices };
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) {
      await deleteEphemeralValue(sessionKey(userId));
      return { active: false as const, notices: [] as XjtluEhallNotice[] };
    }
    throw error;
  }
}

async function resolveItemLaunch(session: EhallSession, item: XjtluEhallService) {
  let current = new URL("/simJump", EHALL_ORIGIN);
  current.search = new URLSearchParams({
    id: item.id,
    name: item.name,
    isOnline: "1",
    langCountry: "zh_CN",
    pageCode: "hall",
  }).toString();
  const original = current.toString();
  let referer = EHALL_HOME_URL;
  for (let hop = 0; hop < 6; hop += 1) {
    const result = await request(current.toString(), session.cookies, {
      headers: { Referer: referer, Accept: "text/html,application/xhtml+xml" },
    }, true);
    if (result.response.status >= 300 && result.response.status < 400) {
      const location = result.response.headers.get("location");
      let target: URL;
      try {
        target = new URL(String(location || ""), current);
      } catch {
        throw Errors.badRequest("融合门户返回了无效的服务入口");
      }
      if (target.protocol !== "https:" && target.protocol !== "http:") {
        throw Errors.badRequest("融合门户服务入口格式不受支持");
      }
      if (target.origin !== EHALL_ORIGIN) return target.toString();
      referer = current.toString();
      current = target;
      continue;
    }
    if (result.response.status >= 200 && result.response.status < 300) {
      const match = result.text.match(/(?:window\.)?location(?:\.href)?\s*=\s*["'](https?:\/\/[^"']+)["']/i);
      if (match?.[1]) return new URL(match[1]).toString();
      return original;
    }
    throw Errors.badRequest("该融合门户服务暂时不可用");
  }
  throw Errors.badRequest("融合门户服务跳转次数过多");
}

function itemGuideUrl(item: XjtluEhallService) {
  const query = new URLSearchParams({ wid: item.id, name: item.name });
  return `${EHALL_ORIGIN}/default/index.html#/itemDetail?${query.toString()}`;
}

export async function getXjtluEhallLaunchUrl(
  userId: number,
  serviceId: string,
  kind: "item" | "service" = "item",
) {
  const id = serviceId.trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw Errors.badRequest("无效的融合门户服务标识");
  const session = await requireSession(userId);
  if (kind === "item") {
    const item = (await fetchAllServiceItems(session)).find((candidate) => candidate.id === id);
    if (!item || !item.permission) throw Errors.forbidden("当前账号无权访问该融合门户服务");
    if (!item.online) {
      await saveSession(userId, session);
      return itemGuideUrl(item);
    }
    const target = await resolveItemLaunch(session, item);
    await saveSession(userId, session);
    return target;
  }
  const query = new URLSearchParams({ serviceId: id, isMobile: "0" });
  const envelope = await fetchEhallEnvelope(session, `/serviceShow?${query.toString()}`);
  if (String(envelope.errcode ?? "") !== "0") {
    if (envelope.errmsg === "notLogin") await deleteEphemeralValue(sessionKey(userId));
    throw Errors.badRequest(String(envelope.errmsg || "该融合门户服务暂时不可用"));
  }
  const data = envelope.data && typeof envelope.data === "object" ? envelope.data as Record<string, unknown> : null;
  const grants = Array.isArray(data?.grantData) ? data.grantData : [];
  if (grants.length > 1) throw Errors.badRequest("该服务有多个角色入口，请先在官方融合门户中选择角色");
  const grant = grants[0] && typeof grants[0] === "object" ? grants[0] as Record<string, unknown> : null;
  const rawUrl = String(grant?.serviceUrl ?? "").trim();
  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    throw Errors.badRequest("该融合门户服务未返回可用入口");
  }
  if (target.protocol !== "https:" && target.protocol !== "http:") throw Errors.badRequest("该融合门户服务入口格式不受支持");
  await saveSession(userId, session);
  return target.toString();
}

export async function clearXjtluEhallSession(userId: number) {
  await deleteEphemeralValue(sessionKey(userId));
}
