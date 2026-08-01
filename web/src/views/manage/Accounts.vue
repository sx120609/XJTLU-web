<template>
  <section class="page-card">
    <header class="page-head">
      <div><h1>管理员与权限</h1><p>只有 BOSS 可以创建管理账号、分配能力和撤销会话。</p></div>
      <el-button type="primary" @click="createOpen = true">创建管理员</el-button>
    </header>

    <el-alert type="info" :closable="false" show-icon title="管理账号与个人账号是两套身份；管理员不能进入帖子发布、交易或资料购买流程。" />

    <el-table :data="accounts" v-loading="loading" stripe class="account-table">
      <el-table-column label="账号" min-width="180">
        <template #default="{ row }"><div class="account-cell"><b>{{ row.displayName }}</b><span>@{{ row.username }} · ID {{ row.id }}</span></div></template>
      </el-table-column>
      <el-table-column label="类型" width="100"><template #default="{ row }"><el-tag :type="row.accountType === 'boss' ? 'danger' : 'primary'">{{ row.accountType === "boss" ? "BOSS" : "管理员" }}</el-tag></template></el-table-column>
      <el-table-column label="状态" width="115"><template #default="{ row }"><el-tag :type="row.status === 'active' ? 'success' : row.status === 'locked' ? 'danger' : 'info'" effect="plain">{{ statusLabel(row.status) }}</el-tag></template></el-table-column>
      <el-table-column label="MFA" width="90"><template #default="{ row }"><el-tag :type="row.mfaEnabled ? 'success' : 'info'" effect="plain">{{ row.mfaEnabled ? "已启用" : "未启用" }}</el-tag></template></el-table-column>
      <el-table-column label="权限" min-width="250"><template #default="{ row }"><div v-if="row.accountType === 'boss'" class="all-permissions">全部权限（不可降级）</div><div v-else class="permission-summary"><el-tag v-for="code in row.permissions.slice(0, 4)" :key="code" size="small" effect="plain">{{ shortPermission(code) }}</el-tag><span v-if="row.permissions.length > 4">+{{ row.permissions.length - 4 }}</span><span v-if="!row.permissions.length">未分配</span></div></template></el-table-column>
      <el-table-column label="最后登录" width="165"><template #default="{ row }"><span class="muted">{{ row.lastLoginAt ? formatDate(row.lastLoginAt) : "从未登录" }}</span></template></el-table-column>
      <el-table-column label="操作" width="118" fixed="right">
        <template #default="{ row }">
          <el-dropdown v-if="row.accountType === 'admin'" @command="handleCommand($event, row)">
            <el-button text type="primary">管理 ▾</el-button>
            <template #dropdown><el-dropdown-menu>
              <el-dropdown-item command="permissions">分配权限</el-dropdown-item>
              <el-dropdown-item command="rename">修改显示名</el-dropdown-item>
              <el-dropdown-item command="password">重置密码</el-dropdown-item>
              <el-dropdown-item command="sessions">撤销全部会话</el-dropdown-item>
              <el-dropdown-item :command="row.status === 'active' ? 'disable' : 'enable'" divided>{{ row.status === "active" ? "禁用账号" : "恢复账号" }}</el-dropdown-item>
            </el-dropdown-menu></template>
          </el-dropdown>
          <span v-else class="protected">受保护</span>
        </template>
      </el-table-column>
    </el-table>
  </section>

  <el-dialog v-model="createOpen" title="创建管理员" width="500px" destroy-on-close>
    <el-form label-position="top">
      <el-form-item label="登录账号"><el-input v-model="createForm.username" maxlength="64" placeholder="仅英文、数字和下划线" /></el-form-item>
      <el-form-item label="显示名称"><el-input v-model="createForm.displayName" maxlength="80" /></el-form-item>
      <el-form-item label="初始密码"><el-input v-model="createForm.password" type="password" show-password maxlength="128" placeholder="至少 12 位" /></el-form-item>
    </el-form>
    <template #footer><el-button @click="createOpen = false">取消</el-button><el-button type="primary" :loading="saving" @click="createAccount">创建</el-button></template>
  </el-dialog>

  <el-dialog v-model="permissionOpen" :title="`分配权限 · ${selected?.displayName || ''}`" width="680px" destroy-on-close>
    <p class="dialog-tip">保存后，该管理员的现有管理会话会被全部撤销，需要重新登录。</p>
    <el-checkbox-group v-model="selectedPermissions" class="permission-groups">
      <div v-for="group in permissionGroups" :key="group.name" class="permission-group">
        <h3>{{ groupLabel(group.name) }}</h3>
        <el-checkbox v-for="permission in group.items" :key="permission.code" :value="permission.code">
          <span>{{ permissionLabel(permission.code) }}</span><small>{{ permission.code }}</small>
        </el-checkbox>
      </div>
    </el-checkbox-group>
    <template #footer><el-button @click="permissionOpen = false">取消</el-button><el-button type="primary" :loading="saving" @click="savePermissions">保存并撤销旧会话</el-button></template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { managementApi, type ManagementAccount, type ManagementPermissionDefinition } from "@/api/management";

