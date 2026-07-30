import type { Prisma } from "@prisma/client";
import { Errors } from "../utils/response";

export function reputationPenaltyForSeverity(severity: string) {
  if (["serious", "critical", "high"].includes(severity)) return 30;
  if (["moderate", "medium"].includes(severity)) return 15;
  return 5;
}

export async function applyReputationPenalty(
  tx: Prisma.TransactionClient,
  userId: number,
  severity: string,
) {
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { reputation: true },
  });
  if (!user) throw Errors.notFound("信誉用户不存在");
  const delta = -Math.min(Math.max(0, user.reputation), reputationPenaltyForSeverity(severity));
  if (delta) {
    await tx.user.update({
      where: { id: userId },
      data: { reputation: { increment: delta } },
    });
  }
  return delta;
}

export async function restoreReputationPenalty(
  tx: Prisma.TransactionClient,
  userId: number,
  originalDelta: number,
) {
  if (originalDelta >= 0) return 0;
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { reputation: true },
  });
  if (!user) throw Errors.notFound("信誉用户不存在");
  const delta = Math.min(100 - Math.max(0, user.reputation), Math.abs(originalDelta));
  if (delta > 0) {
    await tx.user.update({
      where: { id: userId },
      data: { reputation: { increment: delta } },
    });
  }
  return delta;
}
