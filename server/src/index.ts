import { createServer } from "node:http";
import { createApp } from "./app";
import { config } from "./config";
import { ensureBuiltinBoards } from "./services/defaultBoards";
import { loadFeatures } from "./services/siteSettings";
import { loadStorageConfig } from "./services/storageConfig";
import { backfillWantedDemandTopics } from "./services/wantedDemandTopic";
import { startBackgroundWorkers } from "./runtime/backgroundWorkers";

async function prepareRuntimeState() {
  const createdBoards = await ensureBuiltinBoards().catch((e) => {
    console.warn("ensureBuiltinBoards failed:", e?.message);
    return [];
  });
  if (createdBoards.length) {
    console.log(`🏛️  已补齐默认板块: ${createdBoards.map((board) => board.name).join("、")}`);
  }
  const backfilledWantedTopics = await backfillWantedDemandTopics().catch((e) => {
    console.warn("backfillWantedDemandTopics failed:", e?.message);
    return 0;
  });
  if (backfilledWantedTopics) console.log(`🧾 已补齐求购需求帖子: ${backfilledWantedTopics} 条`);
  await loadFeatures().catch((e) => console.warn("loadFeatures failed:", e?.message));
  await loadStorageConfig().catch((e) => console.warn("loadStorageConfig failed:", e?.message));
}

async function start() {
  await prepareRuntimeState();
  const app = createApp();
  const server = createServer(app);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, () => {
      server.off("error", reject);
      resolve();
    });
  });

  console.log(`🚀 靠浦服务端已启动:  http://localhost:${config.port}`);
  console.log(`   健康检查:           http://localhost:${config.port}/api/health`);
  console.log(`   电费 API base:       ${process.env.DORM_ELECTRIC_BASE || "(未设，使用默认 http://sz.weicheng.wang:8899)"}`);
  startBackgroundWorkers();
}

start().catch((error) => {
  console.error("靠浦服务端启动失败", error);
  process.exit(1);
});
