import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { COMMUNITY_BOARD_DEFS, FORUM_BOARD_DEFS } from "../src/services/defaultBoardCatalog";
import { FEATURED_XJTLU_APPS } from "../src/services/xjtluEhallClient";
import {
  FOUR_POINT_GRADE_SCALE as SERVER_GPA_SCALE,
  calculateWeightedFourPointGpa as serverWeightedGpa,
  scoreToFourPointGpa as serverScoreToGpa,
} from "../src/services/gpaScale";
import {
  FOUR_POINT_GRADE_SCALE as WEB_GPA_SCALE,
  calculateWeightedFourPointGpa as webWeightedGpa,
  scoreColor,
  scoreToFourPointGpa as webScoreToGpa,
} from "../../web/src/utils/gpaScale";

test("product-owned forum catalog stays complete, unique, and deterministically ordered", () => {
  assert.equal(FORUM_BOARD_DEFS.length, 12);
  assert.equal(new Set(COMMUNITY_BOARD_DEFS.map((board) => board.slug)).size, COMMUNITY_BOARD_DEFS.length);
  assert.equal(new Set(COMMUNITY_BOARD_DEFS.map((board) => board.order)).size, COMMUNITY_BOARD_DEFS.length);
  assert.ok(COMMUNITY_BOARD_DEFS.every((board) => board.name && board.description && board.icon && board.color));
  assert.deepEqual(
    FORUM_BOARD_DEFS.map((board) => board.name),
    [
      "校园广场", "求购需求", "新生专区", "问答互助",
      "课程学习", "科研实习", "雅思留学", "课程点评",
      "校园生活", "社团活动", "树洞", "交友扩列",
    ],
  );
  const courseReview = COMMUNITY_BOARD_DEFS.find((board) => board.slug === "coursereview");
  assert.equal(courseReview?.type, "normal");
  assert.equal(courseReview?.section, "study");
});

test("featured eHall catalog contains exactly the requested 15 unique apps in product order", () => {
  assert.equal(FEATURED_XJTLU_APPS.length, 15);
  assert.equal(new Set(FEATURED_XJTLU_APPS).size, 15);
  assert.deepEqual([...FEATURED_XJTLU_APPS], [
    "西浦学习超市Core",
    "e-Bridge",
    "Timetable Plus",
    "签到系统(AMS)",
    "犀利网",
    "图书馆座位预约系统",
    "图书馆小组讨论室预约系统",
    "试卷与论文系统",
    "讨论室和静音舱预订",
    "储物柜管理系统",
    "学生宿舍管理系统",
    "Shuttle Bus",
    "打印服务",
    "体育场地运营系统",
    "专属自习教室预约系统",
  ]);
});

test("course review uses the same free-post flow as every normal forum board", () => {
  const postSource = readFileSync(new URL("../../web/src/views/forum/Post.vue", import.meta.url), "utf8");
  const forumSource = readFileSync(new URL("../../web/src/views/forum/Index.vue", import.meta.url), "utf8");
  const topicRouteSource = readFileSync(new URL("../src/routes/topic.ts", import.meta.url), "utf8");
  const routerSource = readFileSync(new URL("../../web/src/router/index.ts", import.meta.url), "utf8");

  for (const legacyField of ["评价的课程", "授课老师", "loadCoursesForReview", "courseTeacherId", "metadata.ratings"]) {
    assert.ok(!postSource.includes(legacyField), `legacy course-review field remains: ${legacyField}`);
  }
  assert.ok(!forumSource.includes("查看课评"));
  assert.ok(!topicRouteSource.includes("prisma.courseRating.create"));
  assert.match(routerSource, /path: "coursereview"[^\n]+redirect: "\/forum\/b\/coursereview"/);
});

test("post board selector lists real boards without section labels masquerading as options", () => {
  const postSource = readFileSync(new URL("../../web/src/views/forum/Post.vue", import.meta.url), "utf8");
  assert.ok(!postSource.includes("el-option-group"));
  assert.ok(!postSource.includes("groupedBoards"));
  assert.match(postSource, /v-for="b in boards"/);
});

test("web and server GPA conversions remain identical at and around every boundary", () => {
  assert.deepEqual(WEB_GPA_SCALE, SERVER_GPA_SCALE);
  const scores = [0, 39.99, 40, 44.99, 45, 49.99, 50, 59.99, 60, 64.99, 65, 69.99, 70, 79, 80, 89, 90, 99, 100];
  for (const score of scores) assert.equal(webScoreToGpa(score), serverScoreToGpa(score), `score ${score}`);
  const rows = [
    { score: 95, credits: 5 },
    { score: 67, credits: 10 },
    { score: 52, credits: 5 },
    { score: 38, credits: 5 },
  ];
  assert.deepEqual(webWeightedGpa(rows), serverWeightedGpa(rows));
});

test("score colors cover all seven requested visual ranges", () => {
  const cases: Array<[number, string]> = [
    [39.99, "#d13438"],
    [40, "#e65f00"],
    [49.99, "#e65f00"],
    [50, "#9c6f00"],
    [59.99, "#9c6f00"],
    [60, "#7c3aed"],
    [69.99, "#7c3aed"],
    [70, "#2456d3"],
    [79.99, "#2456d3"],
    [80, "#007f8b"],
    [89.99, "#007f8b"],
    [90, "#16875b"],
    [100, "#16875b"],
  ];
  for (const [score, color] of cases) assert.equal(scoreColor(score), color, `score ${score}`);
  assert.equal(scoreColor("待发布"), "var(--cpu-text-muted)");
});
