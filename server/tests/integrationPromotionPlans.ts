import type { Prisma, PrismaClient, PromotionPlan } from "@prisma/client";

const DEFAULT_PROMOTION_PLANS = [
  {
    code: "listing_pin_7d",
    name: "商品置顶 7 天",
    type: "listing_pin",
    targetType: "market_item",
    placement: "market",
    description: "在市集列表优先展示，并明确标注“置顶”。",
    priceCents: 590,
    manualCostCents: 0,
    durationDays: 7,
    maxActive: 0,
    enabled: true,
    sort: 10,
  },
  {
    code: "wanted_urgent_7d",
    name: "求购加急 7 天",
    type: "wanted_urgent",
    targetType: "wanted_post",
    placement: "wanted",
    description: "进入首页“热议与求购”和求购列表的优先位置，并明确标注“加急”；首页最多同时展示 8 条。",
    priceCents: 590,
    manualCostCents: 0,
    durationDays: 7,
    maxActive: 8,
    enabled: true,
    sort: 20,
  },
  {
    code: "home_featured_7d",
    name: "首页推广 7 天",
    type: "home_featured",
    targetType: "market_item",
    placement: "home",
    description: "进入首页商品推荐位并明确标注“推广”；首页最多同时展示 8 个推广商品。",
    priceCents: 1290,
    manualCostCents: 0,
    durationDays: 7,
    maxActive: 8,
    enabled: true,
    sort: 30,
  },
  {
    code: "merchant_homepage_30d",
    name: "合作商户主页 30 天",
    type: "merchant_homepage",
    targetType: "merchant_profile",
    placement: "merchant",
    description: "启用审核通过的合作商户主页，并明确标注“合作商户”。",
    priceCents: 2990,
    manualCostCents: 0,
    durationDays: 30,
    maxActive: 0,
    enabled: true,
    sort: 40,
  },
] as const satisfies readonly Prisma.PromotionPlanCreateManyInput[];

type PromotionPlanCode = typeof DEFAULT_PROMOTION_PLANS[number]["code"];
type PromotionPlanConfig = Omit<Prisma.PromotionPlanUpdateInput, "code">;

function mutableConfig(plan: PromotionPlan): PromotionPlanConfig {
  return {
    name: plan.name,
    type: plan.type,
    targetType: plan.targetType,
    placement: plan.placement,
    description: plan.description,
    priceCents: plan.priceCents,
    manualCostCents: plan.manualCostCents,
    durationDays: plan.durationDays,
    maxActive: plan.maxActive,
    enabled: plan.enabled,
    sort: plan.sort,
  };
}

export async function installIntegrationPromotionPlans(prisma: PrismaClient) {
  const codes = DEFAULT_PROMOTION_PLANS.map((plan) => plan.code);
  const originals = await prisma.promotionPlan.findMany({ where: { code: { in: codes } } });
  const originalByCode = new Map(originals.map((plan) => [plan.code, plan]));
  const plans = await prisma.$transaction(DEFAULT_PROMOTION_PLANS.map((plan) => {
    const { code, ...config } = plan;
    return prisma.promotionPlan.upsert({
      where: { code },
      create: plan,
      update: config,
    });
  }));
  const planByCode = new Map(plans.map((plan) => [plan.code, plan]));
  const createdIds = plans.filter((plan) => !originalByCode.has(plan.code)).map((plan) => plan.id);

  return {
    get(code: PromotionPlanCode) {
      const plan = planByCode.get(code);
      if (!plan) throw new Error(`Integration promotion plan missing: ${code}`);
      return plan;
    },
    async restore() {
      await prisma.$transaction(originals.map((plan) => prisma.promotionPlan.update({
        where: { id: plan.id },
        data: mutableConfig(plan),
      })));
      if (createdIds.length) {
        await prisma.promotionPlan.deleteMany({
          where: { id: { in: createdIds }, orders: { none: {} } },
        });
      }
    },
  };
}
