import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { COMMUNITY_BOARD_DEFS, FORUM_BOARD_DEFS, FORUM_SECTION_ORDER } from "../src/services/defaultBoardCatalog";

test("forum board catalog exposes exactly three ordered sections with four boards each", () => {
  assert.deepEqual(FORUM_SECTION_ORDER, ["general", "study", "social"]);

  const grouped = Object.fromEntries(FORUM_SECTION_ORDER.map((section) => [
    section,
    FORUM_BOARD_DEFS.filter((board) => board.section === section).map((board) => board.name),
  ]));

  assert.deepEqual(grouped, {
    general: ["校园广场", "失物招领", "新生专区", "问答互助"],
    study: ["课程学习", "科研实习", "雅思留学", "课程点评"],
    social: ["校园生活", "社团活动", "树洞", "交友扩列"],
  });

  assert.equal(FORUM_BOARD_DEFS.length, 12);
  assert.equal(new Set(FORUM_BOARD_DEFS.map((board) => board.slug)).size, 12);
  assert.ok(FORUM_BOARD_DEFS.every((board) => board.order > 0));
  const courseReview = FORUM_BOARD_DEFS.find((board) => board.slug === "coursereview");
  assert.equal(courseReview?.type, "normal");
  assert.equal(courseReview?.order, 140);
});

test("market board remains available to commerce without joining the forum grid", () => {
  const market = COMMUNITY_BOARD_DEFS.find((board) => board.slug === "market");
  assert.ok(market);
  assert.equal(market.type, "market");
  assert.equal(market.section, undefined);
});

test("database seed keeps every forum board free of demo posts", () => {
  const seedPath = fileURLToPath(new URL("../prisma/seed.ts", import.meta.url));
  const seedSource = readFileSync(seedPath, "utf8");

  assert.doesNotMatch(seedSource, /prisma\.topic\.create(?:Many)?\s*\(/);
  assert.doesNotMatch(seedSource, /prisma\.reply\.create(?:Many)?\s*\(/);
  assert.match(seedSource, /论坛初始保持空白/);
});
