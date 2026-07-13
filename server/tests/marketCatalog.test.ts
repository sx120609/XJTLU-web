import test from "node:test";
import assert from "node:assert/strict";
import {
  LEARNING_MATERIAL_CATEGORY,
  categoryBelongsToCatalog,
  isLearningMaterialCategory,
  resolveMarketCategoryBoundary,
  splitMarketCategories,
} from "../src/services/marketCatalog";

test("learning materials use one stable backend category", () => {
  assert.equal(LEARNING_MATERIAL_CATEGORY, "digital_goods");
  assert.equal(isLearningMaterialCategory("digital_goods"), true);
  assert.equal(isLearningMaterialCategory("books"), false);
});

test("ordinary marketplace excludes learning materials by default", () => {
  assert.deepEqual(resolveMarketCategoryBoundary("market"), {
    valid: true,
    filter: { not: "digital_goods" },
  });
  assert.deepEqual(resolveMarketCategoryBoundary("market", "books"), {
    valid: true,
    filter: "books",
  });
  assert.equal(resolveMarketCategoryBoundary("market", "digital_goods").valid, false);
});

test("learning materials endpoint is locked to its own category", () => {
  assert.deepEqual(resolveMarketCategoryBoundary("learning_materials"), {
    valid: true,
    filter: "digital_goods",
  });
  assert.deepEqual(resolveMarketCategoryBoundary("learning_materials", "digital_goods"), {
    valid: true,
    filter: "digital_goods",
  });
  assert.equal(resolveMarketCategoryBoundary("learning_materials", "books").valid, false);
});

test("publish catalog must match the selected category", () => {
  assert.equal(categoryBelongsToCatalog("market", "books"), true);
  assert.equal(categoryBelongsToCatalog("market", "digital_goods"), false);
  assert.equal(categoryBelongsToCatalog("learning_materials", "digital_goods"), true);
  assert.equal(categoryBelongsToCatalog("learning_materials", "digital"), false);
});

test("category metadata is split without duplicating or losing categories", () => {
  const categories = [
    { slug: "digital", name: "数码 3C" },
    { slug: "digital_goods", name: "电子资料" },
    { slug: "books", name: "教材书籍" },
  ];
  const result = splitMarketCategories(categories);
  assert.deepEqual(result.market.map((category) => category.slug), ["digital", "books"]);
  assert.equal(result.learningMaterials?.slug, "digital_goods");
  assert.equal(result.market.length + Number(Boolean(result.learningMaterials)), categories.length);
});
