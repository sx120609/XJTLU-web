import { prisma } from "../prisma";
import { itemInclude, serializeItem } from "./marketCatalogService";
import { isLearningMaterialCategory } from "./marketCatalog";

export const PROFILE_FAVORITE_TYPES = [
  "all",
  "topic",
  "market_item",
  "learning_material",
] as const;

export type ProfileFavoriteType = typeof PROFILE_FAVORITE_TYPES[number];

type FavoriteRecord = {
  id: number;
  type: Exclude<ProfileFavoriteType, "all">;
  savedAt: Date;
  title: string;
  description: string;
  cover: string;
  href: string;
  meta: string;
  target: unknown;
};

function cursorDate(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export async function listProfileFavorites(
  userId: number,
  type: ProfileFavoriteType,
  cursor: unknown,
  size: number,
) {
  const before = cursorDate(cursor);
  const createdAtFilter = before ? { lt: before } : undefined;
  const wants = (value: Exclude<ProfileFavoriteType, "all">) => type === "all" || type === value;
  const [topicRows, itemRows, counts] = await Promise.all([
    wants("topic")
      ? prisma.topicFavorite.findMany({
        where: {
          userId,
          ...(createdAtFilter ? { createdAt: createdAtFilter } : {}),
          topic: { hidden: false },
        },
        include: {
          topic: {
            include: {
              board: { select: { id: true, slug: true, name: true, color: true, type: true } },
              author: { select: { id: true, nickname: true, avatar: true, role: true } },
            },
          },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: size + 1,
      })
      : [],
    wants("market_item") || wants("learning_material")
      ? prisma.marketFavorite.findMany({
        where: {
          userId,
          ...(createdAtFilter ? { createdAt: createdAtFilter } : {}),
          item: {
            status: { notIn: ["draft", "reviewing", "hidden", "targeted"] },
            visibility: "public",
            ...(type === "learning_material"
              ? { deliveryType: "digital" }
              : type === "market_item"
                ? { deliveryType: "physical" }
                : {}),
          },
        },
        include: {
          item: {
            include: {
              ...itemInclude,
              favorites: { where: { userId }, select: { userId: true } },
            },
          },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: size + 1,
      })
      : [],
    Promise.all([
      prisma.topicFavorite.count({ where: { userId, topic: { hidden: false } } }),
      prisma.marketFavorite.count({ where: { userId, item: { deliveryType: "physical", visibility: "public", status: { notIn: ["draft", "reviewing", "hidden", "targeted"] } } } }),
      prisma.marketFavorite.count({ where: { userId, item: { deliveryType: "digital", visibility: "public", status: { notIn: ["draft", "reviewing", "hidden", "targeted"] } } } }),
    ]),
  ]);

  const records: FavoriteRecord[] = [];
  for (const row of topicRows) {
    records.push({
      id: row.id,
      type: "topic",
      savedAt: row.createdAt,
      title: row.topic.title,
      description: row.topic.content.replace(/[#>*_`~[\]()]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120),
      cover: "",
      href: `/forum/topic/${row.topic.id}`,
      meta: `${row.topic.board.name} · ${row.topic.replyCount} 回复`,
      target: row.topic,
    });
  }
  for (const row of itemRows) {
    const item = serializeItem(row.item, userId);
    const learning = isLearningMaterialCategory(row.item.category) || row.item.deliveryType === "digital";
    records.push({
      id: row.id,
      type: learning ? "learning_material" : "market_item",
      savedAt: row.createdAt,
      title: row.item.title,
      description: row.item.description.replace(/\s+/g, " ").trim().slice(0, 120),
      cover: item.cover,
      href: learning ? `/learning/materials/item/${row.item.id}` : `/market/item/${row.item.id}`,
      meta: `¥${item.price}${learning ? " · 学习资料" : " · 商品"}`,
      target: item,
    });
  }
  records.sort((left, right) => right.savedAt.getTime() - left.savedAt.getTime() || right.id - left.id);
  const list = records.slice(0, size);
  return {
    list: list.map((record) => ({ ...record, savedAt: record.savedAt.toISOString() })),
    nextCursor: records.length > size && list.length
      ? list[list.length - 1].savedAt.toISOString()
      : null,
    counts: {
      all: counts.reduce((sum, count) => sum + count, 0),
      topic: counts[0],
      market_item: counts[1],
      learning_material: counts[2],
    },
  };
}
