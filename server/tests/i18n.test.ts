import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  SUPPORTED_LOCALES,
  localizeApiMessage,
  localizeBoard,
  localizeNotification,
  normalizeLocale,
  requestLocale,
} from "../src/i18n";

test("English is the fallback locale and Chinese is selected explicitly", () => {
  assert.deepEqual(SUPPORTED_LOCALES, ["en-US", "zh-CN"]);
  assert.equal(normalizeLocale(undefined), "en-US");
  assert.equal(normalizeLocale("en-GB,en;q=0.9"), "en-US");
  assert.equal(normalizeLocale("zh-TW,zh;q=0.9"), "zh-CN");
  assert.equal(requestLocale({ headers: {} }), "en-US");
  assert.equal(requestLocale({ headers: { "accept-language": "zh-CN" } }), "zh-CN");
});

test("API errors preserve Chinese or return safe English messages", () => {
  assert.equal(localizeApiMessage("用户不存在", "zh-CN"), "用户不存在");
  assert.equal(localizeApiMessage("用户不存在", "en-US"), "User not found");
  assert.equal(localizeApiMessage("接口不存在", "en-US"), "API endpoint not found");
  assert.equal(
    localizeApiMessage("双方均确认后才会发放积分", "en-US"),
    "Points are granted only after both parties confirm completion",
  );
  assert.equal(
    localizeApiMessage("未知的中文业务错误", "en-US"),
    "The request could not be completed. Review your input and try again.",
  );
  assert.equal(localizeApiMessage("Upstream timeout", "en-US"), "Upstream timeout");
});

test("board catalog and notifications localize without changing stored data", () => {
  const board = { slug: "ielts", name: "2+2专区", description: "西浦2+2交流专区", enabled: true };
  assert.deepEqual(localizeBoard(board, "zh-CN"), board);
  assert.deepEqual(localizeBoard(board, "en-US"), {
    ...board,
    name: "2+2 Zone",
    description: "A dedicated space for XJTLU 2+2 students",
  });

  const notification = {
    title: "交易完成",
    content: "双方已确认成交，系统已发放 6 积分",
    source: "靠浦市集",
    untouched: 42,
  };
  assert.deepEqual(localizeNotification(notification, "zh-CN"), notification);
  assert.deepEqual(localizeNotification(notification, "en-US"), {
    ...notification,
    title: "Trade completed",
    content: "Both parties confirmed completion. 6 points have been granted.",
    source: "Kaopu Market",
  });
});

test("web and account locale contracts default to English without exposing preferences publicly", () => {
  const webI18n = readFileSync(new URL("../../web/src/i18n/index.ts", import.meta.url), "utf8");
  const webHtml = readFileSync(new URL("../../web/index.html", import.meta.url), "utf8");
  const requestSource = readFileSync(new URL("../../web/src/api/request.ts", import.meta.url), "utf8");
  const publicUser = readFileSync(new URL("../src/utils/publicUser.ts", import.meta.url), "utf8");
  const appSource = readFileSync(new URL("../src/app.ts", import.meta.url), "utf8");
  const learningLabels = readFileSync(new URL("../../web/src/utils/learningMaterialLocale.ts", import.meta.url), "utf8");
  const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../prisma/migrations/20260730050000_user_preferred_locale/migration.sql", import.meta.url), "utf8");

  assert.match(webI18n, /DEFAULT_LOCALE:\s*AppLocale\s*=\s*"en-US"/);
  assert.match(webHtml, /<html lang="en-US" data-locale="en-US">/);
  assert.match(webHtml, /Reimagine campus life/);
  assert.doesNotMatch(webHtml, /stored === "system"|mode === "system"/);
  assert.match(requestSource, /\["Accept-Language"\]\s*=\s*getActiveLocale\(\)/);
  assert.match(appSource, /localizeApiMessage\("接口不存在", requestLocale\(req\)\)/);
  assert.match(learningLabels, /Y1S1: "Year 1 · Semester 1"/);
  assert.match(learningLabels, /课程笔记: "Course notes"/);
  assert.match(schema, /preferredLocale\s+String\s+@default\("en-US"\)/);
  assert.match(migration, /CHECK \("preferredLocale" IN \('en-US', 'zh-CN'\)\)/);

  const selfBuilder = publicUser.slice(
    publicUser.indexOf("export function buildSelfUser"),
    publicUser.indexOf("export function buildPublicUser"),
  );
  const publicBuilder = publicUser.slice(
    publicUser.indexOf("export function buildPublicUser"),
    publicUser.indexOf("export function buildUserPreview"),
  );
  assert.match(selfBuilder, /preferredLocale/);
  assert.doesNotMatch(publicBuilder, /preferredLocale/);
});
