<template>
  <div class="ann-pane">
    <el-card shadow="never" class="sync-card">
      <template #header>
        <div class="hdr">
          <h3 style="margin:0;font-size:15px">🔄 融合门户公告同步</h3>
          <el-tag :type="syncStatus.authorized && syncStatus.lastRunOk !== false ? 'success' : 'warning'" effect="plain">
            {{ syncStatus.authorized ? (syncStatus.enabled ? '定时同步中' : '已暂停') : '未授权' }}
          </el-tag>
        </div>
      </template>
      <p class="sync-desc">使用当前管理员已经建立的学校登录会话作为采集账号。公告会保存到数据库，首页和公告页对所有访客显示同一份内容。</p>
      <div class="sync-meta">
        <span>采集账号：{{ syncStatus.sourceUsername || '未设置' }}</span>
        <span>已保存：{{ syncStatus.count }} 条</span>
        <span>上次同步：{{ syncStatus.lastRunAt ? fmtDate(syncStatus.lastRunAt) : '从未' }}</span>
        <span v-if="syncStatus.lastError" class="sync-error">{{ syncStatus.lastError }}</span>
      </div>
      <div class="sync-actions">
        <el-input-number v-model="syncInterval" :min="5" :max="1440" :step="5" :disabled="syncBusy" />
        <span class="interval-unit">分钟一次</span>
        <el-switch v-model="syncEnabled" active-text="启用" inactive-text="暂停" :disabled="!syncStatus.authorized || syncBusy" @change="saveSyncConfig" />
        <el-button type="primary" :loading="syncBusy" @click="authorizeSync()">用当前账号授权</el-button>
        <el-button :loading="syncBusy" :disabled="!syncStatus.authorized" @click="runSync">立即同步</el-button>
        <el-button :loading="syncBusy" :disabled="!syncStatus.authorized" @click="saveSyncConfig">保存周期</el-button>
        <el-button v-if="syncStatus.authorized" text type="danger" :disabled="syncBusy" @click="clearSyncAuthorization">取消授权</el-button>
      </div>
    </el-card>

    <el-card shadow="never" class="composer">
      <template #header><h3 style="margin:0;font-size:15px">{{ editingId ? "✏️ 编辑全站公告" : "📣 发布全站公告" }}</h3></template>
      <el-form :model="form" label-position="top">
        <el-form-item label="标题">
          <el-input v-model="form.title" maxlength="120" placeholder="公告标题" show-word-limit />
        </el-form-item>
        <el-form-item label="内容">
          <el-input v-model="form.content" type="textarea" :rows="4" maxlength="2000" placeholder="公告内容，所有用户都会在消息中心看到" show-word-limit />
        </el-form-item>
        <el-form-item label="级别">
          <el-radio-group v-model="form.level">
            <el-radio-button value="weak">弱（资讯）</el-radio-button>
            <el-radio-button value="normal">普通</el-radio-button>
            <el-radio-button value="strong">强（强提醒，跳静默时段）</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="附带链接（选填）">
          <el-input v-model="form.link" placeholder="例如 /forum/topic/123 或 https://..." />
        </el-form-item>
        <el-form-item label="发布者（展示名）">
          <el-input v-model="form.source" maxlength="40" placeholder="默认显示为 站务组" />
        </el-form-item>
        <el-form-item label="投放平台">
          <div class="target-picker">
            <el-checkbox v-model="targetAll" border>全部</el-checkbox>
            <el-checkbox-group v-model="form.targetClients" class="target-options" :disabled="targetAll">
              <el-checkbox-button v-for="item in targetOptions" :key="item.value" :label="item.value">
                {{ item.label }}
              </el-checkbox-button>
            </el-checkbox-group>
          </div>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="publishing" :disabled="publishing || !form.title.trim() || !form.content.trim()" @click="publish">
            {{ editingId ? "保存修改" : "发布公告" }}
          </el-button>
          <el-button v-if="editingId" :disabled="publishing" @click="resetForm">取消编辑</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card shadow="never">
      <template #header>
        <div class="hdr">
          <h3 style="margin:0;font-size:15px">📜 历史公告</h3>
          <el-button text :loading="loading" :disabled="loading" @click="reload">刷新</el-button>
        </div>
      </template>
      <el-alert
        v-if="loadError"
        type="error"
        :closable="false"
        show-icon
        class="pane-alert"
        :title="loadError"
      >
        <template #default>
          <el-button size="small" :loading="loading" @click="reload">重试</el-button>
        </template>
      </el-alert>
      <div v-loading="loading" class="ann-list">
        <el-empty v-if="!list.length" description="还没发布过公告" />
        <div v-for="a in list" :key="a.id" class="ann-row">
          <div class="ann-main">
            <div class="ann-title">
              <el-tag size="small" :type="a.level === 'strong' ? 'danger' : a.level === 'normal' ? 'primary' : 'info'" effect="plain">
                {{ a.level }}
              </el-tag>
              <el-tag v-if="targetLabel(a.targetClient) !== '全部'" size="small" effect="plain">
                {{ targetLabel(a.targetClient) }}
              </el-tag>
              {{ a.title }}
            </div>
            <div class="ann-content">{{ a.content }}</div>
            <div class="ann-meta">{{ fmtDate(a.createdAt) }} · {{ a.source || "站务组" }}</div>
          </div>
          <el-dropdown trigger="click" @command="handleAnnouncementCommand($event, a)">
            <el-button text size="small" class="action-trigger" :loading="isAnnouncementBusy(a)" :disabled="isAnnouncementBusy(a)">
              操作<el-icon class="more-icon"><MoreFilled /></el-icon>
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="edit" :disabled="isAnnouncementBusy(a)">编辑</el-dropdown-item>
                <el-dropdown-item command="delete" divided :disabled="isAnnouncementBusy(a)">删除</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { MoreFilled } from "@element-plus/icons-vue";
