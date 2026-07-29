import { prisma } from "../prisma";

/**
 * Marketplace notifications are deliberately best-effort. A notification
 * outage must not roll back a trade that has already committed.
 */
export async function notifyMarketUser(
  userId: number,
  title: string,
  content: string,
  link: string,
  payload: Record<string, unknown>,
  db: any = prisma,
) {
  await db.notification.create({
    data: {
      userId,
      category: "market",
      level: "normal",
      title,
      content,
      link,
      source: "靠浦校园市集",
      payload: JSON.stringify(payload),
    },
  }).catch(() => null);
}
