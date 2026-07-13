import test from "node:test";
import assert from "node:assert/strict";
import {
  LEARNING_MATERIAL_SEMESTERS,
  containsOffPlatformContact,
  isAllowedLearningMaterialFile,
  learningMaterialFileFormat,
  learningMaterialProfileInputSchema,
  normalizeCourseCode,
  normalizeDeclaredFormats,
  normalizeMaterialTypeName,
  parseDeclaredFormats,
  publishedMaterialProfileErrors,
  supportCategoryIsFinancial,
  validateCustomMaterialTypeName,
} from "../src/services/learningMaterials";

test("learning materials expose exactly eight single-select study stages", () => {
  assert.deepEqual(LEARNING_MATERIAL_SEMESTERS.map((item) => item.value), ["Y1S1", "Y1S2", "Y2S1", "Y2S2", "Y3S1", "Y3S2", "Y4S1", "Y4S2"]);
  assert.equal(learningMaterialProfileInputSchema.safeParse({ applicableSemester: "Y4S2" }).success, true);
  assert.equal(learningMaterialProfileInputSchema.safeParse({ applicableSemester: "Y5S1" }).success, false);
  assert.equal(learningMaterialProfileInputSchema.safeParse({ applicableSemester: ["Y1S1"] }).success, false);
});

test("course codes are canonical and publishing enforces the three requested fields", () => {
  assert.equal(normalizeCourseCode(" cpt 111 "), "CPT111");
  assert.deepEqual(publishedMaterialProfileErrors({ courseCode: "CPT111", typeId: 1, applicableSemester: "Y1S1", rightsConfirmed: true }), []);
  assert.deepEqual(publishedMaterialProfileErrors({ rightsConfirmed: true }), ["请填写课程代码", "请选择资料类型", "请选择适用学期"]);
  assert.equal(learningMaterialProfileInputSchema.safeParse({ courseCode: "课程一" }).success, false);
});

test("optional material metadata stays optional but validates supplied values", () => {
  assert.equal(learningMaterialProfileInputSchema.safeParse({ courseCode: "CPT111", applicableSemester: "Y1S1", typeId: 1, rightsConfirmed: true }).success, true);
  assert.equal(learningMaterialProfileInputSchema.safeParse({ pageCount: 0 }).success, false);
  assert.equal(learningMaterialProfileInputSchema.safeParse({ pageCount: 1.5 }).success, false);
  assert.equal(learningMaterialProfileInputSchema.safeParse({ language: "fr" }).success, false);
});

test("formats normalize, deduplicate and survive malformed legacy JSON", () => {
  assert.deepEqual(normalizeDeclaredFormats(["pdf", "PDF", "pptx", "exe"]), ["PDF", "PPTX"]);
  assert.deepEqual(parseDeclaredFormats('["pdf","docx"]'), ["PDF", "DOCX"]);
  assert.deepEqual(parseDeclaredFormats("not-json"), []);
  assert.equal(learningMaterialFileFormat("Guide.PDF"), "PDF");
  assert.equal(isAllowedLearningMaterialFile("notes.docx"), true);
  assert.equal(isAllowedLearningMaterialFile("virus.exe"), false);
});

test("seller-created types normalize and reject unsafe or duplicate-shaped names", () => {
  assert.equal(normalizeMaterialTypeName(" 课程  笔记 "), "课程 笔记");
  assert.equal(validateCustomMaterialTypeName("课程案例集"), "");
  assert.match(validateCustomMaterialTypeName("作业答案"), /不允许/);
  assert.match(validateCustomMaterialTypeName("A"), /2～20/);
});

test("order support blocks obvious diversion and identifies financial issues", () => {
  assert.equal(containsOffPlatformContact("请加微信 abc12345 私下付款"), true);
  assert.equal(containsOffPlatformContact("这个 PDF 的第 12 页无法打开"), false);
  assert.equal(supportCategoryIsFinancial("file_unavailable"), true);
  assert.equal(supportCategoryIsFinancial("usage"), false);
});
