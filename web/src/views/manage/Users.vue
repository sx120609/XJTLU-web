<template>
  <section class="page-card">
    <header class="page-head">
      <div><h1>个人用户治理</h1><p>这里只管理个人用户状态；管理账号不会混入此列表。</p></div>
      <el-button :loading="loading" @click="load">刷新</el-button>
    </header>
    <div class="filters">
      <el-input v-model="q" clearable placeholder="搜索用户名或昵称" @keyup.enter="search" />
      <el-select v-model="status" clearable placeholder="全部状态" @change="search"><el-option label="正常" value="active" /><el-option label="封禁" value="banned" /><el-option label="禁言" value="muted" /></el-select>
      <el-button type="primary" @click="search">查询</el-button>
    </div>
    <el-table :data="rows" v-loading="loading" stripe>
      <el-table-column prop="id" label="ID" width="72" />
      <el-table-column label="个人用户" min-width="210"><template #default="{ row }"><div class="user-cell"><b>{{ row.nickname || "未设置昵称" }}</b><span>@{{ row.username }}</span></div></template></el-table-column>
      <el-table-column label="状态" width="130"><template #default="{ row }"><div class="tag-line"><el-tag :type="statusType(row.status)" effect="plain">{{ statusLabel(row.status) }}</el-tag><el-tag v-if="row.studentSso" size="small" effect="plain">SSO</el-tag></div></template></el-table-column>
      <el-table-column label="内容" width="125"><template #default="{ row }"><span>{{ row.postCount }} 帖 / {{ row.replyCount }} 回</span></template></el-table-column>
      <el-table-column label="信任" width="145"><template #default="{ row }"><div class="trust-cell"><span>信誉 {{ row.reputation }}</span><el-tag v-if="row.aiReviewWhitelisted" type="success" size="small" effect="plain">AI 白名单</el-tag></div></template></el-table-column>
      <el-table-column label="最后登录" width="165"><template #default="{ row }"><span class="muted">{{ row.lastLoginAt ? formatDate(row.lastLoginAt) : "从未登录" }}</span></template></el-table-column>
      <el-table-column label="操作" width="120" fixed="right">
        <template #default="{ row }"><el-dropdown @command="handleCommand($event, row)"><el-button text type="primary">治理 ▾</el-button><template #dropdown><el-dropdown-menu>
          <el-dropdown-item v-if="canModerate" command="rename">修改昵称</el-dropdown-item>
          <el-dropdown-item v-if="canModerate && row.status !== 'banned'" command="ban">封禁</el-dropdown-item>
          <el-dropdown-item v-if="canModerate && row.status === 'banned'" command="unban">解除封禁</el-dropdown-item>
          <el-dropdown-item v-if="canModerate && row.status !== 'muted'" command="mute">禁言 24 小时</el-dropdown-item>
          <el-dropdown-item v-if="canModerate && row.status === 'muted'" command="unmute">解除禁言</el-dropdown-item>
          <el-dropdown-item v-if="canSensitive" command="whitelist" divided>{{ row.aiReviewWhitelisted ? "取消 AI 白名单" : "加入 AI 白名单" }}</el-dropdown-item>
          <el-dropdown-item v-if="canSensitive && !row.studentSso" command="password">重置密码</el-dropdown-item>
        </el-dropdown-menu></template></el-dropdown></template>
      </el-table-column>
    </el-table>
    <el-empty v-if="!loading && !rows.length" description="没有符合条件的个人用户" />
    <el-pagination v-if="total > size" v-model:current-page="page" :page-size="size" :total="total" layout="prev, pager, next, total" class="pager" @current-change="load" />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { managementApi, type ManagementUserRow } from "@/api/management";
import { useManagementStore } from "@/stores/management";

const management = useManagementStore();
const rows = ref<ManagementUserRow[]>([]);
const q = ref("");
const status = ref("");
const page = ref(1);
const size = 30;
const total = ref(0);
const loading = ref(false);
const canModerate = computed(() => management.hasPermission("users.moderate"));
const canSensitive = computed(() => management.hasPermission("users.sensitive"));

onMounted(load);
async function load() {
  loading.value = true;
  try {
    const result = await managementApi.users({ q: q.value, status: status.value || undefined, page: page.value, size });
    rows.value = result.list;
    total.value = result.total;
  } finally { loading.value = false; }
}
function search() { page.value = 1; void load(); }
async function handleCommand(command: string, row: ManagementUserRow) {
  let patch: Record<string, unknown> | null = null;
  if (command === "rename") {
    const result = await ElMessageBox.prompt("请输入新的个人用户昵称", "修改昵称", { inputValue: row.nickname, inputValidator: (value) => Boolean(value.trim()) || "昵称不能为空" });
    patch = { nickname: result.value.trim() };
  } else if (command === "ban" || command === "unban") {
    await ElMessageBox.confirm(`${command === "ban" ? "封禁" : "解除封禁"}个人用户 ${row.nickname}？`, "用户治理", { type: "warning" });
    patch = { status: command === "ban" ? "banned" : "active", mutedUntil: null };
  } else if (command === "mute") {
    await ElMessageBox.confirm(`禁言 ${row.nickname} 24 小时？`, "用户治理", { type: "warning" });
    patch = { status: "muted", mutedUntil: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() };
  } else if (command === "unmute") {
    patch = { status: "active", mutedUntil: null };
  } else if (command === "whitelist") {
    await ElMessageBox.confirm(`${row.aiReviewWhitelisted ? "取消" : "加入"} AI 审核白名单？`, "敏感操作", { type: "warning" });
    patch = { aiReviewWhitelisted: !row.aiReviewWhitelisted };
  } else if (command === "password") {
    const result = await ElMessageBox.prompt("请输入个人用户的新密码（至少 6 位）", "重置密码", { inputType: "password", inputValidator: (value) => value.length >= 6 || "密码至少 6 位" });
    await managementApi.resetUserPassword(row.id, result.value);
    ElMessage.success("密码已重置");
    return;
  }
  if (!patch) return;
  await managementApi.updateUser(row.id, patch);
  ElMessage.success("用户状态已更新");
  await load();
}
function statusLabel(value: string) { return ({ active: "正常", banned: "已封禁", muted: "禁言中" } as Record<string, string>)[value] || value; }
function statusType(value: string) { return value === "active" ? "success" : value === "banned" ? "danger" : "warning"; }
function formatDate(value: string) { return new Date(value).toLocaleString("zh-CN", { hour12: false }); }
</script>

<style scoped>
.page-card { border: 1px solid #e3e8f1; border-radius: 16px; background: white; overflow: hidden; }.page-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 22px 24px; }.page-head h1 { margin: 0; font-size: 20px; }.page-head p { margin: 6px 0 0; color: #64748b; font-size: 12px; }.filters { display: grid; grid-template-columns: minmax(220px, 360px) 160px auto; gap: 10px; padding: 0 24px 20px; }.user-cell,.trust-cell { display: grid; gap: 4px; align-items: start; }.user-cell span,.muted { color: #94a3b8; font-size: 11px; }.tag-line { display: flex; gap: 5px; align-items: center; }.trust-cell :deep(.el-tag) { width: fit-content; }.pager { justify-content: flex-end; padding: 18px 24px; }
@media (max-width: 700px) { .page-head { align-items: flex-start; padding: 18px; }.filters { grid-template-columns: 1fr; padding: 0 18px 18px; } }
</style>
