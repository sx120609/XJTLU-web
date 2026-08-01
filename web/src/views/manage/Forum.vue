<template>
  <section class="page-card">
    <header class="page-head">
      <div><h1>帖子审核</h1><p>帖子先走 AI；正常内容自动发布，问题或高风险内容进入这里人工复核。</p></div>
      <el-button :loading="loading" @click="load">刷新队列</el-button>
    </header>
    <div class="filters">
      <el-input v-model="q" clearable placeholder="搜索标题或正文" @keyup.enter="search" />
      <el-select v-model="reviewStatus" @change="search">
        <el-option label="待人工审核" value="manual_requested" />
        <el-option label="人工审核中" value="manual_reviewing" />
        <el-option label="AI 已拦截" value="blocked_ai" />
        <el-option label="人工已通过" value="approved_manual" />
        <el-option label="人工已驳回" value="rejected_manual" />
        <el-option label="全部状态" value="" />
      </el-select>
      <el-button type="primary" @click="search">查询</el-button>
    </div>

    <el-table :data="rows" v-loading="loading" stripe row-key="id">
      <el-table-column type="expand">
        <template #default="{ row }">
          <div class="review-detail">
            <div><b>正文</b><p>{{ row.content }}</p></div>
            <div><b>AI 判断</b><p>{{ row.aiReviewReason || "未提供原因" }}</p></div>
          </div>
        </template>
      </el-table-column>
      <el-table-column prop="id" label="ID" width="70" />
      <el-table-column label="帖子" min-width="300">
        <template #default="{ row }"><div class="topic-cell"><a :href="`/forum/topic/${row.id}`" target="_blank" rel="noopener noreferrer">{{ row.title }}</a><span>{{ row.board?.name || "-" }} · {{ row.author?.nickname || "未知用户" }} @{{ row.author?.username || "-" }}</span></div></template>
      </el-table-column>
      <el-table-column label="AI 风险" width="130">
        <template #default="{ row }"><div class="risk-cell"><el-tag :type="riskType(row.aiRiskLevel)" effect="plain">{{ riskLabel(row.aiRiskLevel) }}</el-tag><span v-if="row.aiRiskScore !== null && row.aiRiskScore !== undefined">{{ row.aiRiskScore }} 分</span></div></template>
      </el-table-column>
      <el-table-column label="状态" width="140"><template #default="{ row }"><el-tag :type="reviewType(row.aiReviewStatus)" effect="plain">{{ reviewLabel(row.aiReviewStatus) }}</el-tag></template></el-table-column>
      <el-table-column label="提交时间" width="165"><template #default="{ row }"><span class="muted">{{ formatDate(row.createdAt) }}</span></template></el-table-column>
      <el-table-column label="操作" width="210" fixed="right">
        <template #default="{ row }">
          <div class="actions">
            <template v-if="canReview && pending(row.aiReviewStatus)">
              <el-button type="success" size="small" :loading="busyId === row.id" @click="review(row, true)">通过</el-button>
              <el-button type="danger" plain size="small" :loading="busyId === row.id" @click="review(row, false)">驳回</el-button>
            </template>
            <el-button v-if="canModerate" text size="small" :loading="busyId === row.id" @click="toggleHidden(row)">{{ row.hidden ? "恢复" : "隐藏" }}</el-button>
          </div>
        </template>
      </el-table-column>
    </el-table>
    <el-empty v-if="!loading && !rows.length" description="当前没有符合条件的帖子" />
    <el-pagination v-if="total > size" v-model:current-page="page" :page-size="size" :total="total" layout="prev, pager, next, total" class="pager" @current-change="load" />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { managementApi, type ManagementTopicRow } from "@/api/management";
import { useManagementStore } from "@/stores/management";

const management = useManagementStore();
const rows = ref<ManagementTopicRow[]>([]);
const q = ref("");
const reviewStatus = ref("manual_requested");
const page = ref(1);
const size = 20;
const total = ref(0);
const loading = ref(false);
const busyId = ref<number | null>(null);
const canReview = computed(() => management.hasPermission("forum.review"));
const canModerate = computed(() => management.hasPermission("forum.moderate"));

