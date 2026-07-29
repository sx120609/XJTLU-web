import { prisma } from "../prisma";
import { runWithDistributedLock } from "./cache";
import { acquireMarketOrderLock } from "./marketOrderLockService";
import { runTrackedJob } from "./runtimeHealth";

type MatchableItem = {
  id: number;
  sellerId: number;
  title: string;
  description: string;
  category: string;
  priceCents: number;
  condition: string;
  campus: string;
  location?: string;
  brand?: string;
  model?: string;
};

type MatchableWantedPost = {
  id: number;
  authorId: number;
  title: string;
  description: string;
  category: string;
  budgetMinCents: number;
  budgetMaxCents: number;
  condition: string;
  campus: string;
  location?: string;
  brandModel?: string;
};

export type MarketMatchReason = {
  key: "category" | "budget" | "campus" | "keyword" | "condition";
  label: string;
  points: number;
};

export type MarketMatchScore = {
  score: number;
  reasons: MarketMatchReason[];
};

const MATCH_NOTIFICATION_THRESHOLD = 60;
const MATCH_NOTIFICATION_LIMIT = 5;
const MARKET_REMINDER_INTERVAL_MS = 15 * 60_000;
let marketReminderPollerStarted = false;

function normalize(value: string | null | undefined) {
  return String(value || "").trim().toLocaleLowerCase("zh-CN");
}

function searchTerms(value: string) {
  const text = normalize(value);
  const terms = new Set<string>();
  for (const match of text.matchAll(/[a-z0-9]+/g)) {
    if (match[0].length >= 2) terms.add(match[0]);
  }
  for (const match of text.matchAll(/[\u3400-\u9fff]+/g)) {
    const chars = [...match[0]];
    if (chars.length === 1) terms.add(chars[0]);
    for (let index = 0; index < chars.length - 1; index += 1) {
      terms.add(`${chars[index]}${chars[index + 1]}`);
    }
  }
  return terms;
}

function keywordPoints(item: MatchableItem, wanted: MatchableWantedPost) {
  const itemTerms = searchTerms([item.title, item.description, item.brand, item.model].filter(Boolean).join(" "));
  const wantedTerms = searchTerms([wanted.title, wanted.description, wanted.brandModel].filter(Boolean).join(" "));
  let overlap = 0;
  for (const term of wantedTerms) if (itemTerms.has(term)) overlap += 1;
  return overlap ? Math.min(20, 5 + overlap * 3) : 0;
}

export function scoreMarketMatch(item: MatchableItem, wanted: MatchableWantedPost): MarketMatchScore {
  const reasons: MarketMatchReason[] = [];

  if (item.category === wanted.category) {
    reasons.push({ key: "category", label: "品类一致", points: 35 });
  }

  if (item.priceCents >= wanted.budgetMinCents && item.priceCents <= wanted.budgetMaxCents) {
    reasons.push({ key: "budget", label: "价格在求购预算内", points: 25 });
  } else {
    const distance = item.priceCents < wanted.budgetMinCents
      ? wanted.budgetMinCents - item.priceCents
      : item.priceCents - wanted.budgetMaxCents;
    const reference = Math.max(wanted.budgetMaxCents, 1);
    if (distance / reference <= 0.2) reasons.push({ key: "budget", label: "价格接近求购预算", points: 12 });
  }

  const itemCampus = normalize(item.campus);
  const wantedCampus = normalize(wanted.campus);
  if (itemCampus && wantedCampus && itemCampus === wantedCampus) {
    reasons.push({ key: "campus", label: "校区一致", points: 15 });
  } else if (itemCampus && wantedCampus && (itemCampus.includes(wantedCampus) || wantedCampus.includes(itemCampus))) {
    reasons.push({ key: "campus", label: "校区信息相近", points: 8 });
  }

  const keywords = keywordPoints(item, wanted);
  if (keywords) reasons.push({ key: "keyword", label: "名称或型号关键词相符", points: keywords });

  const expectedCondition = normalize(wanted.condition);
  const conditionAliases: Record<string, string[]> = {
    new: ["new", "全新"],
    like_new: ["like_new", "近新", "九成新", "95新", "99新"],
    good: ["good", "良好", "八成新", "可用"],
    fair: ["fair", "一般", "有瑕疵"],
  };
  if (expectedCondition && (conditionAliases[item.condition] || [item.condition]).some((alias) => expectedCondition.includes(alias))) {
    reasons.push({ key: "condition", label: "成色符合预期", points: 5 });
  }

  return { score: Math.min(100, reasons.reduce((sum, reason) => sum + reason.points, 0)), reasons };
}

