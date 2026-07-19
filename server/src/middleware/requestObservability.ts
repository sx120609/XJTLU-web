import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

type HttpRouteSamples = { durations: number[]; requests: number; errors: number; updatedAt: number };
const MAX_HTTP_ROUTES = 120;
const MAX_SAMPLES_PER_ROUTE = 240;
const httpRouteSamples = new Map<string, HttpRouteSamples>();

function normalizedRoutePath(path: string) {
  return path
    .replace(/\/[0-9]+(?=\/|$)/g, "/:id")
    .replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,}(?=\/|$)/gi, "/:uuid")
    .slice(0, 180);
}

function recordHttpDuration(method: string, path: string, status: number, durationMs: number) {
  const key = `${method.toUpperCase()} ${normalizedRoutePath(path)}`;
  if (!httpRouteSamples.has(key) && httpRouteSamples.size >= MAX_HTTP_ROUTES) {
    const oldest = [...httpRouteSamples.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt)[0]?.[0];
    if (oldest) httpRouteSamples.delete(oldest);
  }
  const state = httpRouteSamples.get(key) || { durations: [], requests: 0, errors: 0, updatedAt: Date.now() };
  state.requests += 1;
  if (status >= 500) state.errors += 1;
  state.updatedAt = Date.now();
  state.durations.push(durationMs);
  if (state.durations.length > MAX_SAMPLES_PER_ROUTE) state.durations.splice(0, state.durations.length - MAX_SAMPLES_PER_ROUTE);
  httpRouteSamples.set(key, state);
}

function percentile(values: number[], ratio: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))];
}

export function requestObservability(req: Request, res: Response, next: NextFunction) {
  const requestId = randomUUID();
  const startedAt = process.hrtime.bigint();
  res.locals.requestId = requestId;
  res.setHeader("X-Request-Id", requestId);

  res.once("finish", () => {
    if (!req.originalUrl.startsWith("/api")) return;
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    recordHttpDuration(req.method, req.path, res.statusCode, durationMs);
    const record = {
      type: "http_request",
      requestId,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: Math.round(durationMs * 10) / 10,
      ip: req.ip,
    };
    const line = JSON.stringify(record);
    if (res.statusCode >= 500) console.error(line);
    else if (res.statusCode >= 400) console.warn(line);
    else console.info(line);
  });
  next();
}

export function getHttpPerformanceSnapshot() {
  const routes = [...httpRouteSamples.entries()].map(([route, state]) => ({
    route,
    requests: state.requests,
    errors: state.errors,
    samples: state.durations.length,
    p50Ms: Number(percentile(state.durations, 0.5).toFixed(1)),
    p95Ms: Number(percentile(state.durations, 0.95).toFixed(1)),
    maxMs: Number(Math.max(0, ...state.durations).toFixed(1)),
    updatedAt: new Date(state.updatedAt).toISOString(),
  })).sort((a, b) => b.p95Ms - a.p95Ms);
  return {
    retainedRouteCount: routes.length,
    sampleLimitPerRoute: MAX_SAMPLES_PER_ROUTE,
    slowestRoutes: routes.slice(0, 20),
  };
}

export function requestIdFromResponse(res: Response) {
  return typeof res.locals.requestId === "string" ? res.locals.requestId : "";
}
