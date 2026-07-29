import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { config, isDev } from "../config";
import { csrfCookieValue, isCookieAuthRequest, loadBrowserSession } from "../services/browserSession";
import { getSiteOrigin } from "../services/siteSettings";
import { Errors } from "../utils/response";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function allowedOrigins(req: Request, configuredSiteOrigin = getSiteOrigin()) {
  const host = String(req.get("host") || "").split(",")[0].trim();
  const proto = String(req.get("x-forwarded-proto") || req.protocol || "https").split(",")[0].trim();
  const values = new Set(config.corsAllowedOrigins);
  if (host) values.add(`${proto}://${host}`);
  if (configuredSiteOrigin) values.add(configuredSiteOrigin);
  if (isDev) {
    values.add("http://localhost:5173");
    values.add("http://127.0.0.1:5173");
  }
  return values;
}

export function corsOptionsForRequest(req: Request, configuredSiteOrigin = getSiteOrigin()) {
  const origin = String(req.get("origin") || "").trim();
  return {
    // Credentialed CORS responses must echo a trusted origin; "*" is invalid
    // when the browser sends the opaque session cookie.
    origin: Boolean(origin && allowedOrigins(req, configuredSiteOrigin).has(origin)),
    credentials: true,
  };
}

export async function browserSessionMiddleware(req: Request, res: Response, next: NextFunction) {
  try {
    const loaded = await loadBrowserSession(req, res);
    req.browserSessionId = loaded?.id;
    req.browserSession = loaded?.session;
    next();
  } catch (error) {
    next(error);
  }
}

export function requestOriginAndCsrfProtection(req: Request, _res: Response, next: NextFunction) {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return next();
  const origin = String(req.get("origin") || "").trim();
  const fetchSite = String(req.get("sec-fetch-site") || "").trim().toLowerCase();
  // Browsers compute Sec-Fetch-Site from the public URL before a reverse proxy
  // rewrites Host. Treat an explicit same-origin signal as authoritative so a
  // proxy using its upstream Host cannot break login.
  if (origin && fetchSite !== "same-origin" && !allowedOrigins(req).has(origin)) {
    return next(Errors.forbidden("请求来源不受信任"));
  }
  if (fetchSite === "cross-site") return next(Errors.forbidden("拒绝跨站请求"));
  if (!req.browserSession) return next();
  if (!origin && isCookieAuthRequest(req)) return next(Errors.forbidden("缺少请求来源信息"));
  const headerToken = String(req.get("x-csrf-token") || "");
  const cookieToken = csrfCookieValue(req);
  if (
    !headerToken
    || !cookieToken
    || !safeEqual(headerToken, cookieToken)
    || !safeEqual(headerToken, req.browserSession.csrfToken)
  ) return next(Errors.forbidden("CSRF 校验失败，请刷新页面后重试"));
  next();
}
