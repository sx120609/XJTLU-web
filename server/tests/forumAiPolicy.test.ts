import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { reviewReplyContent, reviewTopicContent } from "../src/services/topicAiReview";

test("forum AI moderation fails closed when the provider is not configured", async () => {
  const topic = await reviewTopicContent({ title: "测试帖子", content: "普通内容" });
  const reply = await reviewReplyContent({ content: "普通回复" });

  assert.equal(topic.status, "blocked_ai");
  assert.equal(reply.status, "blocked_ai");
  assert.equal(topic.riskLevel, "medium");
  assert.match(topic.reason, /申请人工复核/);
  assert.equal(JSON.parse(topic.detail).unavailable, true);
});

test("normal forum writes cannot skip review merely because AI is disabled", () => {
  const sources = [
    readFileSync(new URL("../src/routes/topic.ts", import.meta.url), "utf8"),
    readFileSync(new URL("../src/routes/reply.ts", import.meta.url), "utf8"),
    readFileSync(new URL("../src/services/marketWantedWriteService.ts", import.meta.url), "utf8"),
  ];

  for (const source of sources) {
    assert.doesNotMatch(source, /shouldRunAiReview/);
    assert.match(source, /reviewTopicContent|reviewReplyContent/);
  }
});
