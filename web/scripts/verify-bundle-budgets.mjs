import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";

const distRoot = path.resolve(process.cwd(), "dist");
const manifestPath = path.join(distRoot, ".vite", "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const entries = Object.entries(manifest);
const mainEntry = entries.find(([, value]) => value.isEntry);
assert.ok(mainEntry, "构建产物缺少主入口 manifest 记录");

async function gzipBytes(relativePath) {
  const buffer = await readFile(path.join(distRoot, relativePath));
  return gzipSync(buffer).byteLength;
}

async function rawBytes(relativePath) {
  return (await stat(path.join(distRoot, relativePath))).size;
}

function collectInitialChunks(key, visited = new Set()) {
  if (visited.has(key)) return visited;
  visited.add(key);
  const row = manifest[key];
  for (const imported of row?.imports || []) collectInitialChunks(imported, visited);
  return visited;
}

const initialKeys = collectInitialChunks(mainEntry[0]);
const initialFiles = new Set();
for (const key of initialKeys) {
  const row = manifest[key];
  if (row?.file) initialFiles.add(row.file);
  for (const css of row?.css || []) initialFiles.add(css);
}
const initialGzipBytes = (await Promise.all([...initialFiles].map(gzipBytes))).reduce((sum, value) => sum + value, 0);
const INITIAL_GZIP_BUDGET = 700 * 1024;
assert.ok(initialGzipBytes <= INITIAL_GZIP_BUDGET, `首屏静态资源 gzip ${(initialGzipBytes / 1024).toFixed(1)} KiB 超过 ${INITIAL_GZIP_BUDGET / 1024} KiB 预算`);

const criticalViews = [
  "src/views/Home.vue",
  "src/views/market/Index.vue",
  "src/views/market/Publish.vue",
  "src/views/market/WantedList.vue",
  "src/views/market/WantedDetail.vue",
  "src/views/market/PromotionCenter.vue",
];
const critical = [];
for (const source of criticalViews) {
  const row = manifest[source];
  assert.ok(row?.file, `关键移动 Web 页面未独立产出：${source}`);
  const raw = await rawBytes(row.file);
  const gzip = await gzipBytes(row.file);
  assert.ok(raw <= 140 * 1024, `${source} 产物 ${(raw / 1024).toFixed(1)} KiB 超过 140 KiB 预算`);
  assert.ok(gzip <= 50 * 1024, `${source} gzip ${(gzip / 1024).toFixed(1)} KiB 超过 50 KiB 预算`);
  critical.push({ source, rawKiB: Number((raw / 1024).toFixed(1)), gzipKiB: Number((gzip / 1024).toFixed(1)) });
}

console.log(JSON.stringify({ ok: true, initialGzipKiB: Number((initialGzipBytes / 1024).toFixed(1)), initialBudgetKiB: INITIAL_GZIP_BUDGET / 1024, critical }));
