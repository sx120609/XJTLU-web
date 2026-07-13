export const LEARNING_MATERIAL_CATEGORY = "digital_goods";

export type MarketCatalogScope = "market" | "learning_materials";

export function isLearningMaterialCategory(category: string | null | undefined) {
  return category === LEARNING_MATERIAL_CATEGORY;
}

export function categoryBelongsToCatalog(scope: MarketCatalogScope, category: string) {
  return scope === "learning_materials"
    ? isLearningMaterialCategory(category)
    : !isLearningMaterialCategory(category);
}

export function resolveMarketCategoryBoundary(scope: MarketCatalogScope, requestedCategory = "") {
  const category = requestedCategory.trim();
  if (category && !categoryBelongsToCatalog(scope, category)) {
    return { valid: false as const, filter: undefined };
  }
  if (scope === "learning_materials") {
    return { valid: true as const, filter: LEARNING_MATERIAL_CATEGORY };
  }
  return {
    valid: true as const,
    filter: category || { not: LEARNING_MATERIAL_CATEGORY },
  };
}

export function splitMarketCategories<T extends { slug: string }>(categories: T[]) {
  return {
    market: categories.filter((category) => !isLearningMaterialCategory(category.slug)),
    learningMaterials: categories.find((category) => isLearningMaterialCategory(category.slug)) ?? null,
  };
}
