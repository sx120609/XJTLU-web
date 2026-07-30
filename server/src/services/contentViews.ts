import crypto from "node:crypto";
import type { Request } from "express";
import { config } from "../config";
import { prisma } from "../prisma";

export type ViewTargetType = "topic" | "market_item" | "wanted_post";

function dailyKey(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function viewerDigest(req: Request, dayKey: string) {
  const identity = req.user?.userId
    ? `user:${req.user.userId}`
    : `guest:${req.ip || req.socket.remoteAddress || ""}:${req.get("user-agent") || ""}`;
  return crypto
    .createHash("sha256")
    .update(`kaopu-content-view:${config.jwtSecret}:${dayKey}:${identity}`)
    .digest("hex");
}

/**
 * 刷新页面不重复计数。同一登录用户或匿名访问摘要每天对同一内容最多贡献一次浏览。
 */
export async function recordUniqueContentView(
  req: Request,
  targetType: ViewTargetType,
  targetId: number,
) {
  const dayKey = dailyKey();
  return prisma.$transaction(async (tx) => {
    const inserted = await tx.contentViewDaily.createMany({
      data: {
        targetType,
        targetId,
        viewerKey: viewerDigest(req, dayKey),
        dayKey,
      },
      skipDuplicates: true,
    });
    if (!inserted.count) return false;

    if (targetType === "topic") {
      await tx.topic.updateMany({
        where: { id: targetId, hidden: false },
        data: { viewCount: { increment: 1 } },
      });
    } else if (targetType === "market_item") {
      await tx.marketItem.updateMany({
        where: { id: targetId, status: { not: "draft" } },
        data: { viewCount: { increment: 1 } },
      });
    } else {
      await tx.wantedPost.updateMany({
        where: { id: targetId, status: { notIn: ["reviewing", "removed"] } },
        data: { viewCount: { increment: 1 } },
      });
    }
    return true;
  });
}
