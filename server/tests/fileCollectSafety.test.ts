import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  fileCollectIdentityLockKey,
  fileCollectTaskLockKey,
} from "../src/services/fileCollectLockService";
import {
  filestoreUpstreamPath,
  rewriteFilestoreProxyHeaderValue,
  rewriteFilestoreProxyText,
} from "../src/services/filestoreProxyRuntime";
import { isPublicFilestoreRequest } from "../src/services/filestoreAccessService";
import {
  normalizeFilestoreFields,
  normalizeFilestoreRules,
  normalizeFilestoreStatus,
  normalizeFilestoreSurveyFields,
  normalizeFilestoreTaskPayload,
  parseStoredFilestoreFields,
} from "../src/services/filestoreContracts";
import { FilestoreApiError } from "../src/services/filestoreApiError";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "file-collect-test-secret";

test("file collection advisory lock keys are stable and scope separated", () => {
  assert.equal(fileCollectTaskLockKey(42), fileCollectTaskLockKey(42));
  assert.notEqual(fileCollectTaskLockKey(42), fileCollectTaskLockKey(43));
  assert.notEqual(
    fileCollectTaskLockKey(42),
    fileCollectIdentityLockKey(42, "student-1"),
  );
  assert.notEqual(
    fileCollectIdentityLockKey(42, "student-1"),
    fileCollectIdentityLockKey(42, "student-2"),
  );
  assert.notEqual(
    fileCollectIdentityLockKey(42, "student-1"),
    fileCollectIdentityLockKey(43, "student-1"),
  );
});

test("remote completion tokens are bound to submission, task, and age", async () => {
  const {
    signFileCollectCompletionToken,
    verifyFileCollectCompletionToken,
  } = await import("../src/services/fileCollectCompletionToken");
  const { normalizeFilestoreStatus } = await import(
    "../src/services/filestore"
  );
  const submission = {
    id: 101,
    taskId: 202,
    createdAt: new Date(),
  };
  const token = signFileCollectCompletionToken(submission);

  assert.equal(verifyFileCollectCompletionToken(token, submission), true);
  assert.equal(
    verifyFileCollectCompletionToken(token, { ...submission, id: 102 }),
    false,
  );
  assert.equal(
    verifyFileCollectCompletionToken(token, { ...submission, taskId: 203 }),
    false,
  );
  assert.equal(
    verifyFileCollectCompletionToken(`${token.slice(0, -1)}x`, submission),
    false,
  );

  const expired = {
    ...submission,
    createdAt: new Date(Date.now() - 9 * 60 * 60 * 1000),
  };
  assert.equal(
    verifyFileCollectCompletionToken(
      signFileCollectCompletionToken(expired),
      expired,
    ),
    false,
  );
  assert.equal(normalizeFilestoreStatus("open"), "open");
  assert.equal(normalizeFilestoreStatus("draft"), "draft");
  assert.equal(normalizeFilestoreStatus("closed"), "closed");
  assert.equal(normalizeFilestoreStatus("unexpected"), "closed");
});

