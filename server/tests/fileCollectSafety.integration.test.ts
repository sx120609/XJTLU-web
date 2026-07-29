import assert from "node:assert/strict";
import { once } from "node:events";
import { rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import path from "node:path";
import test from "node:test";

process.env.NODE_ENV = "test";
process.env.REDIS_ENABLED = "false";
process.env.JWT_SECRET = "file-collect-integration-secret";

test("legacy file submissions replace atomically and respect task closure", async (t) => {
  const express = (await import("express")).default;
  const { router } = await import("../src/routes");
  const { errorHandler } = await import("../src/middleware/error");
  const { prisma } = await import("../src/prisma");

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 100_000)}`;
  const slug = `file-collect-safety-${suffix}`;
  const task = await prisma.fileCollectTask.create({
    data: {
      slug,
      title: "文件收集并发安全测试",
      status: "open",
      visibility: "public",
      fields: JSON.stringify([
        {
          id: "student_id",
          label: "学号",
          type: "text",
          required: true,
        },
      ]),
      fileRules: JSON.stringify({
        allowedTypes: ["txt"],
        maxSizeMb: 1,
        maxCount: 1,
      }),
      renameTemplate: "{student_id}-{original}",
      folderTemplate: "{student_id}",
    },
  });
  const taskDirectory = path.resolve(
    process.cwd(),
    "uploads",
    "file-collect",
    String(task.id),
  );

  t.after(async () => {
    await prisma.fileCollectTask.deleteMany({ where: { id: task.id } });
    await rm(taskDirectory, { recursive: true, force: true });
  });

  const app = express();
  app.use(express.json());
  app.use("/api", router);
  app.use(errorHandler);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>((resolve) => {
    server.close(() => resolve());
  }));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  async function submit(content: string) {
    const form = new FormData();
    form.append("data", JSON.stringify({ student_id: "S1234567" }));
    form.append(
      "files",
      new Blob([content], { type: "text/plain" }),
      `${content}.txt`,
    );
    return fetch(
      `${baseUrl}/api/tools/file-collections/${encodeURIComponent(slug)}/submissions`,
      { method: "POST", body: form },
    );
  }

  const first = await submit("first");
  assert.equal(first.status, 200);
  const firstRows = await prisma.fileCollectSubmission.findMany({
    where: { taskId: task.id, status: "submitted" },
    include: { files: true },
  });
  assert.equal(firstRows.length, 1);
  assert.equal(firstRows[0].files.length, 1);

  const concurrent = await Promise.all([
    submit("second-a"),
    submit("second-b"),
  ]);
  assert.equal(concurrent.some((response) => response.status === 200), true);
  assert.equal(
    concurrent.every((response) => [200, 409].includes(response.status)),
    true,
  );

  const afterReplace = await prisma.fileCollectSubmission.findMany({
    where: { taskId: task.id },
    include: { files: true },
  });
  assert.equal(
    afterReplace.filter((row) => row.status === "submitted").length,
    1,
    JSON.stringify(afterReplace.map((row) => ({
      id: row.id,
      identity: row.identity,
      status: row.status,
      fileCount: row.files.length,
    }))),
  );
  assert.equal(
    afterReplace.filter((row) => row.status === "uploading").length,
    0,
  );
  assert.equal(afterReplace[0].files.length, 1);
  const refreshedTask = await prisma.fileCollectTask.findUniqueOrThrow({
    where: { id: task.id },
  });
  assert.equal(refreshedTask.submissionCount, 1);
  assert.equal(refreshedTask.fileCount, 1);

  await prisma.fileCollectTask.update({
    where: { id: task.id },
    data: { status: "closed", closedAt: new Date() },
  });
  const closed = await submit("closed");
  assert.equal(closed.status, 400);
  assert.equal(
    await prisma.fileCollectSubmission.count({
      where: { taskId: task.id, status: "submitted" },
    }),
    1,
  );
});
