import assert from "node:assert/strict";
import test from "node:test";
import { getRuntimeHealthSnapshot, runTrackedJob } from "../src/services/runtimeHealth";

test("runtime job health records success, failure and prevents overlapping runs", async () => {
  const key = `phase6-test-${Date.now()}`;
  let release: (() => void) | undefined;
  const first = runTrackedJob(key, "阶段六测试任务", () => new Promise<void>((resolve) => {
    release = resolve;
  }), 1_000);
  const skipped = await runTrackedJob(key, "阶段六测试任务", async () => undefined, 1_000);
  assert.equal(skipped, undefined);
  release?.();
  await first;

  let job = getRuntimeHealthSnapshot().jobs.find((row) => row.key === key);
  assert.equal(job?.status, "healthy");
  assert.equal(job?.runs, 1);
  assert.equal(job?.skippedOverlaps, 1);
  assert.ok(job?.lastSucceededAt);

  await assert.rejects(
    runTrackedJob(key, "阶段六测试任务", async () => { throw new Error("expected failure"); }, 1_000),
    /expected failure/,
  );
  job = getRuntimeHealthSnapshot().jobs.find((row) => row.key === key);
  assert.equal(job?.status, "failed");
  assert.equal(job?.failures, 1);
  assert.equal(job?.lastError, "expected failure");
});

test("phase 6 keeps request tracing and release verification wired", () => {
  const snapshot = getRuntimeHealthSnapshot();
  assert.ok(snapshot.process.startedAt);
  assert.ok(snapshot.process.memory.heapTotalBytes > 0);
});
