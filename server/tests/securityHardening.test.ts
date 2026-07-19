import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolveJwtSecret } from "../src/config.js";

test("production refuses missing or weak JWT secrets", () => {
  assert.throws(() => resolveJwtSecret("production", undefined), /JWT_SECRET/);
  assert.throws(() => resolveJwtSecret("production", "short-secret"), /JWT_SECRET/);
  assert.equal(resolveJwtSecret("development", undefined), "xjtlu-web-dev-secret");
  assert.equal(resolveJwtSecret("production", "x".repeat(32)), "x".repeat(32));
});

test("production dependency hardening stays in the declared package graph", () => {
  const serverPackage = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const webPackage = JSON.parse(readFileSync(new URL("../../web/package.json", import.meta.url), "utf8"));
  const webLock = JSON.parse(readFileSync(new URL("../../web/package-lock.json", import.meta.url), "utf8"));
  assert.equal(serverPackage.dependencies.NeteaseCloudMusicApi, undefined);
  assert.match(webPackage.dependencies.echarts, /^\^6\./);
  assert.match(webPackage.dependencies["vue-echarts"], /^\^8\./);
  assert.equal(webPackage.dependencies.xlsx, undefined);
  assert.match(webPackage.dependencies.exceljs, /^\^4\./);
  assert.match(webPackage.overrides.uuid, /^\^11\./);
  const dompurifyVersion = String(webLock.packages?.["node_modules/dompurify"]?.version || "0.0.0");
  const [major, minor, patch] = dompurifyVersion.split(".").map(Number);
  assert.ok(major > 3 || (major === 3 && (minor > 4 || (minor === 4 && patch >= 10))));
});

test("production deployment never seeds fixed development accounts", () => {
  const deployScript = readFileSync(new URL("../../deploy.sh", import.meta.url), "utf8");
  const start = deployScript.indexOf("do_db_init() {");
  const end = deployScript.indexOf("\ndo_db_reset()", start);
  assert.ok(start >= 0 && end > start, "do_db_init should remain present in deploy.sh");
  const databaseInit = deployScript.slice(start, end);
  assert.doesNotMatch(databaseInit, /db:seed/);
  assert.match(databaseInit, /生产部署不写入开发测试账号/);
});

test("grade spreadsheet import preserves source columns and bounds untrusted workbooks", () => {
  const page = readFileSync(new URL("../../web/src/views/services/ToolManage.vue", import.meta.url), "utf8");
  assert.match(page, /GRADE_EXCEL_MAX_BYTES = 5 \* 1024 \* 1024/);
  assert.match(page, /GRADE_EXCEL_MAX_ROWS = 5_000/);
  assert.match(page, /GRADE_EXCEL_MAX_COLUMNS = 100/);
  assert.match(page, /UNSAFE_EXCEL_COLUMNS/);
  assert.match(page, /new ExcelJS\.Workbook\(\)/);
  assert.match(page, /sheet\.actualRowCount/);
  assert.match(page, /sheet\.actualColumnCount/);
  assert.match(page, /line\[column\.index\]/);
  assert.match(page, /Object\.create\(null\)/);
  assert.doesNotMatch(page, /headerRow\.map\([^\n]+\.filter\(Boolean\)/);
});