const accounts = ref<ManagementAccount[]>([]);
const permissions = ref<ManagementPermissionDefinition[]>([]);
const loading = ref(false);
const saving = ref(false);
const createOpen = ref(false);
const permissionOpen = ref(false);
const selected = ref<ManagementAccount | null>(null);
const selectedPermissions = ref<string[]>([]);
const createForm = reactive({ username: "", displayName: "", password: "" });

const labels: Record<string, string> = {
  "dashboard.read": "查看工作台", "users.read": "查看个人用户", "users.moderate": "治理个人用户", "users.sensitive": "敏感用户操作",
  "forum.review": "帖子人工审核", "forum.moderate": "帖子内容治理", "market.review": "实物商品审核", "market.governance": "市集举报与申诉",
  "market.operations": "市集运营", "learning.review": "学习资料审核", "learning.operations": "学习资料运营", "content.manage": "板块与公告管理",
  "promotion.manage": "推广管理", "sponsor.manage": "赞助管理", "payments.manage": "支付管理", "system.manage": "系统与 AI 设置",
  "storage.manage": "存储管理", "backup.manage": "备份与恢复", "audit.read": "查看审计日志",
};
const permissionGroups = computed(() => {
  const grouped = new Map<string, ManagementPermissionDefinition[]>();
  for (const item of permissions.value) grouped.set(item.group, [...(grouped.get(item.group) || []), item]);
  return [...grouped].map(([name, items]) => ({ name, items }));
});

onMounted(load);
async function load() {
  loading.value = true;
  try {
    const [accountRows, catalog] = await Promise.all([managementApi.accounts(), managementApi.permissionCatalog()]);
    accounts.value = accountRows;
    permissions.value = catalog.permissions;
  } finally { loading.value = false; }
}

async function createAccount() {
  if (!/^[A-Za-z0-9_]{3,64}$/.test(createForm.username)) return ElMessage.warning("账号格式不正确");
  if (!createForm.displayName.trim()) return ElMessage.warning("请输入显示名称");
  if (createForm.password.length < 12) return ElMessage.warning("密码至少 12 位");
  saving.value = true;
  try {
    await managementApi.createAccount({ ...createForm, username: createForm.username.trim(), displayName: createForm.displayName.trim() });
    createOpen.value = false;
    Object.assign(createForm, { username: "", displayName: "", password: "" });
    ElMessage.success("管理员已创建，请继续分配权限");
    await load();
  } finally { saving.value = false; }
}

function openPermissions(row: ManagementAccount) {
  selected.value = row;
  selectedPermissions.value = [...row.permissions];
  permissionOpen.value = true;
}