function sortMatches<T extends { score: number }>(matches: T[], limit: number) {
  return matches.sort((a, b) => b.score - a.score).slice(0, limit);
}

export async function findMatchesForItem(itemId: number, limit = 8) {
  const item = await prisma.marketItem.findUnique({ where: { id: itemId } });
  if (!item || item.status !== "active" || item.visibility !== "public" || item.deliveryType !== "physical") return [];
  const wantedPosts = await prisma.wantedPost.findMany({
    where: {
      authorId: { not: item.sellerId },
      status: { in: ["active", "responded"] },
      expiresAt: { gt: new Date() },
      category: item.category,
    },
    orderBy: { createdAt: "desc" },
    take: 120,
  });
  return sortMatches(wantedPosts.map((wantedPost) => ({
    wantedPost,
    ...scoreMarketMatch(item, wantedPost),
  })).filter((match) => match.score >= 40), limit);
}

export async function findMatchesForWanted(wantedPostId: number, limit = 8) {
  const wantedPost = await prisma.wantedPost.findUnique({ where: { id: wantedPostId } });
  if (!wantedPost || !["active", "responded"].includes(wantedPost.status) || wantedPost.expiresAt <= new Date()) return [];
  const items = await prisma.marketItem.findMany({
    where: {
      sellerId: { not: wantedPost.authorId },
      status: "active",
      visibility: "public",
      deliveryType: "physical",
      listingType: "sell",
      category: wantedPost.category,
    },
    orderBy: { createdAt: "desc" },
    take: 120,
  });
  return sortMatches(items.map((item) => ({
    item,
    ...scoreMarketMatch(item, wantedPost),
  })).filter((match) => match.score >= 40), limit);
}

async function matchNotificationsEnabled(userId: number) {
  const preference = await prisma.marketPreference.findUnique({ where: { userId } });
  return preference?.matchNotificationsEnabled ?? true;
}

async function createMatchNotification(input: {
  itemId: number;
  wantedPostId: number;
  recipientId: number;
  kind: "item_for_wanted" | "wanted_for_item";
  score: number;
  itemTitle: string;
  wantedTitle: string;
}) {
  if (!(await matchNotificationsEnabled(input.recipientId))) return false;
  const inserted = await prisma.marketMatchNotice.createMany({
    data: [{
      itemId: input.itemId,
      wantedPostId: input.wantedPostId,
      recipientId: input.recipientId,
      kind: input.kind,
      score: input.score,
    }],
    skipDuplicates: true,
  });
  if (!inserted.count) return false;
  const isBuyer = input.kind === "item_for_wanted";
  await prisma.notification.create({
    data: {
      userId: input.recipientId,
      category: "market",
      level: "normal",
      title: isBuyer ? "发现符合求购的新闲置" : "发现可能匹配的求购",
      content: isBuyer
        ? `“${input.itemTitle}”与求购“${input.wantedTitle}”的品类、预算或校区较匹配。`
        : `求购“${input.wantedTitle}”可能适合你的“${input.itemTitle}”。`,
      link: isBuyer ? `/market/item/${input.itemId}` : `/market/wanted/${input.wantedPostId}`,
      source: "靠浦校园市集",
      payload: JSON.stringify({
        type: "market-match",
        itemId: input.itemId,
        wantedPostId: input.wantedPostId,
        score: input.score,
      }),
    },
  });
  return true;
}

export async function notifyMatchesForItem(itemId: number) {
  const matches = (await findMatchesForItem(itemId, MATCH_NOTIFICATION_LIMIT))
    .filter((match) => match.score >= MATCH_NOTIFICATION_THRESHOLD);
  const item = await prisma.marketItem.findUnique({ where: { id: itemId }, select: { id: true, title: true } });
  if (!item) return 0;
  const notified = await Promise.all(matches.map((match) => createMatchNotification({
    itemId,
    wantedPostId: match.wantedPost.id,
    recipientId: match.wantedPost.authorId,
    kind: "item_for_wanted",
    score: match.score,
    itemTitle: item.title,
    wantedTitle: match.wantedPost.title,
  })));
  return notified.filter(Boolean).length;
}

