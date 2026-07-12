import { prisma } from "../src/prisma";

const LEGACY_FEED_SLUGS = ["jwc-notice", "xgc-notice", "yjsy-notice", "yjszs-notice"];

async function main() {
  const legacySources = await prisma.schoolFeedSource.findMany({
    where: {
      OR: [
        { slug: { in: LEGACY_FEED_SLUGS } },
        { homepage: { contains: ".cpu.edu.cn", mode: "insensitive" } },
        { listUrl: { contains: ".cpu.edu.cn", mode: "insensitive" } },
      ],
    },
    select: { id: true },
  });
  const sourceIds = legacySources.map((source) => source.id);
  const legacyBoards = await prisma.board.findMany({
    where: {
      OR: [
        { slug: { in: LEGACY_FEED_SLUGS } },
        ...(sourceIds.length ? [{ feedSourceId: { in: sourceIds } }] : []),
      ],
    },
    select: { id: true },
  });
  const boardIds = legacyBoards.map((board) => board.id);

  const [topics, feedItems, boards, sources, services] = await prisma.$transaction([
    prisma.topic.deleteMany({ where: { boardId: { in: boardIds } } }),
    prisma.schoolFeedItem.deleteMany({ where: { sourceId: { in: sourceIds } } }),
    prisma.board.deleteMany({ where: { id: { in: boardIds } } }),
    prisma.schoolFeedSource.deleteMany({ where: { id: { in: sourceIds } } }),
    prisma.serviceCard.deleteMany({
      where: {
        OR: [
          { url: { contains: ".cpu.edu.cn", mode: "insensitive" } },
          { url: { contains: "cpu.91job.org.cn", mode: "insensitive" } },
        ],
      },
    }),
  ]);

  console.log(JSON.stringify({
    removedLegacyTopics: topics.count,
    removedLegacyFeedItems: feedItems.count,
    removedLegacyBoards: boards.count,
    removedLegacySources: sources.count,
    removedLegacyServices: services.count,
  }));
}

main()
  .catch((error) => {
    console.error("Failed to remove legacy CPU-web data", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
