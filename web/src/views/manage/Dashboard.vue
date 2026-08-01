<template>
  <div class="dashboard-grid">
    <section class="welcome-card">
      <p class="eyebrow">MANAGEMENT IDENTITY</p>
      <h1>{{ management.principal?.displayName }}，欢迎回来</h1>
      <p>当前使用独立管理身份。该身份不能发帖、交易或购买学习资料，所有管理写操作均应进入审计日志。</p>
      <div class="identity-line">
        <el-tag :type="management.isBoss ? 'danger' : 'primary'">{{ management.isBoss ? "BOSS" : "管理员" }}</el-tag>
        <span>会话 ID：{{ shortSession }}</span>
        <span>权限版本：v{{ management.principal?.permissionVersion }}</span>
      </div>
    </section>
    <section v-if="canReadDashboard" class="metrics-card" v-loading="loading">
      <div class="metric"><b>{{ overview?.personalUsers.total ?? "-" }}</b><span>个人用户</span><small>{{ overview?.personalUsers.active ?? 0 }} 个正常账号</small></div>
      <div class="metric"><b>{{ overview?.managementAccounts ?? "-" }}</b><span>管理账号</span><small>与个人账号独立</small></div>
      <div class="metric"><b>{{ overview?.forum.pendingTopics ?? "-" }}</b><span>待审帖子</span><small>{{ overview?.forum.pendingReplies ?? 0 }} 条待审回复</small></div>
      <div class="metric"><b>{{ overview?.reviewQueues.physicalItems ?? "-" }}</b><span>待审实物</span><small>全部走人工审核</small></div>
      <div class="metric"><b>{{ overview?.reviewQueues.learningMaterials ?? "-" }}</b><span>待审资料</span><small>版权 / 质量 / 安全</small></div>
      <div class="metric"><b>{{ overview?.todayAuditActions ?? "-" }}</b><span>今日管理操作</span><small>已进入审计日志</small></div>
    </section>
    <section class="permission-card">
      <div class="card-title"><span>当前权限</span><b>{{ management.principal?.permissions.length || 0 }}</b></div>
      <div class="permission-list">
        <el-tag v-for="permission in management.principal?.permissions" :key="permission" size="small" effect="plain">{{ permission }}</el-tag>
      </div>
    </section>
    <section class="boundary-card">
      <h2>权限边界</h2>
      <div><b>BOSS</b><span>唯一顶级账号，创建管理员、分配权限、回收会话。</span></div>
      <div><b>管理员</b><span>仅可使用 BOSS 明确授予的能力，权限变更后旧会话会被撤销。</span></div>
      <div><b>个人用户</b><span>继续使用用户站点，不再承担后台管理身份。</span></div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useManagementStore } from "@/stores/management";
import { managementApi, type ManagementOverview } from "@/api/management";
const management = useManagementStore();
const shortSession = computed(() => management.principal?.sessionId.slice(0, 10) || "-");
const overview = ref<ManagementOverview | null>(null);
const loading = ref(false);
const canReadDashboard = computed(() => management.hasPermission("dashboard.read"));
onMounted(async () => {
  if (!canReadDashboard.value) return;
  loading.value = true;
  try { overview.value = await managementApi.overview(); } finally { loading.value = false; }
});
</script>

<style scoped>
.dashboard-grid { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(300px, .65fr); gap: 18px; }
section { border: 1px solid #e3e8f1; border-radius: 16px; background: white; box-shadow: 0 8px 26px rgba(15,23,42,.04); }
.welcome-card { padding: 30px; color: white; background: linear-gradient(135deg, #4f40c5, #7263eb 62%, #8778f1); border: 0; }.eyebrow { margin: 0 0 10px; font-size: 11px; font-weight: 800; letter-spacing: .14em; opacity: .72; }.welcome-card h1 { margin: 0 0 10px; font-size: 27px; }.welcome-card > p:not(.eyebrow) { max-width: 680px; margin: 0; line-height: 1.7; opacity: .84; }
.identity-line { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin-top: 24px; font-size: 12px; opacity: .9; }
.permission-card { padding: 22px; }.card-title { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; font-weight: 700; }.card-title b { color: #6d5ce7; font-size: 22px; }.permission-list { display: flex; flex-wrap: wrap; gap: 8px; max-height: 190px; overflow: auto; }
.metrics-card { grid-column: 1 / -1; display: grid; grid-template-columns: repeat(6, 1fr); overflow: hidden; }.metric { display: grid; gap: 4px; padding: 20px; border-right: 1px solid #edf0f5; }.metric:last-child { border-right: 0; }.metric b { color: #342b96; font-size: 25px; }.metric span { color: #334155; font-size: 12px; font-weight: 700; }.metric small { color: #94a3b8; font-size: 10px; }
.boundary-card { grid-column: 1 / -1; padding: 24px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }.boundary-card h2 { grid-column: 1 / -1; margin: 0 0 3px; font-size: 17px; }.boundary-card > div { display: grid; gap: 5px; padding: 16px; border-radius: 12px; background: #f7f8fc; }.boundary-card b { color: #3f36a7; font-size: 13px; }.boundary-card span { color: #64748b; font-size: 12px; line-height: 1.6; }
@media (max-width: 1100px) { .metrics-card { grid-template-columns: repeat(3, 1fr); }.metric:nth-child(3) { border-right: 0; } }
@media (max-width: 900px) { .dashboard-grid { grid-template-columns: 1fr; }.boundary-card { grid-column: auto; grid-template-columns: 1fr; }.boundary-card h2 { grid-column: auto; }.metrics-card { grid-column: auto; grid-template-columns: repeat(2, 1fr); }.metric:nth-child(odd) { border-right: 1px solid #edf0f5; }.metric:nth-child(even) { border-right: 0; } }
</style>
