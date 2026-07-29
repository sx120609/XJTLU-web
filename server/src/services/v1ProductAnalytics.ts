import { prisma } from "../prisma";

export const V1_PRODUCT_SURFACES = ["schedule", "portal", "square", "market", "learning"] as const;
export type V1ProductSurface = typeof V1_PRODUCT_SURFACES[number];
export type V1ProductSource = V1ProductSurface | "direct";

export function shanghaiDateKey(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export async function recordProductActivity(
  userId: number,
  input: { surface: V1ProductSurface; source: V1ProductSource },
  now = new Date(),
) {
  const dateKey = shanghaiDateKey(now);
  return prisma.productActivityDaily.upsert({
    where: {
      userId_dateKey_surface_source: {
        userId,
        dateKey,
        surface: input.surface,
        source: input.source,
      },
    },
    create: {
      userId,
      dateKey,
      surface: input.surface,
      source: input.source,
      firstVisitedAt: now,
      lastVisitedAt: now,
    },
    update: {
      visitCount: { increment: 1 },
      lastVisitedAt: now,
    },
    select: { dateKey: true, surface: true, source: true, visitCount: true },
  });
}
