import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import {
  learningCreatorAppealDecisionSchema,
  learningCreatorAppealSchema,
  learningCreatorViolationSchema,
  learningMaterialRatingSchema,
  learningOrderIssueDecisionSchema,
  learningOrderIssueMessageSchema,
} from "../src/services/learningCommerceContracts";
import {
  createLearningPdfSample,
  createLicensedLearningPdf,
  inspectLearningPdf,
  validateLearningPdfPreviewRange,
} from "../src/services/learningMaterialPdfService";

async function makePdf(pageCount: number) {
  const document = await PDFDocument.create();
  for (let index = 0; index < pageCount; index += 1) {
    const page = document.addPage([480, 680]);
    page.drawText(`Original learning page ${index + 1}`, { x: 40, y: 620, size: 18 });
  }
  return Buffer.from(await document.save());
}

test("PDF delivery extracts only configured sample pages and stamps licensed copies", async () => {
  const source = await makePdf(5);
  assert.deepEqual(await inspectLearningPdf(source), { pageCount: 5 });
  const sample = await createLearningPdfSample(source, 2, 3);
  const sampleDocument = await PDFDocument.load(sample);
  assert.equal(sampleDocument.getPageCount(), 2);
  assert.notDeepEqual(sample, source);

  const licensed = await createLicensedLearningPdf(source, {
    userId: 12,
    orderId: 34,
    fileId: 56,
    accessedAt: new Date("2026-07-29T12:00:00.000Z"),
    watermarkCode: "ABCDEF012345",
  });
  assert.equal((await PDFDocument.load(licensed)).getPageCount(), 5);
  assert.notDeepEqual(licensed, source);
  assert.throws(() => validateLearningPdfPreviewRange(5, 0, 2));
  assert.throws(() => validateLearningPdfPreviewRange(20, 1, 11));
  await assert.rejects(() => inspectLearningPdf(Buffer.from("not a pdf")));
});

test("rating, governance and evidence contracts fail closed", () => {
  assert.equal(learningMaterialRatingSchema.safeParse({
    accuracy: 5,
    usefulness: 4,
    descriptionMatch: 5,
    fileQuality: 4,
    content: "内容清楚，文件可以正常打开。",
  }).success, true);
  assert.equal(learningMaterialRatingSchema.safeParse({
    accuracy: 6,
    usefulness: 4,
    descriptionMatch: 5,
    fileQuality: 4,
  }).success, false);
  assert.equal(learningCreatorViolationSchema.safeParse({
    creatorId: 1,
    type: "misleading",
    severity: "high",
    action: "hide_material",
    reason: "资料描述与实际交付内容不符",
  }).success, false);
  assert.equal(learningCreatorViolationSchema.safeParse({
    creatorId: 1,
    itemId: 2,
    type: "misleading",
    severity: "high",
    action: "hide_material",
    reason: "资料描述与实际交付内容不符",
  }).success, true);
  assert.equal(learningCreatorAppealSchema.safeParse({ content: "事实认定存在误差，请复核相关版本记录。" }).success, true);
  assert.equal(learningCreatorAppealDecisionSchema.safeParse({ action: "approve", note: "证据成立，撤销记录" }).success, true);
  assert.equal(learningOrderIssueMessageSchema.safeParse({ content: "", attachmentKind: "executable" }).success, false);
  assert.equal(learningOrderIssueDecisionSchema.safeParse({
    action: "resolve",
    resolution: "完成核验",
    responsibility: "unassigned",
  }).success, false);
});

test("iteration two keeps schema, migration, API and three user roles aligned", () => {
  const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../prisma/migrations/20260729020000_learning_trust_delivery_v2/migration.sql", import.meta.url), "utf8");
  const materialRouter = readFileSync(new URL("../src/routes/learningMaterials.ts", import.meta.url), "utf8");
  const commerceRouter = readFileSync(new URL("../src/routes/learningCommerce.ts", import.meta.url), "utf8");
  const service = readFileSync(new URL("../src/services/learningCommerceService.ts", import.meta.url), "utf8");
  const trust = readFileSync(new URL("../src/services/learningTrustService.ts", import.meta.url), "utf8");
  const webApi = readFileSync(new URL("../../web/src/api/learningMaterials.ts", import.meta.url), "utf8");
  const detail = readFileSync(new URL("../../web/src/views/market/LearningMaterialDetail.vue", import.meta.url), "utf8");
  const orders = readFileSync(new URL("../../web/src/views/market/LearningOrders.vue", import.meta.url), "utf8");
  const creator = readFileSync(new URL("../../web/src/views/market/LearningCreatorCenter.vue", import.meta.url), "utf8");
  const admin = readFileSync(new URL("../../web/src/views/admin/LearningCommerceAdminPane.vue", import.meta.url), "utf8");

  assert.match(schema, /model LearningMaterialAccessEvent/);
  assert.match(schema, /model LearningMaterialRating/);
  assert.match(schema, /model LearningOrderIssueMessage/);
  assert.match(schema, /model LearningCreatorViolation/);
  assert.match(migration, /LearningMaterialFile_preview_pages_check/);
  assert.match(migration, /LearningMaterialRating_scores_check/);
  assert.match(migration, /LearningMaterialRating_versionId_fkey/);
  assert.match(migration, /LearningMaterialAccessEvent_fileId_fkey[\s\S]*ON DELETE SET NULL/);
  assert.match(materialRouter, /sample_preview/);
  assert.match(materialRouter, /createLicensedLearningPdf/);
  assert.match(commerceRouter, /\/orders\/:id\/rating/);
  assert.match(commerceRouter, /\/admin\/operations/);
  assert.match(service, /refund_evidence/);
  assert.match(service, /responsibility/);
  assert.match(service, /firstRespondedAt: null/);
  assert.match(service, /assignedToId: row\.assignedToId/);
  assert.match(trust, /refreshLearningCreatorMetrics/);
  assert.match(trust, /acquireMarketOrderLock/);
  assert.match(webApi, /sendOrderIssueMessage/);
  assert.match(detail, /真实试读/);
  assert.match(orders, /带水印阅读/);
  assert.match(creator, /治理记录与申诉/);
  assert.match(admin, /责任认定/);
});
