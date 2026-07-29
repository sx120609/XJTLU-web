import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";

process.env.NODE_ENV = "test";
process.env.REDIS_ENABLED = "false";
process.env.JWT_SECRET = "questionnaire-integration-secret";

test("one-response questionnaires remain unique under concurrent requests", async (t) => {
  const express = (await import("express")).default;
  const { router } = await import("../src/routes");
  const { errorHandler } = await import("../src/middleware/error");
  const { prisma } = await import("../src/prisma");
  const { signToken } = await import("../src/utils/jwt");

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 100_000)}`;
  const user = await prisma.user.create({
    data: {
      username: `questionnaire_user_${suffix}`,
      passwordHash: "not-used",
      nickname: "问卷并发测试用户",
    },
  });
  const questionnaire = await prisma.questionnaire.create({
    data: {
      toolCode: "questionnaire",
      slug: `questionnaire-safety-${suffix}`,
      title: "问卷并发安全测试",
      status: "open",
      visibility: "login",
      allowAnonymous: false,
      oneResponsePerUser: true,
      fields: JSON.stringify([
        {
          id: "choice",
          label: "选择",
          type: "single",
          required: true,
          options: ["A", "B"],
        },
      ]),
      publishedAt: new Date(),
    },
  });

  t.after(async () => {
    await prisma.questionnaire.deleteMany({
      where: { id: questionnaire.id },
    });
    await prisma.user.deleteMany({ where: { id: user.id } });
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
  const token = signToken({
    userId: user.id,
    studentId: user.username,
    role: user.role,
    campus: "SIP",
  });

  async function submit() {
    return fetch(
      `${baseUrl}/api/tools/questionnaires/${encodeURIComponent(questionnaire.slug)}/responses`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ answers: { choice: "A" } }),
      },
    );
  }

  const responses = await Promise.all([submit(), submit()]);
  assert.deepEqual(
    responses.map((response) => response.status).sort(),
    [200, 409],
  );
  assert.equal(
    await prisma.questionnaireResponse.count({
      where: {
        questionnaireId: questionnaire.id,
        respondentId: user.id,
      },
    }),
    1,
  );
});