onMounted(load);
async function load() {
  loading.value = true;
  try {
    const result = await managementApi.topics({ q: q.value, reviewStatus: reviewStatus.value || undefined, page: page.value, size });
    rows.value = result.list;
    total.value = result.total;
  } finally { loading.value = false; }
}
function search() { page.value = 1; void load(); }
async function review(row: ManagementTopicRow, approved: boolean) {
  const prompt = await ElMessageBox.prompt(
    approved ? "可填写通过说明（选填）" : "请填写驳回原因，该原因会通知发帖用户",
    approved ? "人工审核通过" : "人工审核驳回",
    { inputType: "textarea", inputValidator: (value) => approved || Boolean(value.trim()) || "驳回原因不能为空" },
  );
  busyId.value = row.id;
  try {
    await managementApi.updateTopic(row.id, { aiReviewStatus: approved ? "approved_manual" : "rejected_manual", manualReviewNote: prompt.value.trim() });
    ElMessage.success(approved ? "帖子已通过并发布" : "帖子已驳回并保持隐藏");
    await load();
  } finally { busyId.value = null; }
}
async function toggleHidden(row: ManagementTopicRow) {
  await ElMessageBox.confirm(`${row.hidden ? "恢复" : "隐藏"}帖子《${row.title}》？`, "帖子治理", { type: "warning" });
  busyId.value = row.id;
  try {
    await managementApi.updateTopic(row.id, { hidden: !row.hidden });
    ElMessage.success("帖子状态已更新");
    await load();
  } finally { busyId.value = null; }
}
function pending(status: string) { return status === "manual_requested" || status === "manual_reviewing"; }
function reviewLabel(status: string) { return ({ manual_requested: "待人工审核", manual_reviewing: "审核中", approved_manual: "人工通过", rejected_manual: "人工驳回", blocked_ai: "AI 拦截", auto_passed: "AI 通过" } as Record<string, string>)[status] || status; }
function reviewType(status: string) { return status === "approved_manual" || status === "auto_passed" ? "success" : status === "rejected_manual" || status === "blocked_ai" ? "danger" : "warning"; }
function riskLabel(level?: string | null) { return ({ low: "低风险", medium: "中风险", high: "高风险" } as Record<string, string>)[level || ""] || "未分级"; }
function riskType(level?: string | null) { return level === "high" ? "danger" : level === "medium" ? "warning" : "success"; }
function formatDate(value: string) { return new Date(value).toLocaleString("zh-CN", { hour12: false }); }
</script>

<style scoped>
.page-card { border: 1px solid #e3e8f1; border-radius: 16px; background: white; overflow: hidden; }.page-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 22px 24px; }.page-head h1 { margin: 0; font-size: 20px; }.page-head p { margin: 6px 0 0; color: #64748b; font-size: 12px; }.filters { display: grid; grid-template-columns: minmax(220px, 360px) 180px auto; gap: 10px; padding: 0 24px 20px; }.topic-cell { display: grid; gap: 5px; }.topic-cell a { color: #26324a; font-weight: 650; text-decoration: none; }.topic-cell a:hover { color: #6d5ce7; }.topic-cell span,.muted { color: #94a3b8; font-size: 11px; }.risk-cell { display: flex; gap: 6px; align-items: center; }.risk-cell span { color: #64748b; font-size: 11px; }.actions { display: flex; align-items: center; }.review-detail { display: grid; grid-template-columns: 1.4fr .6fr; gap: 24px; padding: 5px 40px 18px; }.review-detail b { color: #475569; font-size: 12px; }.review-detail p { margin: 6px 0 0; color: #334155; line-height: 1.7; white-space: pre-wrap; }.pager { justify-content: flex-end; padding: 18px 24px; }
@media (max-width: 700px) { .page-head { align-items: flex-start; padding: 18px; }.filters { grid-template-columns: 1fr; padding: 0 18px 18px; }.review-detail { grid-template-columns: 1fr; padding-inline: 16px; } }
</style>
