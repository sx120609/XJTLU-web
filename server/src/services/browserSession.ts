import crypto from "node:crypto";
import type { Request, Response } from "express";
import { config, isDev } from "../config";
import { deleteEphemeralValue, getEphemeralValue, setEphemeralValue } from "./cache";
import { buildRedisKey } from "./redis";

export type BrowserSession = {
  version: 1;
  siteToken: string;
  csrfToken: string;
  persistent: boolean;
  createdAt: number;
  lastSeenAt: number;
  absoluteExpiresAt: number;
};

const SESSION_PREFIX = buildRedisKey("auth", "browser-session");
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export const BROWSER_SESSION_COOKIE = isDev ? "xjtlu-session" : "__Host-xjtlu-session";
export const CSRF_COOKIE = isDev ? "xjtlu-csrf" : "__Host-xjtlu-csrf";

function sessionHash(id: string) {
  return crypto.createHash("sha256").update(id).digest("hex");
}

function storageKey(id: string) {
  return `${SESSION_PREFIX}:${sessionHash(id)}`;
}

function encryptionKey() {
  return crypto.createHash("sha256").update(`xjtlu-browser-session:${config.jwtSecret}`).digest();
}

function sealSession(session: BrowserSession) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(session), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString("base64url")).join(".");
}

function openSession(value: string): BrowserSession | null {
  try {
    const [ivRaw, tagRaw, encryptedRaw] = value.split(".");
    if (!ivRaw || !tagRaw || !encryptedRaw) return null;
    const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivRaw, "base64url"));
    decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
    return JSON.parse(Buffer.concat([
      decipher.update(Buffer.from(encryptedRaw, "base64url")),
      decipher.final(),
    ]).toString("utf8")) as BrowserSession;
  } catch {
    return null;
  }
}

function parseCookies(req: Request) {
  const result: Record<string, string> = {};
  for (const part of String(req.headers.cookie || "").split(";")) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    const name = part.slice(0, index).trim();
    if (!name) continue;
    try {
      result[name] = decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      result[name] = part.slice(index + 1).trim();
    }
  }
  return result;
}

function browserSessionId(req: Request) {
  const value = parseCookies(req)[BROWSER_SESSION_COOKIE] || "";
  return /^[A-Za-z0-9_-]{32,128}$/.test(value) ? value : "";
}

export function csrfCookieValue(req: Request) {
  return parseCookies(req)[CSRF_COOKIE] || "";
}

function cookieOptions(maxAge: number | undefined, httpOnly: boolean) {
  return {
    httpOnly,
    secure: !isDev,
    sameSite: "strict" as const,
    path: "/",
    ...(maxAge === undefined ? {} : { maxAge }),
  };
}

function setSessionCookies(res: Response, id: string, session: BrowserSession) {
  const remaining = Math.max(1, Math.min(
    session.persistent ? config.browserSessionAbsoluteMs : config.browserSessionIdleMs,
    session.absoluteExpiresAt - Date.now(),
  ));
  const maxAge = session.persistent ? remaining : undefined;
  res.cookie(BROWSER_SESSION_COOKIE, id, cookieOptions(maxAge, true));
  res.cookie(CSRF_COOKIE, session.csrfToken, cookieOptions(maxAge, false));
  res.setHeader("Cache-Control", "no-store");
}

function validSession(value: BrowserSession): value is BrowserSession {
  return value?.version === 1
    && typeof value.siteToken === "string"
    && value.siteToken.length > 20
    && typeof value.csrfToken === "string"
    && value.csrfToken.length >= 32
    && typeof value.persistent === "boolean"
    && Number.isFinite(value.createdAt)
    && Number.isFinite(value.lastSeenAt)
    && Number.isFinite(value.absoluteExpiresAt);
}

async function saveSession(id: string, session: BrowserSession) {
  const remaining = Math.min(
    session.persistent ? config.browserSessionAbsoluteMs : config.browserSessionIdleMs,
    session.absoluteExpiresAt - Date.now(),
  );
  if (remaining <= 0) {
    await deleteEphemeralValue(storageKey(id));
    return false;
  }
  await setEphemeralValue(storageKey(id), sealSession(session), remaining);
  return true;
}

export async function loadBrowserSession(req: Request, res?: Response) {
  const id = browserSessionId(req);
  if (!id) return null;
  const raw = await getEphemeralValue(storageKey(id));
  if (!raw) return null;
  const session = openSession(raw);
  if (!session || !validSession(session) || session.absoluteExpiresAt <= Date.now()) {
    await deleteEphemeralValue(storageKey(id));
    return null;
  }
  const now = Date.now();
  if (now - session.lastSeenAt >= TOUCH_INTERVAL_MS) {
    session.lastSeenAt = now;
    if (session.persistent) session.absoluteExpiresAt = now + config.browserSessionAbsoluteMs;
    await saveSession(id, session);
  }
  if (res) setSessionCookies(res, id, session);
  return { id, session };
}

export async function issueBrowserSession(
  res: Response,
  input: { siteToken: string; persistent?: boolean },
) {
  const id = crypto.randomBytes(32).toString("base64url");
  const now = Date.now();
  const session: BrowserSession = {
    version: 1,
    siteToken: input.siteToken,
    csrfToken: crypto.randomBytes(32).toString("base64url"),
    persistent: input.persistent !== false,
    createdAt: now,
    lastSeenAt: now,
    absoluteExpiresAt: now + config.browserSessionAbsoluteMs,
  };
  await saveSession(id, session);
  setSessionCookies(res, id, session);
  return session;
}

export async function updateBrowserSession(req: Request, res: Response, siteToken: string) {
  if (!req.browserSession || !req.browserSessionId) return false;
  const next = { ...req.browserSession, siteToken, lastSeenAt: Date.now() };
  const saved = await saveSession(req.browserSessionId, next);
  if (saved) {
    req.browserSession = next;
    setSessionCookies(res, req.browserSessionId, next);
  }
  return saved;
}

export async function revokeBrowserSession(req: Request, res: Response) {
  const id = req.browserSessionId || browserSessionId(req);
  if (id) await deleteEphemeralValue(storageKey(id));
  res.clearCookie(BROWSER_SESSION_COOKIE, cookieOptions(0, true));
  res.clearCookie(CSRF_COOKIE, cookieOptions(0, false));
  res.setHeader("Cache-Control", "no-store");
}

export function isCookieAuthRequest(req: Request) {
  return String(req.get("x-xjtlu-auth-mode") || "").trim().toLowerCase() === "cookie";
}
