import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { moveArrayEntry } from "../../web/src/utils/publishDraft";

test("phase 7 publish image ordering remains deterministic", () => {
  const images = ["cover", "detail-a", "detail-b"];
  moveArrayEntry(images, 2, 0);
  assert.deepEqual(images, ["detail-b", "cover", "detail-a"]);
  moveArrayEntry(images, -1, 1);
  assert.deepEqual(images, ["detail-b", "cover", "detail-a"]);
});

test("phase 7 publishing restores local drafts and optimizes large images", () => {
  const draft = readFileSync(new URL("../../web/src/utils/publishDraft.ts", import.meta.url), "utf8");
  const image = readFileSync(new URL("../../web/src/utils/publishImage.ts", import.meta.url), "utf8");
  const listing = readFileSync(new URL("../../web/src/views/market/Publish.vue", import.meta.url), "utf8");
  const wanted = readFileSync(new URL("../../web/src/views/market/WantedPublish.vue", import.meta.url), "utf8");
  const material = readFileSync(new URL("../../web/src/views/market/LearningMaterialPublish.vue", import.meta.url), "utf8");
  assert.match(draft, /14 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(draft, /userId \|\| "guest"/);
  assert.match(image, /IMAGE_MAX_EDGE = 2000/);
  assert.match(image, /canvas\.toBlob\(resolve, "image\/webp", 0\.84\)/);
  for (const page of [listing, wanted, material]) {
    assert.match(page, /readPublishDraft/);
    assert.match(page, /clearPublishDraft/);
    assert.match(page, /信息完整度|资料完整度/);
  }
  assert.match(listing, /moveArrayEntry/);
  assert.match(material, /optimizePublishImage/);
});

test("phase 7 mobile web exposes complete site and publishing navigation", () => {
  const layout = readFileSync(new URL("../../web/src/layouts/MainLayout.vue", import.meta.url), "utf8");
  const market = readFileSync(new URL("../../web/src/views/market/Index.vue", import.meta.url), "utf8");
  const hub = readFileSync(new URL("../../web/src/views/publish/Index.vue", import.meta.url), "utf8");
  const sheet = readFileSync(new URL("../../web/src/components/navigation/PublishActionSheet.vue", import.meta.url), "utf8");
  assert.match(layout, /footer-safety/);
  assert.match(layout, /页脚导航/);
  assert.match(market, /mobileFiltersOpen/);
  assert.match(hub, /\/learning\/free\/publish/);
  assert.match(sheet, /分享免费原创/);
});
