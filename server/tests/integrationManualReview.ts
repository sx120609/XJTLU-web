export async function approveMarketItem(prisma: any, itemId: number) {
  return prisma.marketItem.update({
    where: { id: itemId },
    data: {
      status: "active",
      moderationNote: "integration manual approval",
      moderatedAt: new Date(),
    },
  });
}