import { adminApi, type AnnouncementSyncStatus } from "@/api/admin";
import { ehallApi } from "@/api/ehall";
import { fmtDate } from "@/utils/format";
import { useRoute, useRouter } from "vue-router";

type AnnouncementTargetClient = "ios" | "android" | "harmony" | "web";

const targetOptions: Array<{ value: AnnouncementTargetClient; label: string }> = [
  { value: "ios", label: "iOS" },
  { value: "android", label: "安卓" },
  { value: "harmony", label: "鸿蒙" },
  { value: "web", label: "网页版" },
];
const targetLabelMap: Record<AnnouncementTargetClient, string> = {
  ios: "iOS",
  android: "安卓",
  harmony: "鸿蒙",
  web: "网页版",
};

const route = useRoute();
const router = useRouter();

const list = ref<any[]>([]);
const editingId = ref<number | null>(null);
const form = reactive({ title: "", content: "", level: "normal", link: "", source: "站务组", targetClients: [] as AnnouncementTargetClient[] });
const targetAll = ref(true);
const loading = ref(false);
const loadError = ref("");
const publishing = ref(false);
const announcementBusyId = ref<number | null>(null);
const syncStatus = ref<AnnouncementSyncStatus>({ enabled: false, authorized: false, sourceUsername: "", intervalMinutes: 15, count: 0 });
const syncEnabled = ref(false);
const syncInterval = ref(15);
const syncBusy = ref(false);
let announcementLoadSeq = 0;

onMounted(() => {
  void reload();
  void loadSyncStatus();
  if (route.query.announcementSync === "authorize") void resumeAnnouncementAuthorization();
});

function applySyncStatus(value: AnnouncementSyncStatus) {
  syncStatus.value = value;
  syncEnabled.value = value.enabled;
  syncInterval.value = value.intervalMinutes;
}

async function loadSyncStatus() {
  try { applySyncStatus(await adminApi.announcementSync({ suppressErrorMessage: true })); } catch { /* card keeps retry actions */ }
}

async function authorizeSync(options: { offerReconnect?: boolean } = {}) {
  syncBusy.value = true;
  try {
    applySyncStatus(await adminApi.authorizeAnnouncementSync());
    ElMessage.success("已授权并完成首次公告同步");
    return true;
  } catch (error) {
    const status = (error as { response?: { status?: number } })?.response?.status;
    const message = requestMessage(error) || "公告同步授权失败";
    if (status === 409 && options.offerReconnect !== false) {
      const reconnect = await ElMessageBox.confirm(
        `${message}。重新连接成功后会自动返回这里继续授权。`,
        "需要重新连接学校服务",
        { type: "warning", confirmButtonText: "去重新连接", cancelButtonText: "暂不处理" },
      ).then(() => true).catch(() => false);
      if (reconnect) {
        const redirect = "/admin?tab=announcements&announcementSync=authorize";
        await router.push({ name: "login", query: { reconnect: "ehall", redirect } });
      }
    } else {
      ElMessage.error(message);
    }
    return false;
  } finally { syncBusy.value = false; }
}

