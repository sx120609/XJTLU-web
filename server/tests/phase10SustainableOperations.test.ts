import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { nextPromotionWindow, serializePromotionOrder } from "../src/services/promotion";

test("stage 10 renewal windows extend the existing slot and after-service references stay masked", () => {
  const now = new Date("2026-07-19T00:00:00.000Z");
  const currentUntil = new Date("2026-07-25T00:00:00.000Z");
  const window = nextPromotionWindow(currentUntil, 7, now);
  assert.equal(window.startsAt.toISOString(), now.toISOString());
  assert.equal(window.expiresAt.toISOString(), "2026-08-01T00:00:00.000Z");

  const serialized = serializePromotionOrder({
    id: 10,
    type: "listing_pin",
    amountCents: 990,
    manualCostCents: 100,
    verifiedAmountCents: 990,
    verificationReference: "RAW-PAYMENT-123456",
    impressionCount: 20,
    clickCount: 5,
    inquiryStartCount: 0,
    adjustments: [{ id: 1, orderId: 10, type: "refund_record", amountCents: 100, extensionDays: 0, reference: "RAW-REFUND-654321", note: "线下退款已完成", createdAt: now }],
  });
  assert.equal("verificationReference" in serialized, true);
  assert.equal(serialized.verificationReference, undefined);
  assert.equal(serialized.verificationReferenceMasked.endsWith("3456"), true);
  assert.equal(serialized.adjustments[0].reference, undefined);
  assert.equal(serialized.adjustments[0].referenceMasked.endsWith("4321"), true);
  assert.equal(serialized.manualCost, "1.00");
});

test("stage 10 keeps commercial shutdown, disk upload, performance budgets and accessibility wired", async () => {
  const root = path.resolve(import.meta.dirname, "../..");
  const [settings, routes, upload, layout, styles, webPackage, migration] = await Promise.all([
    readFile(path.join(root, "server/src/services/siteSettings.ts"), "utf8"),
    readFile(path.join(root, "server/src/routes/marketPromotions.ts"), "utf8"),
    readFile(path.join(root, "server/src/routes/upload.ts"), "utf8"),
    readFile(path.join(root, "web/src/layouts/MainLayout.vue"), "utf8"),
    readFile(path.join(root, "web/src/styles/index.scss"), "utf8"),
    readFile(path.join(root, "web/package.json"), "utf8"),
    readFile(path.join(root, "server/prisma/migrations/20260719030000_stage_10_sustainable_operations/migration.sql"), "utf8"),
  ]);
  assert.match(settings, /"promotion"/);
  assert.match(routes, /PROMOTION_CAPACITY_REACHED/);
  assert.match(routes, /adjustments/);
  assert.match(upload, /multer\.diskStorage/);
  assert.match(layout, /skip-link/);
  assert.match(styles, /prefers-reduced-motion/);
  assert.match(webPackage, /verify:budgets/);
  assert.match(migration, /PromotionAdjustment/);
  assert.match(migration, /reviewDueAt/);
});
