import { prisma } from "../prisma";
import { COMMUNITY_BOARD_DEFS, type CommunityBoardDefinition } from "./defaultBoardCatalog";

export async function ensureBuiltinBoards() {
  const defs = [...COMMUNITY_BOARD_DEFS];
  if (!defs.length) return [] as CommunityBoardDefinition[];

  const existing = await prisma.board.findMany({
    where: { slug: { in: defs.map((board) => board.slug) } },
    select: { slug: true },
  });
  const existingSlugs = new Set(existing.map((board) => board.slug));
  const created: CommunityBoardDefinition[] = [];
  for (const [index, board] of defs.entries()) {
    const order = (index + 1) * 10;
    if (existingSlugs.has(board.slug)) {
      // Keep administrator-customized text and colors, but make the built-in
      // navigation order and capabilities deterministic after every deploy.
      await prisma.board.update({
        where: { slug: board.slug },
        data: {
          order,
          type: board.type,
          anonymousEnabled: Boolean(board.anonymousEnabled),
          ...(board.slug === "market" ? { name: board.name, description: board.description } : {}),
        },
      });
      continue;
    }
    await prisma.board.create({
      data: {
        slug: board.slug,
        name: board.name,
        description: board.description,
        icon: board.icon,
        color: board.color,
        order,
        type: board.type,
        anonymousEnabled: Boolean(board.anonymousEnabled),
      },
    });
    created.push(board);
  }

  // The external mirror is optional. When present it belongs after the native
  // community boards instead of interrupting the primary board grid.
  await prisma.board.updateMany({
    where: { slug: "campus-wall" },
    data: { order: 1000 },
  });
  return created;
}