async function resumeAnnouncementAuthorization() {
  syncBusy.value = true;
  try {
    for (let attempt = 0; attempt < 25; attempt += 1) {
      const status = await ehallApi.status({
        suppressAuthRedirect: true,
        suppressAuthMessage: true,
        suppressErrorMessage: true,
      }).catch(() => ({ active: false, connecting: false }));
      if (status.active) break;
      if (!status.connecting && attempt >= 3) break;
      await new Promise((resolve) => window.setTimeout(resolve, 1000));
    }
  } finally {
    syncBusy.value = false;
  }
  const authorized = await authorizeSync({ offerReconnect: false });
  if (!authorized) ElMessage.warning("学校服务仍未连接成功，请稍后再次点击“用当前账号授权”");
  const nextQuery = { ...route.query };
  delete nextQuery.announcementSync;
  await router.replace({ query: nextQuery });
}

async function runSync() {
  syncBusy.value = true;
  try {
    const result = await adminApi.runAnnouncementSync();
    applySyncStatus(result.status);
    ElMessage.success(`同步完成，本次读取 ${result.synced} 条`);
  } catch (error) {
    ElMessage.error(requestMessage(error) || "公告同步失败");
  } finally { syncBusy.value = false; }
}

async function saveSyncConfig() {
  if (!syncStatus.value.authorized) return;
  syncBusy.value = true;
  try {
    applySyncStatus(await adminApi.updateAnnouncementSync({ enabled: syncEnabled.value, intervalMinutes: syncInterval.value }));
    ElMessage.success("同步设置已保存");
  } finally { syncBusy.value = false; }
}

async function clearSyncAuthorization() {
  const confirmed = await ElMessageBox.confirm("取消后后台将停止读取融合门户；已保存的公告不会删除。", "取消公告同步授权", { type: "warning" })
    .then(() => true).catch(() => false);
  if (!confirmed) return;
  syncBusy.value = true;
  try {
    applySyncStatus(await adminApi.clearAnnouncementSyncAuthorization());
    ElMessage.success("公告同步授权已取消");
  } finally { syncBusy.value = false; }
}
async function reload() {
  const seq = ++announcementLoadSeq;
  loading.value = true;
  loadError.value = "";
  try {
    const next = await adminApi.announcements({ suppressErrorMessage: true });
    if (seq === announcementLoadSeq) list.value = next;
  } catch (error) {
    if (seq === announcementLoadSeq) {
      list.value = [];
      loadError.value = requestMessage(error) || "历史公告加载失败，请稍后重试";
    }
  } finally {
    if (seq === announcementLoadSeq) loading.value = false;
  }
}

function requestMessage(error: unknown) {
  if (typeof error !== "object" || error === null) return "";
  const responseMessage = (error as { response?: { data?: { message?: unknown } } }).response?.data?.message;
  if (typeof responseMessage === "string") return responseMessage;
  return error instanceof Error ? error.message : "";
}

function isAnnouncementTargetClient(value: string): value is AnnouncementTargetClient {
  return targetOptions.some((item) => item.value === value);
}

function parseTargetClients(value?: string | AnnouncementTargetClient[] | null): AnnouncementTargetClient[] {
  const raw = Array.isArray(value) ? value : String(value || "").split(",");
  const selected = new Set(
    raw
      .map((item) => item.trim().toLowerCase())
      .filter(isAnnouncementTargetClient),
  );
  return targetOptions.map((item) => item.value).filter((value) => selected.has(value));
}

function targetLabel(value?: string | AnnouncementTargetClient[] | null) {
  const clients = parseTargetClients(value);
  if (!clients.length || clients.length === targetOptions.length) return "全部";
  return clients.map((client) => targetLabelMap[client]).join("、");
}

function selectedTargetPayload(): "all" | AnnouncementTargetClient[] {
  if (targetAll.value) return "all";
  return parseTargetClients(form.targetClients);
}

function validateTargetSelection() {
  if (targetAll.value) return true;
  if (parseTargetClients(form.targetClients).length) return true;
  ElMessage.warning("请选择至少一个投放平台，或勾选全部");
  return false;
}

