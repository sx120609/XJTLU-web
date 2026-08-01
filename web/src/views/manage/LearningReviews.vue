<template>
  <section class="page-card">
    <header class="page-head"><div><h1>学习资料人工审核</h1><p>核验版权承诺、内容质量、文件安全与真实试读范围后，才允许公开上架。</p></div><div class="head-actions"><el-select v-model="status" @change="load"><el-option label="待审核" value="submitted" /><el-option label="审核中" value="reviewing" /><el-option label="已通过" value="approved" /><el-option label="已驳回" value="rejected" /></el-select><el-button :loading="loading" @click="load">刷新</el-button></div></header>
    <el-table :data="rows" v-loading="loading" stripe>
      <el-table-column label="资料" min-width="270"><template #default="{ row }"><div class="material-cell"><b>{{ row.version.profile.item.title }}</b><span>#{{ row.id }} · 第 {{ row.round }} 轮 · {{ row.version.profile.type?.name || "未分类" }}</span></div></template></el-table-column>
      <el-table-column label="提交人" width="180"><template #default="{ row }"><div class="material-cell"><b>{{ row.submittedBy.nickname }}</b><span>@{{ row.submittedBy.username }}</span></div></template></el-table-column>
      <el-table-column label="交付文件" min-width="270"><template #default="{ row }"><div class="files"><div v-for="file in row.version.files" :key="file.id"><b>{{ file.originalName }}</b><span>{{ file.format }} · {{ file.pageCount || "?" }} 页 · 试读 {{ file.previewEnabled ? `${file.previewPageStart}-${file.previewPageEnd}` : "未开启" }}</span></div></div></template></el-table-column>
      <el-table-column label="提交时间" width="165"><template #default="{ row }"><span class="muted">{{ formatDate(row.submittedAt) }}</span></template></el-table-column>
      <el-table-column label="操作" width="120" fixed="right"><template #default="{ row }"><el-button v-if="pending(row.status)" type="primary" text @click="openReview(row)">开始复核</el-button><el-tag v-else :type="row.status === 'approved' ? 'success' : 'danger'" effect="plain">{{ row.status === "approved" ? "已通过" : "已驳回" }}</el-tag></template></el-table-column>
    </el-table>
    <el-empty v-if="!loading && !rows.length" description="当前没有对应状态的学习资料" />
  </section>

  <el-dialog v-model="dialogOpen" :title="`人工复核 · ${selected?.version.profile.item.title || ''}`" width="620px" destroy-on-close>
    <el-alert type="warning" :closable="false" show-icon title="请实际检查资料和试读文件后逐项确认，不要仅依据卖家描述。" />
    <el-checkbox v-model="checklist.rights" class="check-row"><b>版权与授权</b><span>原创声明、转载授权、肖像与隐私处理符合要求</span></el-checkbox>
    <el-checkbox v-model="checklist.quality" class="check-row"><b>内容质量</b><span>标题、课程信息、页数、版本和实际文件内容一致</span></el-checkbox>
    <el-checkbox v-model="checklist.fileSafety" class="check-row"><b>文件安全</b><span>文件可打开、无恶意内容，试读范围真实有效</span></el-checkbox>
    <el-input v-model="reason" type="textarea" :rows="4" maxlength="500" show-word-limit placeholder="填写审核说明；驳回时必须给出修改原因" />
    <template #footer><el-button @click="dialogOpen = false">取消</el-button><el-button type="danger" plain :loading="saving" @click="submit(false)">驳回修改</el-button><el-button type="success" :disabled="!allChecked" :loading="saving" @click="submit(true)">确认通过</el-button></template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { managementApi, type ManagementLearningReviewRow } from "@/api/management";
const rows = ref<ManagementLearningReviewRow[]>([]); const status = ref("submitted"); const loading = ref(false); const saving = ref(false); const dialogOpen = ref(false); const selected = ref<ManagementLearningReviewRow | null>(null); const reason = ref(""); const checklist = reactive({ rights: false, quality: false, fileSafety: false }); const allChecked = computed(() => checklist.rights && checklist.quality && checklist.fileSafety);
onMounted(load);
async function load() { loading.value = true; try { rows.value = await managementApi.learningReviews(status.value); } finally { loading.value = false; } }
function openReview(row: ManagementLearningReviewRow) { selected.value = row; reason.value = ""; Object.assign(checklist, { rights: false, quality: false, fileSafety: false }); dialogOpen.value = true; }
async function submit(approved: boolean) { if (!selected.value) return; if (approved && !allChecked.value) return ElMessage.warning("通过前必须完成三项检查"); if (!approved && reason.value.trim().length < 2) return ElMessage.warning("驳回时请填写修改原因"); saving.value = true; try { await managementApi.decideLearningReview(selected.value.id, { action: approved ? "approve" : "reject", reason: reason.value.trim(), checklist: { ...checklist } }); dialogOpen.value = false; ElMessage.success(approved ? "学习资料已通过并上架" : "学习资料已驳回修改"); await load(); } finally { saving.value = false; } }
function pending(value: string) { return value === "submitted" || value === "reviewing"; } function formatDate(value: string) { return new Date(value).toLocaleString("zh-CN", { hour12: false }); }
</script>

<style scoped>
.page-card { border: 1px solid #e3e8f1; border-radius: 16px; background: white; overflow: hidden; }.page-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 22px 24px; }.page-head h1 { margin: 0; font-size: 20px; }.page-head p { margin: 6px 0 0; color: #64748b; font-size: 12px; }.head-actions { display: flex; gap: 8px; }.head-actions :deep(.el-select) { width: 130px; }.material-cell,.files > div { display: grid; gap: 3px; }.material-cell span,.files span,.muted { color: #94a3b8; font-size: 11px; }.files { display: grid; gap: 7px; }.files b { font-size: 12px; }.check-row { width: 100%; height: auto; margin: 16px 0 0; padding: 13px; align-items: flex-start; border: 1px solid #e5e9f1; border-radius: 10px; }.check-row :deep(.el-checkbox__label) { display: grid; gap: 3px; white-space: normal; }.check-row span { color: #64748b; font-size: 11px; line-height: 1.5; }.page-card :deep(.el-alert) { margin-bottom: 8px; }
@media (max-width: 680px) { .page-head { align-items: flex-start; padding: 18px; }.head-actions { flex-direction: column; } }
</style>
