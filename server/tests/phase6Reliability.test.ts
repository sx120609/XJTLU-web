import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

  const app = readFileSync(new URL("../src/app.ts", import.meta.url), "utf8");
  const serverEntry = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
  const backgroundWorkers = readFileSync(new URL("../src/runtime/backgroundWorkers.ts", import.meta.url), "utf8");
  assert.doesNotMatch(app, /start(?:Forum|Market|Promotion|Qq|Runtime|Sponsor)[A-Za-z]+(?:Poller|Sync)\(\)/);
  assert.match(serverEntry, /startBackgroundWorkers\(\)/);
  assert.match(backgroundWorkers, /startForumImageModerationPoller\(\)/);
  assert.match(backgroundWorkers, /startXjtluAnnouncementSyncScheduler\(\)/);
});

test("school portal failures stay isolated from the site session and stop terminal retries", () => {
  const ebridge = readFileSync(new URL("../src/services/xjtluEbridgeClient.ts", import.meta.url), "utf8");
  const sso = readFileSync(new URL("../src/services/xjtluSsoClient.ts", import.meta.url), "utf8");
  const academicPage = readFileSync(new URL("../../web/src/views/academic/Index.vue", import.meta.url), "utf8");
  const announcements = readFileSync(new URL("../src/services/xjtluAnnouncementSync.ts", import.meta.url), "utf8");

  assert.match(ebridge, /EBRIDGE_SESSION_EXPIRED_CODE = 4601/);
  assert.match(ebridge, /new HttpError\(409, EBRIDGE_SESSION_EXPIRED_CODE/);
  assert.match(ebridge, /eBridge 登录失败（学校端返回 \$\{result\.response\.status\}）/);
  assert.match(sso, /Establishing eHall and eBridge concurrently with cloned cookie jars/);
  assert.match(sso, /uimCookies: pending\.cookies/);
  assert.match(academicPage, /if \(loading\.value\) return/);
  assert.match(academicPage, /academicApi\.status\(\{\s*refresh: true/);
  assert.match(academicPage, /suppressAuthRedirect: true/);
  assert.doesNotMatch(academicPage, /auth\.logout\(\)/);
  assert.doesNotMatch(academicPage, /退出并重新登录/);
  assert.match(academicPage, /重新连接 eBridge/);
  assert.match(academicPage, /reconnect: "ebridge"/);
  assert.match(announcements, /enabled: authorizationExpired \? false/);
  assert.match(announcements, /encryptedSession: authorizationExpired \? ""/);
});