export async function notifyMatchesForWanted(wantedPostId: number) {
  const matches = (await findMatchesForWanted(wantedPostId, MATCH_NOTIFICATION_LIMIT))
    .filter((match) => match.score >= MATCH_NOTIFICATION_THRESHOLD);
  const wantedPost = await prisma.wantedPost.findUnique({ where: { id: wantedPostId }, select: { id: true, title: true } });
  if (!wantedPost) return 0;
  const notified = await Promise.all(matches.map((match) => createMatchNotification({
    itemId: match.item.id,
    wantedPostId,
    recipientId: match.item.sellerId,
    kind: "wanted_for_item",
    score: match.score,
    itemTitle: match.item.title,
    wantedTitle: wantedPost.title,
  })));
  return notified.filter(Boolean).length;
}

export async function runMarketMeetupReminders(now = new Date()) {
  const deadline = new Date(now.getTime() + 24 * 60 * 60_000);
  const candidates = await prisma.marketOrder.findMany({
    where: {
      deliveryType: "physical",
      status: { in: ["reserved", "paid", "delivering"] },
      meetupTime: { gte: now, lte: deadline },
      meetupReminderSentAt: null,
    },
    select: { id: true },
    take: 200,
  });
  if (!candidates.length) return { orders: 0, notifications: 0 };

  let orderCount = 0;
  let notificationCount = 0;
  for (const candidate of candidates) {
    const claimed = await prisma.$transaction(async (tx) => {
      await acquireMarketOrderLock(tx, candidate.id);
      const order = await tx.marketOrder.findUnique({
        where: { id: candidate.id },
        include: { item: { select: { title: true } } },
      });
      if (
        !order
        || order.deliveryType !== "physical"
        || !["reserved", "paid", "delivering"].includes(order.status)
        || !order.meetupTime
        || order.meetupTime < now
        || order.meetupTime > deadline
        || order.meetupReminderSentAt
      ) {
        return { orders: 0, notifications: 0 };
      }
      const claimedOrder = await tx.marketOrder.updateMany({
        where: {
          id: order.id,
          deliveryType: "physical",
          status: { in: ["reserved", "paid", "delivering"] },
          meetupTime: { gte: now, lte: deadline },
          meetupReminderSentAt: null,
        },
        data: { meetupReminderSentAt: now },
      });
      if (claimedOrder.count !== 1) return { orders: 0, notifications: 0 };

      const userIds = [order.buyerId, order.sellerId];
      const preferences = await tx.marketPreference.findMany({
        where: { userId: { in: userIds } },
      });
      const reminderEnabled = new Map(
        preferences.map((preference) => [
          preference.userId,
          preference.meetupRemindersEnabled,
        ]),
      );
      const recipients = userIds.filter(
        (userId) => reminderEnabled.get(userId) !== false,
      );
      if (recipients.length) {
        const time = order.meetupTime.toLocaleString("zh-CN", {
          timeZone: "Asia/Shanghai",
          hour12: false,
        });
        await tx.notification.createMany({
          data: recipients.map((userId) => ({
            userId,
            category: "market",
            level: "strong",
            title: "校内面交即将开始",
            content: `“${order.item.title}”约在 ${time}${order.meetupLocation ? `，地点：${order.meetupLocation}` : ""}。请提前与对方确认。`,
            link: "/market/mine?tab=reservations",
            source: "靠浦校园市集",
            payload: JSON.stringify({
              type: "market-meetup-reminder",
              orderId: order.id,
            }),
          })),
        });
      }
      return { orders: 1, notifications: recipients.length };
    });
    orderCount += claimed.orders;
    notificationCount += claimed.notifications;
  }
  return { orders: orderCount, notifications: notificationCount };
}

export function startMarketReminderPoller() {
  if (marketReminderPollerStarted) return;
  marketReminderPollerStarted = true;
  const tick = () => {
    runTrackedJob(
      "market-meetup-reminders",
      "市集面交提醒",
      () => runWithDistributedLock("market-meetup-reminders", 14 * 60_000, () => runMarketMeetupReminders()),
      MARKET_REMINDER_INTERVAL_MS,
    ).catch((error) => console.warn("[market] meetup reminder failed", error));
  };
  const initialTimer = setTimeout(tick, 10_000);
  initialTimer.unref?.();
  const timer = setInterval(tick, MARKET_REMINDER_INTERVAL_MS);
  timer.unref?.();
}
