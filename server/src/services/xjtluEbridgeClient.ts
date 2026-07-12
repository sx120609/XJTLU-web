import crypto from "node:crypto";
import * as cheerio from "cheerio";
import { config } from "../config";
import { Errors, HttpError } from "../utils/response";
import {
  deleteEphemeralValue,
  getEphemeralValue,
  runWithDistributedLock,
  setEphemeralValue,
} from "./cache";
import { buildRedisKey } from "./redis";

const EBRIDGE_ORIGIN = "https://ebridge.xjtlu.edu.cn";
const UIM_ORIGIN = "https://uim.xjtlu.edu.cn";
const TIMETABLE_ORIGIN = "https://timetableplus.xjtlu.edu.cn";
const EBRIDGE_RUN_PREFIX = "/urd/sits.urd/run/";
const EBRIDGE_LOGIN_URL = `${EBRIDGE_ORIGIN}${EBRIDGE_RUN_PREFIX}SIW_LGN`;
const EBRIDGE_SSO_URL = `${EBRIDGE_ORIGIN}${EBRIDGE_RUN_PREFIX}siw_sso.openid`;
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const SESSION_PREFIX = buildRedisKey("school-auth", "xjtlu", "ebridge-session");
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36";
const sessionOperationTails = new Map<number, Promise<void>>();

type CookieMap = Record<string, string>;

interface EbridgeSession {
  cookies: CookieMap;
  username: string;
  displayName: string;
  homeUrl: string;
  createdAt: number;
}

export interface XjtluAcademicGrade {
  academicYear: string;
  period: string;
  moduleCode: string;
  moduleTitle: string;
  credit: string;
  mark: string;
  grade: string;
  attempt: string;
  additionalLearning: boolean;
  components: XjtluAcademicAssessment[];
}

export interface XjtluAcademicAssessment {
  title: string;
  type: string;
  percentage: string;
  mark: string;
}

export interface XjtluAcademicExam {
  moduleCode: string;
  moduleTitle: string;
  date: string;
  day: string;
  admissionTime: string;
  startTime: string;
  duration: string;
  room: string;
  seat: string;
  area: string;
  entrance: string;
}

export interface XjtluScheduleCourse {
  name: string;
  teacher: string;
  weeks: string;
  weekList: number[];
  location: string;
  slotNote: string;
  startSlot: number;
  endSlot: number;
  sourceKey: string;
}

export interface XjtluScheduleCell {
  day: number;
  bigSlot: number;
  courses: XjtluScheduleCourse[];
}

interface TimetableActivity {
  weekPattern?: unknown;
  scheduledDay?: unknown;
  startTime?: unknown;
  endTime?: unknown;
  activityType?: unknown;
  staff?: unknown;
  location?: unknown;
  moduleId?: unknown;
  identity?: unknown;
  name?: unknown;
}

interface TimetableReference {
  hash: string;
  startWeek: number;
  endWeek: number;
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

function encryptionKey() {
  return crypto.createHash("sha256").update(`xjtlu-ebridge-session:${config.jwtSecret}`).digest();
}

function sealSession(session: EbridgeSession) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(session), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString("base64url")).join(".");
}

function openSession(value: string): EbridgeSession | null {
  try {
    const [ivRaw, tagRaw, encryptedRaw] = value.split(".");
    if (!ivRaw || !tagRaw || !encryptedRaw) return null;
    const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivRaw, "base64url"));
    decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
    const parsed = JSON.parse(Buffer.concat([
      decipher.update(Buffer.from(encryptedRaw, "base64url")),
      decipher.final(),
    ]).toString("utf8")) as EbridgeSession;
    if (
      !parsed
      || typeof parsed.username !== "string"
      || typeof parsed.homeUrl !== "string"
      || !parsed.cookies
      || typeof parsed.cookies !== "object"
    ) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function saveSession(userId: number, session: EbridgeSession) {
  await setEphemeralValue(sessionKey(userId), sealSession(session), config.xjtluPortalSessionIdleMs);
}

/**
 * eBridge may rotate cookies while reading pages. Serializing operations for the
 * same user prevents concurrent overview/schedule requests from writing an old
 * cookie snapshot over a newer one.
 */