test("both file collection paths use two-phase submission without import-time directories", () => {
  const tools = readFileSync(
    new URL("../src/routes/tools/fileCollections.ts", import.meta.url),
    "utf8",
  );
  const filestore = readFileSync(
    new URL("../src/services/filestore.ts", import.meta.url),
    "utf8",
  );
  const submissionService = readFileSync(
    new URL("../src/services/fileCollectSubmissionService.ts", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(tools, /mkdirSync/);
  assert.doesNotMatch(filestore, /mkdirSync/);
  assert.match(tools, /status:\s*"uploading"/);
  assert.match(tools, /data:\s*\{\s*status:\s*"submitted"\s*\}/);
  assert.match(filestore, /status:\s*"uploading"/);
  assert.match(filestore, /completionToken:\s*signFileCollectCompletionToken/);
  assert.match(filestore, /verifyFileCollectCompletionToken/);
  assert.match(tools, /removeStaleFileCollectUploadsForIdentity/);
  assert.match(filestore, /removeStaleFileCollectUploadsForIdentity/);
  assert.match(tools, /refreshFileCollectTaskCounters/);
  assert.match(filestore, /refreshFileCollectTaskCounters/);
  assert.match(submissionService, /FILE_COLLECT_UPLOAD_STALE_MS/);
  assert.match(submissionService, /status:\s*"submitted"/);
});

test("filestore proxy runtime rewrites only the mounted transport boundary", () => {
  assert.equal(
    filestoreUpstreamPath({
      originalUrl: "/filestore/status/task-1?token=abc",
      url: "/status/task-1?token=abc",
    } as any),
    "/status/task-1?token=abc",
  );
  assert.equal(
    rewriteFilestoreProxyText(
      '<script src="/admin.js"></script><script>fetch("/api/tasks")</script>',
    ),
    '<script src="/filestore/admin.js"></script><script>fetch("/filestore/api/tasks")</script>',
  );
  assert.equal(
    rewriteFilestoreProxyHeaderValue("location", "/admin"),
    "/filestore/admin",
  );
  assert.equal(
    rewriteFilestoreProxyHeaderValue(
      "set-cookie",
      "session=1; Path=/; HttpOnly",
    ),
    "session=1; Path=/filestore; HttpOnly",
  );

  const runtime = readFileSync(
    new URL("../src/services/filestoreProxyRuntime.ts", import.meta.url),
    "utf8",
  );
  const filestore = readFileSync(
    new URL("../src/services/filestore.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(runtime, /export\s+(?:const|let|var)\s+TRUSTED_PROXY_TOKEN/);
  assert.match(filestore, /from "\.\/filestoreProxyRuntime"/);
  assert.doesNotMatch(filestore, /node:child_process/);
  assert.doesNotMatch(filestore, /function proxyToFilestore/);
});

test("filestore public access is an exact method and path allowlist", () => {
  const request = (method: string, originalUrl: string) => ({
    method,
    originalUrl,
    url: originalUrl,
  } as any);

  assert.equal(
    isPublicFilestoreRequest(request("GET", "/filestore/api/health")),
    true,
  );
  assert.equal(
    isPublicFilestoreRequest(
      request("GET", "/filestore/api/public/tasks/task_1"),
    ),
    true,
  );
  assert.equal(
    isPublicFilestoreRequest(
      request("POST", "/filestore/api/submit/task_1/prepare-remote"),
    ),
    true,
  );
  assert.equal(
    isPublicFilestoreRequest(
      request("HEAD", "/filestore/api/files/12/public-preview/token/name.docx"),
    ),
    true,
  );
  assert.equal(
    isPublicFilestoreRequest(request("POST", "/filestore/api/health")),
    false,
  );
  assert.equal(
    isPublicFilestoreRequest(request("GET", "/filestore/api/tasks")),
    false,
  );
  assert.equal(
    isPublicFilestoreRequest(request("GET", "/filestore/api")),
    false,
  );
  assert.equal(
    isPublicFilestoreRequest(
      request("GET", "/filestore/api/public/tasks/task_1/extra"),
    ),
    false,
  );
});

test("filestore contracts reject invalid fields, rules, and branching", () => {
  assert.throws(
    () => normalizeFilestoreFields([
      { key: "student_id", label: "学号" },
      { key: "student_id", label: "重复学号" },
    ]),
    (error) => error instanceof FilestoreApiError && error.status === 400,
  );
  assert.throws(
    () => normalizeFilestoreFields([
      { key: "student_id", label: "学号", pattern: "[" },
    ]),
    (error) => error instanceof FilestoreApiError && error.status === 400,
  );
  assert.throws(
    () => normalizeFilestoreRules({ maxSizeMb: 20, maxCount: 21 }),
    (error) => error instanceof FilestoreApiError && error.status === 400,
  );

  const survey = normalizeFilestoreSurveyFields([
    {
      id: "choice",
      label: "选择",
      type: "single",
      options: ["继续", "结束"],
      branching: {
        继续: { action: "jump", targetId: "details" },
        结束: { action: "end" },
      },
    },
    { id: "details", label: "说明", type: "textarea" },
  ]);
  assert.deepEqual(survey[0].branching, {
    继续: { action: "jump", targetId: "details" },
    结束: { action: "end" },
  });
  assert.equal(normalizeFilestoreStatus("unexpected"), "closed");
  assert.equal(
    normalizeFilestoreTaskPayload({
      title: "材料收集",
      status: "draft",
      fields: [{ key: "student_id", label: "学号" }],
      fileRules: { maxSizeMb: 20, maxCount: 1 },
    }).status,
    "draft",
  );
  assert.deepEqual(parseStoredFilestoreFields("{broken"), []);
});
