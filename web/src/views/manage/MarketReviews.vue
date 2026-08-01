<template>
  <section class="page-card">
    <header class="page-head"><div><h1>实物商品人工审核</h1><p>所有实物商品（包括纸质学习资料）提交后先进入人工审核，不调用 AI 自动放行。</p></div><el-button :loading="loading" @click="load">刷新队列</el-button></header>
    <div class="filters"><el-input v-model="q" clearable placeholder="搜索商品、描述或卖家" @keyup.enter="search" /><el-button type="primary" @click="search">查询</el-button></div>
    <div v-loading="loading" class="review-list">
      <article v-for="row in rows" :key="row.id" class="review-card">
        <div class="cover"><img v-if="row.cover" :src="row.cover" alt="" /><span v-else>暂无图片</span></div>
        <div class="item-main">
          <div class="item-head"><div><h2>{{ row.title }}</h2><p>#{{ row.id }} · {{ row.category }} · {{ row.condition }}</p></div><strong>¥{{ Number(row.price).toFixed(2) }}</strong></div>
          <p class="description">{{ row.description }}</p>
          <div class="meta"><span>卖家：{{ row.seller?.nickname || "未知" }} @{{ row.seller?.username || "-" }}</span><span>{{ row.campus || "未填写校区" }} {{ row.location }}</span><span>{{ formatDate(row.createdAt) }}</span></div>
        </div>
        <div class="actions"><el-button type="success" :loading="busyId === row.id" @click="decide(row, true)">审核通过</el-button><el-button type="danger" plain :loading="busyId === row.id" @click="decide(row, false)">驳回</el-button></div>
      </article>
      <el-empty v-if="!loading && !rows.length" description="当前没有待审核的实物商品" />
    </div>
    <el-pagination v-if="total > size" v-model:current-page="page" :page-size="size" :total="total" layout="prev, pager, next, total" class="pager" @current-change="load" />
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { managementApi, type ManagementMarketReviewRow } from "@/api/management";
const rows = ref<ManagementMarketReviewRow[]>([]); const q = ref(""); const page = ref(1); const size = 30; const total = ref(0); const loading = ref(false); const busyId = ref<number | null>(null);
onMounted(load);
async function load() { loading.value = true; try { const result = await managementApi.marketReviews({ q: q.value, page: page.value, size }); rows.value = result.list; total.value = result.total; } finally { loading.value = false; } }
function search() { page.value = 1; void load(); }
async function decide(row: ManagementMarketReviewRow, approved: boolean) {
  const result = await ElMessageBox.prompt(approved ? "可填写审核说明（选填）" : "请填写明确的驳回原因，该原因会通知卖家", approved ? "批准商品上架" : "驳回商品", { inputType: "textarea", inputValidator: (value) => approved || value.trim().length >= 2 || "驳回原因至少 2 个字" });
  busyId.value = row.id;
  try { await managementApi.decideMarketReview(row.id, { decision: approved ? "approve" : "reject", note: result.value.trim() }); ElMessage.success(approved ? "商品已公开上架" : "商品已驳回"); await load(); } finally { busyId.value = null; }
}
function formatDate(value: string) { return new Date(value).toLocaleString("zh-CN", { hour12: false }); }
</script>

<style scoped>
.page-card { border: 1px solid #e3e8f1; border-radius: 16px; background: white; overflow: hidden; }.page-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 22px 24px; }.page-head h1 { margin: 0; font-size: 20px; }.page-head p { margin: 6px 0 0; color: #64748b; font-size: 12px; }.filters { display: grid; grid-template-columns: minmax(220px, 420px) auto; gap: 10px; padding: 0 24px 20px; }.review-list { min-height: 160px; padding: 0 24px 8px; }.review-card { display: grid; grid-template-columns: 108px minmax(0, 1fr) auto; gap: 18px; align-items: center; padding: 18px 0; border-top: 1px solid #edf0f5; }.cover { width: 108px; height: 86px; display: grid; place-items: center; overflow: hidden; border-radius: 10px; background: #f1f5f9; color: #94a3b8; font-size: 11px; }.cover img { width: 100%; height: 100%; object-fit: cover; }.item-head { display: flex; justify-content: space-between; gap: 16px; }.item-head h2 { margin: 0; font-size: 16px; }.item-head p { margin: 5px 0 0; color: #94a3b8; font-size: 11px; }.item-head strong { color: #e05252; }.description { margin: 10px 0; color: #475569; font-size: 13px; line-height: 1.6; }.meta { display: flex; flex-wrap: wrap; gap: 12px; color: #94a3b8; font-size: 11px; }.actions { display: grid; gap: 8px; }.actions :deep(.el-button + .el-button) { margin-left: 0; }.pager { justify-content: flex-end; padding: 18px 24px; }
@media (max-width: 760px) { .page-head { align-items: flex-start; padding: 18px; }.filters { grid-template-columns: 1fr; padding: 0 18px 18px; }.review-list { padding-inline: 18px; }.review-card { grid-template-columns: 78px minmax(0,1fr); }.cover { width: 78px; height: 78px; }.actions { grid-column: 1 / -1; grid-template-columns: 1fr 1fr; } }
</style>