async function withSerializedSession<T>(userId: number, task: () => Promise<T>) {
  const previous = sessionOperationTails.get(userId) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.catch(() => undefined).then(() => gate);
  sessionOperationTails.set(userId, tail);
  await previous.catch(() => undefined);
  try {
    for (let attempt = 0; attempt < 150; attempt += 1) {
      const locked = await runWithDistributedLock(
        `xjtlu-ebridge-session:${userId}`,
        120_000,
        task,
      );
      if (locked.acquired) return locked.result as T;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw Errors.conflict("eBridge 数据正在同步，请稍后重试");
  } finally {
    release();
    if (sessionOperationTails.get(userId) === tail) sessionOperationTails.delete(userId);
  }
}

async function loadSession(userId: number) {
  const raw = await getEphemeralValue(sessionKey(userId));
  if (!raw) return null;
  const session = openSession(raw);
  if (!session) await deleteEphemeralValue(sessionKey(userId));
  return session;
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
    if (total > MAX_BODY_BYTES) throw new HttpError(502, 5602, "eBridge 返回的数据过大");
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total).toString("utf8");
}

async function request(url: string, cookies: CookieMap, init: RequestInit = {}, readBody = true) {
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
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        ...(Object.keys(cookies).length ? { Cookie: serializeCookies(cookies) } : {}),
        ...(init.headers ?? {}),
      },
    });
    ingestCookies(cookies, response.headers);
    return { response, text: readBody ? await readLimitedText(response) : "" };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if ((error as { name?: string })?.name === "AbortError") throw new HttpError(504, 5604, "连接 eBridge 超时，请稍后重试");
    throw new HttpError(502, 5602, "暂时无法连接 eBridge，请稍后重试");
  } finally {
    clearTimeout(timer);
  }
}

function isAllowedEbridgeUrl(url: URL) {
  return url.protocol === "https:"
    && url.origin === EBRIDGE_ORIGIN
    && url.pathname.toLowerCase().startsWith(EBRIDGE_RUN_PREFIX);
}

function isAllowedAuthUrl(url: URL) {
  if (isAllowedEbridgeUrl(url)) return true;
  if (url.protocol !== "https:" || url.origin !== UIM_ORIGIN) return false;
  return url.pathname === "/"
    || url.pathname === "/ngw/login"
    || url.pathname === "/esc-sso/login"
    || url.pathname === "/esc-sso/oidc/authorize";
}

function normalizeText(input: string) {
  return input.replace(/[\uE000-\uF8FF]/g, " ").replace(/\s+/g, " ").trim();
}

function isPortalHtml(html: string) {
  const text = normalizeText(cheerio.load(html)("body").text());
  return text.includes("Logout") && text.includes("Home Page");
}

