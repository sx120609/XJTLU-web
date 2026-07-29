import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  questionnaireLockKey,
  questionnaireRespondentLockKey,
} from "../src/services/questionnaireLockService";
import { toolSlugLockKey } from "../src/services/toolSlugLockService";
import {
  fileCollectSlugBase,
  gradeCheckSlugBase,
  questionnaireSlugBase,
  slugifyToolTitle,
} from "../src/services/toolSlugService";

test("questionnaire advisory lock keys separate questionnaires and respondents", () => {
  assert.equal(questionnaireLockKey(7), questionnaireLockKey(7));
  assert.notEqual(questionnaireLockKey(7), questionnaireLockKey(8));
  assert.notEqual(
    questionnaireLockKey(7),
    questionnaireRespondentLockKey(7, 11),
  );
  assert.notEqual(
    questionnaireRespondentLockKey(7, 11),
    questionnaireRespondentLockKey(7, 12),
  );
  assert.notEqual(
    questionnaireRespondentLockKey(7, 11),
    questionnaireRespondentLockKey(8, 11),
  );
});

test("tool slug locks separate domains and title bases", () => {
  assert.equal(
    toolSlugLockKey("questionnaire", "survey"),
    toolSlugLockKey("questionnaire", "survey"),
  );
  assert.notEqual(
    toolSlugLockKey("questionnaire", "survey"),
    toolSlugLockKey("grade-check", "survey"),
  );
  assert.notEqual(
    toolSlugLockKey("questionnaire", "survey"),
    toolSlugLockKey("questionnaire", "survey-2"),
  );
  assert.equal(slugifyToolTitle("成绩查询"), slugifyToolTitle("成绩查询"));
  assert.match(questionnaireSlugBase("成绩查询"), /^q-[a-f0-9]{12}$/);
  assert.equal(gradeCheckSlugBase("成绩查询"), "grade-check");
  assert.equal(fileCollectSlugBase("材料收集"), "file-collect");
});

test("tool write schemas reject empty patches and unknown fields", async () => {
  const {
    createFileCollectSchema,
    createGradeCheckSchema,
    createQuestionnaireSchema,
    patchFileCollectSchema,
    patchGradeCheckSchema,
    patchQuestionnaireSchema,
    responseSchema,
  } = await import("../src/routes/tools");

  assert.equal(patchQuestionnaireSchema.safeParse({}).success, false);
  assert.equal(patchGradeCheckSchema.safeParse({}).success, false);
  assert.equal(patchFileCollectSchema.safeParse({}).success, false);
  assert.equal(
    createQuestionnaireSchema.safeParse({
      title: "问卷",
      fields: [{ id: "name", label: "姓名", type: "text" }],
      unexpected: true,
    }).success,
    false,
  );
  assert.equal(
    createGradeCheckSchema.safeParse({
      title: "成绩",
      columns: ["学号", "分数"],
      rows: [{ 学号: "1", 分数: 90 }],
      unexpected: true,
    }).success,
    false,
  );
  assert.equal(
    createFileCollectSchema.safeParse({
      title: "材料",
      fields: [{ id: "student_id", label: "学号" }],
      fileRules: {},
      unexpected: true,
    }).success,
    false,
  );
  assert.equal(
    responseSchema.safeParse({
      answers: {},
      questionnaireId: 1,
    }).success,
    false,
  );
});

test("questionnaire writes share the same lock and recheck mutable state", () => {
  const source = readFileSync(
    new URL("../src/routes/tools/questionnaires.ts", import.meta.url),
    "utf8",
  );
  const responseRoute = source.slice(
    source.indexOf('"/questionnaires/:slug/responses"'),
    source.indexOf('"/questionnaires/:id/responses"'),
  );

  assert.match(source, /acquireQuestionnaireLock\(tx, id\)/);
  assert.match(responseRoute, /acquireQuestionnaireResponseLock/);
  assert.match(responseRoute, /current\.updatedAt\.getTime\(\) !== row\.updatedAt\.getTime\(\)/);
  assert.match(responseRoute, /current\.oneResponsePerUser/);
  assert.match(responseRoute, /tx\.questionnaireResponse\.findFirst/);
  assert.match(responseRoute, /tx\.questionnaireResponse\.create/);
});

test("system questionnaires initialize once and avoid write-on-read upserts", () => {
  const source = readFileSync(
    new URL("../src/services/questionnaires.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /ensureSystemQuestionnairesPromise/);
  assert.match(source, /if \(systemQuestionnaireMatches\([^;]+return/s);
  assert.match(source, /acquireQuestionnaireLock/);
  assert.doesNotMatch(source, /questionnaire\.upsert/);
});

test("tool core routes and validation contracts are isolated from the domain router", () => {
  const route = readFileSync(
    new URL("../src/routes/tools.ts", import.meta.url),
    "utf8",
  );
  const core = readFileSync(
    new URL("../src/routes/tools/core.ts", import.meta.url),
    "utf8",
  );
  const grades = readFileSync(
    new URL("../src/routes/tools/grades.ts", import.meta.url),
    "utf8",
  );
  const questionnaires = readFileSync(
    new URL("../src/routes/tools/questionnaires.ts", import.meta.url),
    "utf8",
  );
  const schemas = readFileSync(
    new URL("../src/services/toolSchemas.ts", import.meta.url),
    "utf8",
  );

  assert.match(route, /toolsRouter\.use\(toolCoreRouter\)/);
  assert.match(route, /toolsRouter\.use\(toolGradesRouter\)/);
  assert.match(route, /toolsRouter\.use\(toolQuestionnairesRouter\)/);
  assert.match(route, /toolsRouter\.use\(toolFileCollectionsRouter\)/);
  assert.doesNotMatch(route, /toolPermission\.upsert/);
  assert.doesNotMatch(route, /toolsRouter\.(?:get|post|patch|delete)\("\/grade-checks/);
  assert.doesNotMatch(route, /toolsRouter\.(?:get|post|patch|delete)\("\/questionnaires/);
  assert.match(core, /toolPermission\.upsert/);
  assert.match(core, /qqbot-reminders/);
  assert.match(grades, /acquireGradeCheckLock/);
  assert.match(grades, /gradeCheckSlugBase/);
  assert.match(questionnaires, /acquireQuestionnaireResponseLock/);
  assert.match(schemas, /patchQuestionnaireSchema/);
  assert.match(schemas, /\.strict\(\)/);
  assert.equal(route.split(/\r?\n/).length < 1_900, true);
});