async function savePermissions() {
  if (!selected.value) return;
  saving.value = true;
  try {
    await managementApi.replaceAccountPermissions(selected.value.id, selectedPermissions.value);
    permissionOpen.value = false;
    ElMessage.success("权限已更新，旧会话已撤销");
    await load();
  } finally { saving.value = false; }
}

async function handleCommand(command: string, row: ManagementAccount) {
  if (command === "permissions") return openPermissions(row);
  if (command === "rename") {
    const result = await ElMessageBox.prompt("请输入新的显示名称", "修改显示名", { inputValue: row.displayName, inputValidator: (value) => Boolean(value.trim()) || "显示名称不能为空" });
    await managementApi.updateAccount(row.id, { displayName: result.value.trim() });
  } else if (command === "password") {
    const result = await ElMessageBox.prompt("新密码至少 12 位；保存后旧会话将被撤销。", "重置管理员密码", { inputType: "password", inputValidator: (value) => value.length >= 12 || "密码至少 12 位" });
    await managementApi.resetAccountPassword(row.id, result.value);
  } else if (command === "sessions") {
    await ElMessageBox.confirm(`撤销 ${row.displayName} 的全部登录会话？`, "撤销会话", { type: "warning" });
    await managementApi.revokeAccountSessions(row.id);
  } else if (command === "disable" || command === "enable") {
    const status = command === "disable" ? "disabled" : "active";
    await ElMessageBox.confirm(`${command === "disable" ? "禁用" : "恢复"}管理员 ${row.displayName}？`, "账号状态", { type: "warning" });
    await managementApi.updateAccount(row.id, { status });
  }
  ElMessage.success("操作已完成");
  await load();
}

function statusLabel(status: string) { return ({ active: "正常", disabled: "已禁用", locked: "已锁定" } as Record<string, string>)[status] || status; }
function permissionLabel(code: string) { return labels[code] || code; }
function shortPermission(code: string) { return permissionLabel(code).replace("管理", ""); }
function groupLabel(group: string) { return ({ dashboard: "工作台", users: "个人用户", forum: "帖子", market: "实物市集", learning: "学习资料", content: "内容", commercial: "商业", system: "系统" } as Record<string, string>)[group] || group; }
function formatDate(value: string) { return new Date(value).toLocaleString("zh-CN", { hour12: false }); }
</script>

<style scoped>
.page-card { border: 1px solid #e3e8f1; border-radius: 16px; background: white; overflow: hidden; }.page-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 22px 24px; }.page-head h1 { margin: 0; font-size: 20px; }.page-head p { margin: 6px 0 0; color: #64748b; font-size: 12px; }.page-card :deep(.el-alert) { margin: 0 24px 18px; width: auto; }.account-table { width: 100%; }.account-cell { display: grid; gap: 3px; }.account-cell span,.muted { color: #94a3b8; font-size: 11px; }.permission-summary { display: flex; gap: 5px; align-items: center; flex-wrap: wrap; color: #94a3b8; font-size: 11px; }.all-permissions { color: #b42318; font-size: 12px; font-weight: 650; }.protected { color: #94a3b8; font-size: 12px; }.dialog-tip { margin: -4px 0 18px; color: #64748b; font-size: 12px; }.permission-groups { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; max-height: 55vh; overflow: auto; }.permission-group { padding: 13px 14px; border: 1px solid #e7eaf1; border-radius: 12px; }.permission-group h3 { margin: 0 0 9px; font-size: 13px; }.permission-group :deep(.el-checkbox) { width: 100%; height: auto; align-items: flex-start; margin: 5px 0; }.permission-group :deep(.el-checkbox__label) { display: grid; gap: 1px; white-space: normal; }.permission-group small { color: #94a3b8; font-size: 10px; }
@media (max-width: 700px) { .page-head { align-items: flex-start; padding: 18px; }.permission-groups { grid-template-columns: 1fr; }.page-card :deep(.el-alert) { margin-inline: 18px; } }
</style>