function parseDisplayName(html: string) {
  const text = normalizeText(cheerio.load(html)("body").text());
  const match = text.match(/(?:Skip navigation\s+)?([A-Za-z][A-Za-z .'-]{1,80})\s*\(\s*Logout\s*\)/i);
  return match?.[1]?.trim() || "";
}

type HtmlTransition = { url: URL; init?: RequestInit };

function transitionUrl(value: string, current: URL) {
  try {
    const url = new URL(value.replace(/&amp;/g, "&"), current);
    return isAllowedAuthUrl(url) ? url : null;
  } catch {
    return null;
  }
}

function extractHtmlTransition(html: string, current: URL): HtmlTransition | null {
  const $ = cheerio.load(html);
  const meta = $("meta[http-equiv]").filter((_, element) => String($(element).attr("http-equiv") || "").toLowerCase() === "refresh").first();
  const metaContent = String(meta.attr("content") || "");
  const metaMatch = metaContent.match(/url\s*=\s*["']?([^"']+)/i);
  if (metaMatch?.[1]) {
    const url = transitionUrl(metaMatch[1].trim(), current);
    if (url) return { url };
  }

  const scripts = $("script").map((_, element) => $(element).html() || "").get().join("\n");
  const patterns = [
    /(?:window\.|document\.|top\.)?location(?:\.href)?\s*=\s*["']([^"']+)["']/i,
    /(?:window\.|document\.|top\.)?location\.(?:replace|assign)\(\s*["']([^"']+)["']/i,
  ];
  for (const pattern of patterns) {
    const match = scripts.match(pattern);
    if (!match?.[1]) continue;
    const url = transitionUrl(match[1], current);
    if (url) return { url };
  }

  const form = $("form[action]").first();
  if (form.length) {
    const url = transitionUrl(String(form.attr("action") || ""), current);
    if (url) {
      const params = new URLSearchParams();
      form.find("input[name]").each((_, element) => {
        const name = String($(element).attr("name") || "");
        if (name) params.append(name, String($(element).attr("value") || ""));
      });
      const method = String(form.attr("method") || "GET").toUpperCase();
      if (method === "POST") {
        return {
          url,
          init: {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: params.toString(),
          },
        };
      }
      url.search = params.toString();
      return { url };
    }
  }

  let portalHref = "";
  $("a[href]").each((_, element) => {
    const href = String($(element).attr("href") || "");
    if (!portalHref && /siw_portal\.url/i.test(href)) portalHref = href;
  });
  const url = portalHref ? transitionUrl(portalHref, current) : null;
  return url ? { url } : null;
}

export async function establishXjtluEbridgeSession(
  userId: number,
  expectedUsername: string,
  uimCookies: CookieMap,
) {
  const jars: Record<string, CookieMap> = {
    [EBRIDGE_ORIGIN]: {},
    [UIM_ORIGIN]: uimCookies,
  };
  let current = new URL(EBRIDGE_SSO_URL);
  let referer = EBRIDGE_LOGIN_URL;
  let init: RequestInit = {};

  for (let hop = 0; hop < 16; hop += 1) {
    if (!isAllowedAuthUrl(current)) throw Errors.server("eBridge 返回了非预期登录跳转");
    const result = await request(current.toString(), jars[current.origin], {
      ...init,
      headers: { Referer: referer, ...(init.headers ?? {}) },
    });
    init = {};
    if (result.response.status >= 300 && result.response.status < 400) {
      const location = result.response.headers.get("location");
      let target: URL;
      try {
        target = new URL(String(location || ""), current);
      } catch {
        throw Errors.server("eBridge 返回了无效登录跳转");
      }
      if (!isAllowedAuthUrl(target)) throw Errors.server("eBridge 返回了非预期登录跳转");
      referer = current.toString();
      current = target;
      continue;
    }
    if (result.response.status < 200 || result.response.status >= 300) throw Errors.server("eBridge 登录失败");
    if (current.origin === EBRIDGE_ORIGIN && isPortalHtml(result.text)) {
      const session: EbridgeSession = {
        cookies: jars[EBRIDGE_ORIGIN],
        username: expectedUsername.trim().toLowerCase(),
        displayName: parseDisplayName(result.text),
        homeUrl: current.toString(),
        createdAt: Date.now(),
      };
      await saveSession(userId, session);
      return { username: session.username, displayName: session.displayName };
    }
    const transition = current.origin === EBRIDGE_ORIGIN ? extractHtmlTransition(result.text, current) : null;
    if (!transition) throw Errors.unauthorized("eBridge 会话未建立，请重新使用 XJTLU 账号登录");
    referer = current.toString();
    current = transition.url;
    init = transition.init ?? {};
  }
  throw Errors.server("eBridge 登录跳转次数过多");
}

async function requireSession(userId: number) {
  const session = await loadSession(userId);
  if (!session) throw Errors.unauthorized("eBridge 会话不存在，请退出后重新使用 XJTLU 账号登录");
  return session;
}

async function fetchPage(session: EbridgeSession, input: string) {
  let current: URL;
  try {
    current = new URL(input, session.homeUrl);
  } catch {
    throw Errors.badRequest("无效的 eBridge 页面地址");
  }
  if (!isAllowedEbridgeUrl(current)) throw Errors.badRequest("无效的 eBridge 页面地址");
  let referer = session.homeUrl;
  for (let hop = 0; hop < 6; hop += 1) {
    const result = await request(current.toString(), session.cookies, { headers: { Referer: referer } });
    if (result.response.status >= 300 && result.response.status < 400) {
      const location = result.response.headers.get("location");
      let target: URL;
      try {
        target = new URL(String(location || ""), current);
      } catch {
        throw Errors.server("eBridge 返回了无效页面跳转");
      }
      if (!isAllowedEbridgeUrl(target)) throw Errors.server("eBridge 返回了非预期页面跳转");
      referer = current.toString();
      current = target;
      continue;
    }
    if (result.response.status < 200 || result.response.status >= 300) throw Errors.server("eBridge 页面暂时不可用");
    const title = normalizeText(cheerio.load(result.text)("title").text());
    if (/log in to the portal/i.test(title) || /Portal Login/.test(result.text)) {
      throw Errors.unauthorized("eBridge 会话已失效，请重新登录");
    }
    return { html: result.text, url: current.toString() };
  }
  throw Errors.server("eBridge 页面跳转次数过多");
}

function findLink(html: string, baseUrl: string, label: string) {
  const $ = cheerio.load(html);
  let href = "";
  $("a[href]").each((_, element) => {
    if (href) return;
    const text = normalizeText($(element).text());
    if (text === label || text.includes(label)) href = String($(element).attr("href") || "");
  });
  if (!href) throw Errors.server(`eBridge 未返回${label}入口`);
  const url = new URL(href, baseUrl);
  if (!isAllowedEbridgeUrl(url)) throw Errors.server(`eBridge 返回了无效的${label}入口`);
  return url.toString();
}

function findLinkDetails(html: string, baseUrl: string, label: string) {
  const $ = cheerio.load(html);
  let href = "";
  let text = "";
  $("a[href]").each((_, element) => {
    if (href) return;
    const candidate = normalizeText($(element).text());
    if (candidate === label || candidate.includes(label)) {
      href = String($(element).attr("href") || "");
      text = candidate;
    }
  });
  if (!href) throw Errors.server(`eBridge 未返回 ${label} 入口`);
  const url = new URL(href, baseUrl);
  if (!isAllowedEbridgeUrl(url)) throw Errors.server(`eBridge 返回了无效的 ${label} 入口`);
  return { url: url.toString(), label: text };
}

function findOptionalLink(html: string, baseUrl: string, label: string) {
  const $ = cheerio.load(html);
  let href = "";
  $("a[href]").each((_, element) => {
    if (href) return;
    const candidate = normalizeText($(element).text());
    if (candidate === label || candidate.includes(label)) href = String($(element).attr("href") || "");
  });
  if (!href) return "";
  const url = new URL(href, baseUrl);
  return isAllowedEbridgeUrl(url) ? url.toString() : "";
}

function extractTimetableReference(html: string): TimetableReference {
  const $ = cheerio.load(html);
  const candidates = $("iframe[src]").map((_, element) => String($(element).attr("src") || "")).get();
  for (const candidate of candidates) {
    let url: URL;
    try {
      url = new URL(candidate);
    } catch {
      continue;
    }
    if (url.protocol !== "https:" || url.origin !== TIMETABLE_ORIGIN || !/^\/pt\/?$/i.test(url.pathname)) continue;
    const match = url.hash.match(/^#\/([a-f0-9]{64})(?:\?(.*))?$/i);
    if (!match?.[1]) continue;
    const params = new URLSearchParams(match[2] || "");
    const startWeek = Number(params.get("start"));
    const endWeek = Number(params.get("end"));
    if (
      !Number.isInteger(startWeek)
      || !Number.isInteger(endWeek)
      || startWeek < 1
      || endWeek > 30
      || startWeek > endWeek
    ) continue;
    return { hash: match[1], startWeek, endWeek };
  }
  throw Errors.server("eBridge 未返回有效的个人课表数据入口");
}

function parseWeekPattern(value: unknown, startWeek: number, endWeek: number) {
  const source = String(value ?? "").trim();
  const weeks = new Set<number>();
  for (const part of source.split(",")) {
    const match = part.trim().match(/^(\d{1,2})(?:\s*-\s*(\d{1,2}))?$/);
    if (!match) continue;
    const start = Number(match[1]);
    const end = Number(match[2] || match[1]);
    for (let week = Math.min(start, end); week <= Math.max(start, end); week += 1) {
      if (week >= startWeek && week <= endWeek) weeks.add(week);
    }
  }
  return [...weeks].sort((a, b) => a - b);
}

function shanghaiTimeParts(value: unknown) {
  const date = new Date(String(value ?? ""));
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: string) => Number(parts.find((item) => item.type === type)?.value ?? NaN);
  const hour = part("hour");
  const minute = part("minute");
  return Number.isFinite(hour) && Number.isFinite(minute) ? { date, hour, minute } : null;
}

function formatShanghaiTime(date: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

function parseTimetableActivities(
  activities: TimetableActivity[],
  startWeek: number,
  endWeek: number,
) {
  const grouped = new Map<string, XjtluScheduleCell>();
  for (const activity of activities) {
    const scheduledDay = Number(activity.scheduledDay);
    const day = scheduledDay + 1;
    if (!Number.isInteger(scheduledDay) || day < 1 || day > 7) continue;
    const start = shanghaiTimeParts(activity.startTime);
    const end = shanghaiTimeParts(activity.endTime);
    if (!start || !end || end.date <= start.date) continue;
    const startMinutes = start.hour * 60 + start.minute;
    const endMinutes = end.hour * 60 + end.minute;
    const startSlot = Math.floor((startMinutes - 9 * 60) / 60) + 1;
    const endSlot = Math.ceil((endMinutes - 9 * 60) / 60);
    if (startSlot < 1 || endSlot > 12 || startSlot > endSlot) continue;
    const weekList = parseWeekPattern(activity.weekPattern, startWeek, endWeek);
    if (!weekList.length) continue;
    const bigSlot = Math.max(1, Math.ceil(startSlot / 2));
    const groupKey = `${day}:${bigSlot}`;
    const cell = grouped.get(groupKey) ?? { day, bigSlot, courses: [] };
    const displayEnd = new Date(end.date.getTime() - 10 * 60 * 1000);
    const moduleId = normalizeText(String(activity.moduleId ?? ""));
    const activityType = normalizeText(String(activity.activityType ?? ""));
    const officialName = normalizeText(String(activity.name ?? ""));
    const course: XjtluScheduleCourse = {
      name: officialName || [moduleId, activityType].filter(Boolean).join(" · ") || "XJTLU Course",
      teacher: normalizeText(String(activity.staff ?? "")),
      weeks: String(activity.weekPattern ?? "").trim(),
      weekList,
      location: normalizeText(String(activity.location ?? "")),
      slotNote: `${formatShanghaiTime(start.date)} - ${formatShanghaiTime(displayEnd)}`,
      startSlot,
      endSlot,
      sourceKey: normalizeText(String(activity.identity ?? "")) || `${officialName}|${day}|${startSlot}|${weekList.join(",")}`,
    };
    cell.courses.push(course);
    grouped.set(groupKey, cell);
  }
  return [...grouped.values()].sort((a, b) => a.day - b.day || a.bigSlot - b.bigSlot);
}

function ymd(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function addUtcDays(date: Date, days: number) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));
}

function mondayOnOrAfter(year: number, monthIndex: number, day: number) {
  const anchor = new Date(Date.UTC(year, monthIndex, day));
  const weekday = anchor.getUTCDay() || 7;
  return addUtcDays(anchor, (8 - weekday) % 7);
}

function timetableSemester(label: string) {
  const match = label.match(/(20\d{2})\s*\/\s*(\d{2}).*?S\s*([12])/i);
  const startYear = Number(match?.[1] || 0);
  const endYear = match ? Math.floor(startYear / 100) * 100 + Number(match[2]) : 0;
  const season = Number(match?.[3] || 0);
  if (!startYear || !endYear || ![1, 2].includes(season)) throw Errors.server("无法识别 eBridge 个人课表学期");
  const value = `${startYear}/${String(endYear).slice(-2)}-S${season}`;
  const display = `${startYear}/${String(endYear).slice(-2)} 第${season === 1 ? "一" : "二"}学期`;
  const officialStarts: Record<string, string> = {
    "2025/26-S1": "2025-09-08",
    "2025/26-S2": "2026-03-02",
  };
  const inferred = season === 1
    ? mondayOnOrAfter(startYear, 8, 7)
    : mondayOnOrAfter(endYear, 2, 1);
  const weekOne = officialStarts[value]
    ? new Date(`${officialStarts[value]}T00:00:00Z`)
    : inferred;
  return { value, display, weekOne };
}

function buildTimetableCalendar(label: string, startWeek: number, endWeek: number) {
  const semester = timetableSemester(label);
  const weeks = Array.from({ length: endWeek - startWeek + 1 }, (_, index) => {
    const week = startWeek + index;
    const monday = addUtcDays(semester.weekOne, (week - 1) * 7);
    const days = Array.from({ length: 7 }, (__, offset) => ymd(addUtcDays(monday, offset)));
    return { week, days, monday: days[0], sunday: days[6] };
  });
  const nowParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const nowPart = (type: string) => Number(nowParts.find((item) => item.type === type)?.value ?? 0);
  const today = new Date(Date.UTC(nowPart("year"), nowPart("month") - 1, nowPart("day")));
  const rawCurrent = Math.floor((today.getTime() - semester.weekOne.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1;
  const currentWeek = Math.max(startWeek, Math.min(endWeek, rawCurrent));
  return {
    semester,
    calendar: {
      currentWeek,
      semesterStart: weeks[0]?.monday || ymd(semester.weekOne),
      semesterEnd: weeks[weeks.length - 1]?.sunday || ymd(semester.weekOne),
      weeks,
    },
  };
}

async function fetchTimetableActivities(reference: TimetableReference) {
  const url = new URL(`${TIMETABLE_ORIGIN}/ptapi/api/enrollment/hash/${reference.hash}/activity`);
  url.searchParams.set("start", String(reference.startWeek));
  url.searchParams.set("end", String(reference.endWeek));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  timer.unref?.();
  let payload: unknown;
  try {
    const response = await fetch(url.toString(), {
      redirect: "manual",
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
      },
    });
    if (response.status < 200 || response.status >= 300) {
      throw Errors.server("学校个人课表接口暂时不可用");
    }
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > MAX_BODY_BYTES) throw Errors.server("学校个人课表返回的数据过大");
    payload = await response.json();
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if ((error as { name?: string })?.name === "AbortError") {
      throw new HttpError(504, 5604, "连接学校个人课表超时，请稍后重试");
    }
    throw Errors.server("学校个人课表返回了无效数据");
  } finally {
    clearTimeout(timer);
  }
  const source = findActivityArray(payload);
  if (!source) throw Errors.server("学校个人课表返回了无效数据");
  return source;
}

function findActivityArray(value: unknown, depth = 0): TimetableActivity[] | null {
  if (depth > 4) return null;
  if (Array.isArray(value)) {
    if (!value.length) return [];
    const looksLikeActivities = value.some((item) => (
      item
      && typeof item === "object"
      && ("scheduledDay" in item || "weekPattern" in item)
      && ("startTime" in item || "endTime" in item)
    ));
    if (looksLikeActivities) return value as TimetableActivity[];
    for (const item of value) {
      const nested = findActivityArray(item, depth + 1);
      if (nested) return nested;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  for (const nestedValue of Object.values(value as Record<string, unknown>)) {
    const nested = findActivityArray(nestedValue, depth + 1);
    if (nested) return nested;
  }
  return null;
}

function tableHeaders($: cheerio.CheerioAPI, table: any) {
  const headers: string[] = [];
  const firstOwnRow = $(table).find("tr").filter((_, row) => $(row).closest("table").get(0) === table).first();
  firstOwnRow.children("th").each((_, element) => {
    headers.push(normalizeText($(element).text()));
  });
  return headers;
}

function rowValues($: cheerio.CheerioAPI, row: any) {
  return $(row).children("td").map((_, element) => {
    const cell = $(element).clone();
    cell.find("table").remove();
    return normalizeText(cell.text());
  }).get();
}

function valueAt(headers: string[], values: string[], name: string) {
  const index = headers.findIndex((header) => header.toLowerCase() === name.toLowerCase());
  return index >= 0 ? values[index] || "" : "";
}

function parseApprovedComponents($: cheerio.CheerioAPI, row: any): XjtluAcademicAssessment[] {
  const components: XjtluAcademicAssessment[] = [];
  $(row).find("table").each((_, table) => {
    const headers = tableHeaders($, table);
    if (!headers.includes("Component title") || !headers.includes("Assessment type") || !headers.includes("Weight") || !headers.includes("Mark")) return;
    $(table).find("tr").filter((__, nestedRow) => $(nestedRow).closest("table").get(0) === table).each((__, nestedRow) => {
      const values = rowValues($, nestedRow);
      const title = valueAt(headers, values, "Component title");
      if (!title) return;
      components.push({
        title,
        type: valueAt(headers, values, "Assessment type"),
        percentage: valueAt(headers, values, "Weight"),
        mark: valueAt(headers, values, "Mark"),
      });
    });
  });
  return components;
}

export function parseXjtluAcademicRecords(html: string) {
  const $ = cheerio.load(html);
  const pageText = normalizeText($("body").text());
  const studentMatch = pageText.match(/Student ID\s*(\d+)\s*Student Name\s*(.+?)\s*For 2\+2/i);
  const academicYear = $("h2").map((_, element) => normalizeText($(element).text())).get()
    .find((text) => /Academic Year Records/i.test(text))?.replace(/\s*Academic Year Records.*$/i, "") || "";
  const grades: XjtluAcademicGrade[] = [];
  let tableAcademicYear = "";
  $("h2, table").each((_, element) => {
    if (element.tagName?.toLowerCase() === "h2") {
      const heading = normalizeText($(element).text());
      const match = heading.match(/(\d{4}\/\d{2})\s+Academic Year Records/i);
      if (match?.[1]) tableAcademicYear = match[1];
      return;
    }
    const table = element;
    if ($(table).parents("table").length) return;
    const headers = tableHeaders($, table);
    if (!headers.includes("Module Code") || !headers.includes("Module Title") || !headers.includes("Mark")) return;
    const additionalLearning = !headers.includes("Credit");
    $(table).find("tr").filter((__, row) => $(row).closest("table").get(0) === table).each((__, row) => {
      const values = rowValues($, row);
      const moduleCode = valueAt(headers, values, "Module Code");
      const moduleTitle = valueAt(headers, values, "Module Title");
      if (!moduleCode || !moduleTitle) return;
      grades.push({
        academicYear: tableAcademicYear || academicYear,
        period: valueAt(headers, values, "Period"),
        moduleCode,
        moduleTitle,
        credit: valueAt(headers, values, "Credit"),
        mark: valueAt(headers, values, "Mark"),
        grade: valueAt(headers, values, "Grade"),
        attempt: valueAt(headers, values, "Attempt"),
        additionalLearning,
        components: parseApprovedComponents($, row),
      });
    });
  });
  return {
    student: { id: studentMatch?.[1] || "", name: studentMatch?.[2]?.trim() || "" },
    academicYear,
    grades,
  };
}

interface XjtluComponentRecord {
  academicYear: string;
  period: string;
  moduleCode: string;
  moduleTitle: string;
  credit: string;
  components: XjtluAcademicAssessment[];
}

export function parseXjtluComponentMarks(html: string): XjtluComponentRecord[] {
  const $ = cheerio.load(html);
  const records: XjtluComponentRecord[] = [];
  $("h2").each((_, heading) => {
    const text = normalizeText($(heading).text());
    const match = text.match(/^([A-Z0-9_-]+)\s+(.+?)\s+-\s+(\d{4}\/\d{2})\s+(.+?)\s+-\s+([\d.]+)\s+Credits?$/i);
    if (!match) return;
    let table = $(heading).closest(".sv-panel").find("table").first();
    let cursor = $(heading).next();
    while (!table.length && cursor.length && cursor.get(0)?.tagName?.toLowerCase() !== "h2") {
      if (cursor.get(0)?.tagName?.toLowerCase() === "table") {
        table = cursor;
        break;
      }
      const nested = cursor.find("table").first();
      if (nested.length) {
        table = nested;
        break;
      }
      cursor = cursor.next();
    }
    if (!table.length) return;
    const headers = tableHeaders($, table.get(0));
    if (!headers.includes("Assessment Title") || !headers.includes("Percentage") || !headers.includes("Marks")) return;
    const components: XjtluAcademicAssessment[] = [];
    table.find("tr").each((__, row) => {
      const values = rowValues($, row);
      const title = valueAt(headers, values, "Assessment Title");
      if (!title) return;
      components.push({
        title,
        type: valueAt(headers, values, "Assessment Type"),
        percentage: valueAt(headers, values, "Percentage"),
        mark: valueAt(headers, values, "Marks"),
      });
    });
    records.push({
      moduleCode: match[1],
      moduleTitle: match[2],
      academicYear: match[3],
      period: match[4],
      credit: match[5],
      components,
    });
  });
  return records;
}

function mergeComponentMarks(grades: XjtluAcademicGrade[], componentRecords: XjtluComponentRecord[]) {
  const key = (value: { academicYear: string; period: string; moduleCode: string }) => [
    value.academicYear.trim().toLowerCase(),
    value.period.trim().toLowerCase(),
    value.moduleCode.trim().toLowerCase(),
  ].join("|");
  const byKey = new Map(grades.map((grade) => [key(grade), grade]));
  for (const record of componentRecords) {
    const existing = byKey.get(key(record));
    if (existing) {
      existing.components = record.components;
      continue;
    }
    const grade: XjtluAcademicGrade = {
      academicYear: record.academicYear,
      period: record.period,
      moduleCode: record.moduleCode,
      moduleTitle: record.moduleTitle,
      credit: record.credit,
      mark: "",
      grade: "",
      attempt: "",
      additionalLearning: false,
      components: record.components,
    };
    grades.push(grade);
    byKey.set(key(grade), grade);
  }
  return grades;
}

export function parseXjtluExamTimetable(html: string) {
  const $ = cheerio.load(html);
  const exams: XjtluAcademicExam[] = [];
  $("table").each((_, table) => {
    if ($(table).parents("table").length) return;
    const headers = tableHeaders($, table);
    if (!headers.includes("Module Code") || !headers.includes("Exam Start Time") || !headers.includes("Exam Room/Campus")) return;
    $(table).find("tr").filter((__, row) => $(row).closest("table").get(0) === table).each((__, row) => {
      const values = rowValues($, row);
      const moduleCode = valueAt(headers, values, "Module Code");
      if (!moduleCode) return;
      exams.push({
        moduleCode,
        moduleTitle: valueAt(headers, values, "Module Title"),
        date: valueAt(headers, values, "Date"),
        day: valueAt(headers, values, "Day"),
        admissionTime: valueAt(headers, values, "Admission Time"),
        startTime: valueAt(headers, values, "Exam Start Time"),
        duration: valueAt(headers, values, "Exam Duration"),
        room: valueAt(headers, values, "Exam Room/Campus"),
        seat: valueAt(headers, values, "Seat No."),
        area: valueAt(headers, values, "Area"),
        entrance: valueAt(headers, values, "Entrance"),
      });
    });
  });
  return exams;
}

export async function getXjtluEbridgeStatus(userId: number, verify = false) {
  const session = await loadSession(userId);
  if (!session) return { active: false as const };
  if (!verify) {
    return { active: true as const, username: session.username, displayName: session.displayName };
  }
  try {
    const home = await fetchPage(session, session.homeUrl);
    if (!isPortalHtml(home.html)) {
      await deleteEphemeralValue(sessionKey(userId));
      return { active: false as const };
    }
    session.homeUrl = home.url;
    session.displayName = parseDisplayName(home.html) || session.displayName;
    await saveSession(userId, session);
    return { active: true as const, username: session.username, displayName: session.displayName };
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) {
      await deleteEphemeralValue(sessionKey(userId));
      return { active: false as const };
    }
    return { active: true as const, username: session.username, displayName: session.displayName };
  }
}

async function getXjtluAcademicOverviewUnlocked(userId: number) {
  const session = await requireSession(userId);
  try {
    const home = await fetchPage(session, session.homeUrl);
    session.homeUrl = home.url;
    const recordsUrl = findLink(home.html, home.url, "Academic Records");
    const timetableUrl = findLink(home.html, home.url, "Timetables");
    const recordsPage = await fetchPage(session, recordsUrl);
    const fullRecordsUrl = findLink(recordsPage.html, recordsPage.url, "Full Academic Records");
    const componentMarksUrl = findOptionalLink(recordsPage.html, recordsPage.url, "Component Marks");
    const fullRecordsPage = await fetchPage(session, fullRecordsUrl);
    const componentMarksPage = componentMarksUrl ? await fetchPage(session, componentMarksUrl) : null;
    const timetablePage = await fetchPage(session, timetableUrl);
    const records = parseXjtluAcademicRecords(fullRecordsPage.html);
    if (componentMarksPage) {
      records.grades = mergeComponentMarks(records.grades, parseXjtluComponentMarks(componentMarksPage.html));
    }
    const exams = parseXjtluExamTimetable(timetablePage.html);
    const overview = {
      ...records,
      exams,
      updatedAt: new Date().toISOString(),
    };
    if (!overview.student?.id && !overview.student?.name) {
      throw new HttpError(502, 5605, "eBridge 学业记录结构暂时无法识别，请稍后重试");
    }
    await saveSession(userId, session);
    return overview;
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) await deleteEphemeralValue(sessionKey(userId));
    throw error;
  }
}

async function getXjtluAcademicScheduleUnlocked(userId: number) {
  const session = await requireSession(userId);
  try {
    const home = await fetchPage(session, session.homeUrl);
    session.homeUrl = home.url;
    const timetablesUrl = findLink(home.html, home.url, "Timetables");
    const timetablesPage = await fetchPage(session, timetablesUrl);
    const personalLink = findLinkDetails(
      timetablesPage.html,
      timetablesPage.url,
      "My Personal Class Timetable",
    );
    const personalPage = await fetchPage(session, personalLink.url);
    const reference = extractTimetableReference(personalPage.html);
    const activities = await fetchTimetableActivities(reference);
    const cells = parseTimetableActivities(activities, reference.startWeek, reference.endWeek);
    const { semester, calendar } = buildTimetableCalendar(
      personalLink.label,
      reference.startWeek,
      reference.endWeek,
    );
    const weeks = Array.from(
      { length: reference.endWeek - reference.startWeek + 1 },
      (_, index) => {
        const value = String(reference.startWeek + index);
        return { value, label: `第 ${value} 周`, current: value === String(calendar.currentWeek) };
      },
    );
    const schedule = {
      parsed: {
        semesters: [{ value: semester.value, label: semester.display, current: true }],
        weeks,
        currentSemester: semester.value,
        currentWeek: String(calendar.currentWeek),
        cells,
      },
      calendar,
      source: {
        fetchedAt: new Date().toISOString(),
        semesterLabel: semester.display,
        activityCount: activities.length,
      },
    };
    if (
      !schedule.parsed.currentSemester
      || schedule.parsed.semesters.length === 0
      || schedule.parsed.weeks.length === 0
      || !schedule.calendar.semesterStart
      || !schedule.calendar.semesterEnd
    ) {
      throw new HttpError(502, 5605, "eBridge 课表结构暂时无法识别，请稍后重试");
    }
    await saveSession(userId, session);
    return schedule;
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) await deleteEphemeralValue(sessionKey(userId));
    throw error;
  }
}

export function getXjtluAcademicOverview(userId: number) {
  return withSerializedSession(userId, () => getXjtluAcademicOverviewUnlocked(userId));
}

export function getXjtluAcademicSchedule(userId: number) {
  return withSerializedSession(userId, () => getXjtluAcademicScheduleUnlocked(userId));
}

export async function clearXjtluEbridgeSession(userId: number) {
  await deleteEphemeralValue(sessionKey(userId));
}
