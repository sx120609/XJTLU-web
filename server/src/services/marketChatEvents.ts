import type { Request, Response } from "express";

type MarketChatEvent = "conversation" | "message" | "read" | "trade";
const subscribers = new Map<number, Set<Response>>();

function writeEvent(response: Response, event: string, data: unknown) {
  response.write(`event: ${event}\n`);
  response.write(`data: ${JSON.stringify(data)}\n\n`);
}

export function openMarketChatEventStream(userId: number, req: Request, res: Response) {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const userSubscribers = subscribers.get(userId) || new Set<Response>();
  userSubscribers.add(res);
  subscribers.set(userId, userSubscribers);
  writeEvent(res, "ready", { connectedAt: new Date().toISOString() });

  const heartbeat = setInterval(() => {
    try { res.write(": heartbeat\n\n"); } catch { /* connection cleanup follows */ }
  }, 25_000);
  const cleanup = () => {
    clearInterval(heartbeat);
    const current = subscribers.get(userId);
    current?.delete(res);
    if (!current?.size) subscribers.delete(userId);
  };
  req.on("close", cleanup);
  res.on("close", cleanup);
}

export function emitMarketChatEvent(
  userIds: number[],
  event: MarketChatEvent,
  data: unknown,
) {
  for (const userId of new Set(userIds)) {
    const current = subscribers.get(userId);
    if (!current) continue;
    for (const response of [...current]) {
      try {
        writeEvent(response, event, data);
      } catch {
        current.delete(response);
      }
    }
    if (!current.size) subscribers.delete(userId);
  }
}
