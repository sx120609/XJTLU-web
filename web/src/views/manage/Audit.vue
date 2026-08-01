<template>
  <section class="page-card">
    <header class="page-head"><div><h1>管理审计日志</h1><p>追踪管理账号的关键写操作、对象和来源 IP。</p></div><el-button :loading="loading" @click="load">刷新</el-button></header>
    <el-table :data="rows" v-loading="loading" stripe>
      <el-table-column label="时间" width="175"><template #default="{ row }"><span class="muted">{{ formatDate(row.createdAt) }}</span></template></el-table-column>
      <el-table-column label="操作人" width="180"><template #default="{ row }"><div class="actor"><b>{{ row.actor?.displayName || "账号已删除" }}</b><span v-if="row.actor">@{{ row.actor.username }}</span></div></template></el-table-column>
      <el-table-column label="动作" min-width="230"><template #default="{ row }"><div class="action"><b>{{ row.summary }}</b><code>{{ row.action }}</code></div></template></el-table-column>
      <el-table-column label="对象" width="170"><template #default="{ row }"><span>{{ row.targetType }} #{{ row.targetId || "-" }}</span></template></el-table-column>
      <el-table-column prop="ip" label="来源 IP" width="150" />
      <el-table-column type="expand"><template #default="{ row }"><pre>{{ prettyDetail(row.detail) }}</pre></template></el-table-column>
    </el-table>
    <el-pagination v-if="total > size" v-model:current-page="page" :page-size="size" :total="total" layout="prev, pager, next, total" class="pager" @current-change="load" />
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { managementApi, type ManagementAuditRow } from "@/api/management";
const rows = ref<ManagementAuditRow[]>([]);
const loading = ref(false);
const page = ref(1);
const size = 30;
const total = ref(0);
onMounted(load);
async function load() { loading.value = true; try { const result = await managementApi.audit({ page: page.value, size }); rows.value = result.list; total.value = result.total; } finally { loading.value = false; } }
function prettyDetail(value: string) { try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return value; } }
function formatDate(value: string) { return new Date(value).toLocaleString("zh-CN", { hour12: false }); }
</script>

<style scoped>
.page-card { border: 1px solid #e3e8f1; border-radius: 16px; background: white; overflow: hidden; }.page-head { display: flex; align-items: center; justify-content: space-between; padding: 22px 24px; }.page-head h1 { margin: 0; font-size: 20px; }.page-head p { margin: 6px 0 0; color: #64748b; font-size: 12px; }.actor,.action { display: grid; gap: 3px; }.actor span,.muted { color: #94a3b8; font-size: 11px; }.action code { color: #6d5ce7; font-size: 10px; }.page-card pre { margin: 0; padding: 12px 40px 18px; color: #475569; white-space: pre-wrap; word-break: break-all; }.pager { justify-content: flex-end; padding: 18px 24px; }
</style>