async function publish() {
  if (publishing.value) return;
  if (!form.title.trim() || !form.content.trim()) {
    ElMessage.warning("请填写公告标题和内容");
    return;
  }
  if (!validateTargetSelection()) return;
  publishing.value = true;
  try {
    const targetClient = selectedTargetPayload();
    if (editingId.value) {
      await adminApi.updateAnnouncement(editingId.value, {
        title: form.title.trim(),
        content: form.content.trim(),
        level: form.level,
        link: form.link.trim() || null,
        source: form.source.trim() || "站务组",
        targetClient,
      });
      ElMessage.success("公告已更新");
    } else {
      await adminApi.createAnnouncement({
        title: form.title.trim(),
        content: form.content.trim(),
        level: form.level,
        link: form.link.trim() || undefined,
        source: form.source.trim() || "站务组",
        targetClient,
      });
      ElMessage.success("公告已发布");
    }
    resetForm();
    await reload();
  } finally { publishing.value = false; }
}

function handleAnnouncementCommand(command: string, row: any) {
  if (announcementBusyId.value !== null) return;
  if (command === "edit") return startEdit(row);
  if (command === "delete") return removeAnn(row);
}

function isAnnouncementBusy(row: any) {
  return announcementBusyId.value === row.id;
}

function startEdit(row: any) {
  editingId.value = row.id;
  form.title = row.title || "";
  form.content = row.content || "";
  form.level = row.level || "normal";
  form.link = row.link || "";
  form.source = row.source || "站务组";
  form.targetClients = parseTargetClients(row.targetClient);
  targetAll.value = !form.targetClients.length;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function resetForm() {
  editingId.value = null;
  form.title = "";
  form.content = "";
  form.level = "normal";
  form.link = "";
  form.source = "站务组";
  form.targetClients = [];
  targetAll.value = true;
}

async function removeAnn(a: any) {
  if (announcementBusyId.value !== null) return;
  announcementBusyId.value = a.id;
  try {
    const confirmed = await ElMessageBox.confirm(`删除公告《${a.title}》？`, "确认", { type: "warning" })
      .then(() => true)
      .catch(() => false);
    if (!confirmed) return;
    await adminApi.deleteAnnouncement(a.id);
    ElMessage.success("已删除");
    if (editingId.value === a.id) resetForm();
    await reload();
  } finally {
    announcementBusyId.value = null;
  }
}
</script>

<style scoped>
.ann-pane { display: flex; flex-direction: column; gap: 14px; }
.composer .el-card__header { padding-bottom: 0; }
.sync-desc { margin: 0 0 12px; color: #64748b; font-size: 13px; line-height: 1.7; }
.sync-meta, .sync-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.sync-meta { margin-bottom: 14px; color: #64748b; font-size: 12px; }
.sync-error { width: 100%; color: #dc2626; }
.interval-unit { margin-left: -6px; color: #64748b; font-size: 12px; }
.hdr { display: flex; justify-content: space-between; align-items: center; }
.pane-alert {
  margin-bottom: 12px;
}
.pane-alert :deep(.el-alert__content) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
}
.ann-list { min-height: 80px; }
.ann-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 10px 0;
  border-bottom: 1px dashed #f1f5f9;
}
.ann-row:last-child { border-bottom: none; }
.ann-main { flex: 1; min-width: 0; }
.ann-title { font-size: 14px; font-weight: 600; color: #1f2937; display: flex; gap: 6px; align-items: center; }
.ann-content { font-size: 13px; color: #4b5563; margin: 4px 0 4px; }
.ann-meta { font-size: 11px; color: #9ca3af; }
.action-trigger { justify-content: center; }
.more-icon { margin-left: 2px; transform: rotate(90deg); }
.target-picker {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.target-options {
  display: flex;
  flex-wrap: wrap;
  gap: 0;
}

@media (max-width: 768px) {
  .ann-pane :deep(.el-card__body) {
    padding: 12px;
  }
  .ann-pane :deep(.el-radio-group),
  .target-picker,
  .target-options {
    display: grid;
    width: 100%;
    gap: 8px;
  }
  .ann-pane :deep(.el-radio-button__inner),
  .target-options :deep(.el-checkbox-button__inner),
  .target-picker :deep(.el-checkbox) {
    width: 100%;
    border-left: var(--el-border);
    border-radius: var(--el-border-radius-base);
  }
  .target-picker :deep(.el-checkbox) {
    margin-right: 0;
  }
  .ann-pane :deep(.el-form-item:last-child .el-button) {
    width: 100%;
  }
  .ann-row {
    gap: 10px;
    flex-direction: column;
  }
  .ann-title {
    align-items: flex-start;
    line-height: 1.5;
  }
  .ann-row :deep(.el-dropdown) {
    width: 100%;
  }
  .action-trigger {
    width: 100%;
  }
}
</style>
