<template>
  <div class="operations-page">
    <div class="page-heading">
      <div><p class="eyebrow">PLATFORM OPERATIONS</p><h1>内容与系统</h1><p>板块、站点配置和运行状态现在由独立管理身份操作，所有写入都会记录审计日志。</p></div>
      <el-button :loading="loading" @click="refresh">刷新</el-button>
    </div>

    <el-alert v-if="!canContent && !canSystem" type="warning" :closable="false" title="当前账号没有内容或系统权限" />
    <el-tabs v-else v-model="activeTab" class="operations-tabs">
      <el-tab-pane v-if="canSystem" label="系统健康" name="health">
        <section class="panel" v-loading="loading">
          <div class="panel-title"><div><b>运行状态</b><span>只读探针，不会触碰个人用户数据</span></div><el-tag :type="health?.database.ok ? 'success' : 'danger'">{{ health?.database.ok ? '数据库正常' : '数据库异常' }}</el-tag></div>
          <div class="health-grid" v-if="health">
            <div><span>数据库延迟</span><b>{{ health.database.latencyMs }} ms</b></div>
            <div><span>检查时间</span><b>{{ formatDate(health.generatedAt) }}</b></div>
          </div>
          <el-empty v-else description="暂无健康数据" />
        </section>
      </el-tab-pane>

      <el-tab-pane v-if="canContent" label="板块" name="boards">
        <section class="panel" v-loading="loading">
          <div class="panel-title"><div><b>社区板块</b><span>系统板块只读，普通板块可由有权限的管理员维护</span></div><el-button type="primary" @click="openCreate">新建板块</el-button></div>
          <el-table :data="boards" stripe>
            <el-table-column prop="name" label="名称" min-width="180" />
            <el-table-column prop="slug" label="Slug" min-width="170" />
            <el-table-column prop="type" label="类型" width="120" />
            <el-table-column label="状态" width="120"><template #default="{ row }"><el-tag size="small" :type="row.systemManaged ? 'info' : 'success'">{{ row.systemManaged ? '系统' : '可维护' }}</el-tag></template></el-table-column>
            <el-table-column label="操作" width="150" fixed="right"><template #default="{ row }"><el-button v-if="!row.systemManaged" link type="primary" @click="openEdit(row)">编辑</el-button><el-button v-if="!row.systemManaged" link type="danger" @click="removeBoard(row)">删除</el-button></template></el-table-column>
          </el-table>
        </section>
      </el-tab-pane>

      <el-tab-pane v-if="canContent" label="公告概览" name="announcements">
        <section class="panel" v-loading="loading">
          <div class="panel-title"><div><b>站内公告</b><span>公告同步授权仍保留在专用流程中，此处只读查看当前公告</span></div></div>
          <el-table :data="announcements" stripe><el-table-column prop="title" label="标题" min-width="240" /><el-table-column prop="level" label="级别" width="110" /><el-table-column prop="createdAt" label="创建时间" min-width="180"><template #default="{ row }">{{ formatDate(row.createdAt) }}</template></el-table-column></el-table>
        </section>
      </el-tab-pane>
    </el-tabs>

    <el-dialog v-model="dialogOpen" :title="editing ? '编辑板块' : '新建板块'" width="520px">
      <el-form label-position="top">
        <el-form-item label="Slug"><el-input v-model="form.slug" :disabled="Boolean(editing)" /></el-form-item>
        <el-form-item label="名称"><el-input v-model="form.name" /></el-form-item>
        <el-form-item label="描述"><el-input v-model="form.description" type="textarea" :rows="3" /></el-form-item>
        <el-form-item label="类型"><el-select v-model="form.type" style="width: 100%"><el-option label="普通" value="normal" /><el-option label="问答" value="question" /><el-option label="市场" value="market" /><el-option label="课程评价" value="coursereview" /></el-select></el-form-item>
      </el-form>
      <template #footer><el-button @click="dialogOpen = false">取消</el-button><el-button type="primary" :loading="saving" @click="saveBoard">保存</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { managementApi, type ManagementBoard, type ManagementSystemHealth } from "@/api/management";
import { useManagementStore } from "@/stores/management";

const management = useManagementStore();
const canContent = computed(() => management.hasPermission("content.manage"));
const canSystem = computed(() => management.hasPermission("system.manage"));
const activeTab = ref(canSystem.value ? "health" : "boards");
const loading = ref(false);
const saving = ref(false);
const boards = ref<ManagementBoard[]>([]);
const announcements = ref<Array<Record<string, any>>>([]);
const health = ref<ManagementSystemHealth | null>(null);
const dialogOpen = ref(false);
const editing = ref<ManagementBoard | null>(null);
const form = reactive({ slug: "", name: "", description: "", type: "normal" });

function formatDate(value?: string | null) { return value ? new Date(value).toLocaleString() : "-"; }
async function refresh() {
  loading.value = true;
  try {
    const tasks: Promise<unknown>[] = [];
    if (canSystem.value) tasks.push(managementApi.systemHealth().then((value) => { health.value = value; }));
    if (canContent.value) {
      tasks.push(managementApi.boards().then((value) => { boards.value = value; }));
      tasks.push(managementApi.announcements().then((value) => { announcements.value = value as Array<Record<string, any>>; }));
    }
    await Promise.all(tasks);
  } finally { loading.value = false; }
}
function openCreate() { editing.value = null; Object.assign(form, { slug: "", name: "", description: "", type: "normal" }); dialogOpen.value = true; }
function openEdit(row: ManagementBoard) { editing.value = row; Object.assign(form, { slug: row.slug, name: row.name, description: row.description || "", type: row.type }); dialogOpen.value = true; }
async function saveBoard() {
  saving.value = true;
  try {
    if (editing.value) await managementApi.updateBoard(editing.value.id, { name: form.name, description: form.description, type: form.type });
    else await managementApi.createBoard({ slug: form.slug, name: form.name, description: form.description, type: form.type, section: "general" });
    ElMessage.success("板块已保存"); dialogOpen.value = false; await refresh();
  } finally { saving.value = false; }
}
async function removeBoard(row: ManagementBoard) {
  await ElMessageBox.confirm(`确定删除“${row.name}”？`, "删除板块", { type: "warning" });
  await managementApi.deleteBoard(row.id); ElMessage.success("板块已删除"); await refresh();
}
onMounted(refresh);
</script>

<style scoped>
.operations-page { display: grid; gap: 18px; }.page-heading { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; }.page-heading h1 { margin: 0 0 8px; font-size: 26px; }.page-heading p:not(.eyebrow) { color: #64748b; margin: 0; line-height: 1.6; }.eyebrow { margin: 0 0 7px; color: #6d5ce7; font-size: 11px; font-weight: 800; letter-spacing: .14em; }.panel { border: 1px solid #e3e8f1; border-radius: 16px; background: white; padding: 20px; box-shadow: 0 8px 26px rgba(15,23,42,.04); }.panel-title { display: flex; justify-content: space-between; gap: 16px; align-items: center; margin-bottom: 18px; }.panel-title > div { display: grid; gap: 5px; }.panel-title span { color: #94a3b8; font-size: 12px; }.health-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }.health-grid div { display: grid; gap: 7px; padding: 18px; border-radius: 12px; background: #f7f8fc; }.health-grid span { color: #64748b; font-size: 12px; }.health-grid b { font-size: 22px; color: #342b96; }
@media (max-width: 680px) { .page-heading { display: grid; }.health-grid { grid-template-columns: 1fr; } }
</style>
