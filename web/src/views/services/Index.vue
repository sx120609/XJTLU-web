<template>
  <div class="services-page">
    <header class="page-head">
      <div>
        <h2>校园服务</h2>
        <p>连接 XJTLU 融合门户，并集中展示站内校园工具。</p>
      </div>
      <a href="https://ehall.xjtlu.edu.cn/default/index.html#/apps" target="_blank" rel="noopener noreferrer">
        官方融合门户
      </a>
    </header>

    <section class="tool-section" v-loading="toolsLoading">
      <div class="section-head">
        <div>
          <h3>校园工具</h3>
          <p>反馈、问卷和临时查询等站内服务。</p>
        </div>
        <el-button type="primary" plain @click="$router.push('/services/tools')">
          <el-icon><Tools /></el-icon>
          全部工具
        </el-button>
      </div>
      <el-alert v-if="toolsError" type="warning" :closable="false" :title="toolsError" />
      <div class="tool-grid">
        <button
          v-for="tool in visibleTools"
          :key="tool.slug"
          type="button"
          class="tool-entry"
          :class="{ planned: tool.status === 'planned' }"
          @click="$router.push({ name: tool.routeName, params: { slug: tool.slug } })"
        >
          <span class="tool-icon" :style="{ color: tool.accent }">
            <el-icon><component :is="tool.iconComponent" /></el-icon>
          </span>
          <span class="tool-copy">
            <strong>{{ tool.name }}</strong>
            <small>{{ tool.summary }}</small>
          </span>
          <em>{{ isLoginRequired(tool.slug) ? '需登录' : '免登录' }}</em>
          <el-icon><Right /></el-icon>
        </button>
      </div>
    </section>

    <EhallServicesPane v-if="auth.isLoggedIn" />
    <section v-else class="login-card">
      <span class="lock-icon"><el-icon><Lock /></el-icon></span>
      <div>
        <h3>登录后连接融合门户</h3>
        <p>使用 XJTLU 统一认证登录后，系统会自动建立短期门户会话；学校密码不会保存。</p>
      </div>
      <el-button type="primary" @click="$router.push({ name: 'login', query: { redirect: '/services' } })">前往登录</el-button>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { Lock, Right, Tools } from "@element-plus/icons-vue";
import { useAuthStore } from "@/stores/auth";
import EhallServicesPane from "@/components/xjtlu/EhallServicesPane.vue";
import { serviceTools } from "@/data/serviceTools";
import { toolsApi, type ToolMeta } from "@/api/tools";

const auth = useAuthStore();
const toolMetas = ref<ToolMeta[]>([]);
const toolsLoading = ref(false);
const toolsError = ref("");
let requestSequence = 0;
let disposed = false;

const toolAccessMap = computed(() => Object.fromEntries(toolMetas.value.map((item) => [item.code, item])));
const visibleTools = computed(() => serviceTools.filter((tool) => toolAccessMap.value[tool.slug]?.isVisible !== false));

onMounted(() => {
  auth.hydrate();
  void loadToolMetas();
});

onBeforeUnmount(() => {
  disposed = true;
  requestSequence += 1;
});

async function loadToolMetas() {
  const sequence = ++requestSequence;
  toolsLoading.value = true;
  toolsError.value = "";
  try {
    const result = await toolsApi.tools({ suppressErrorMessage: true });
    if (disposed || sequence !== requestSequence) return;
    toolMetas.value = result;
  } catch {
    if (disposed || sequence !== requestSequence) return;
    toolMetas.value = [];
    toolsError.value = "工具配置暂时无法加载，已显示默认入口";
  } finally {
    if (sequence === requestSequence) toolsLoading.value = false;
  }
}

function isLoginRequired(slug: string) {
  return Boolean(toolAccessMap.value[slug]?.requireLogin);
}
</script>

<style scoped>
.services-page { display: flex; flex-direction: column; gap: 18px; }
.page-head,
.section-head,
.login-card,
.tool-entry { display: flex; align-items: center; }
.page-head { justify-content: space-between; gap: 16px; }
.page-head h2 { margin: 0; font-size: 23px; }
.page-head p { margin: 5px 0 0; color: var(--cpu-text-secondary); font-size: 13px; }
.page-head a { color: #6d28d9; font-size: 13px; text-decoration: none; }
.login-card,
.tool-section {
  padding: 20px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 14px;
  background: var(--cpu-card);
}
.login-card { gap: 15px; }
.login-card > div { min-width: 0; flex: 1; }
.login-card h3 { margin: 0; font-size: 16px; }
.login-card p { margin: 5px 0 0; color: var(--cpu-text-secondary); font-size: 12px; line-height: 1.6; }
.lock-icon { width: 46px; height: 46px; display: grid; place-items: center; border-radius: 13px; color: #6d28d9; background: #f2edff; font-size: 22px; }
.section-head { justify-content: space-between; gap: 14px; margin-bottom: 14px; }
.section-head h3 { margin: 0; font-size: 17px; }
.section-head p { margin: 4px 0 0; color: var(--cpu-text-secondary); font-size: 12px; }
.tool-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr)); gap: 10px; margin-top: 13px; }
.tool-entry {
  min-width: 0;
  gap: 11px;
  padding: 13px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 11px;
  color: var(--cpu-text);
  background: var(--cpu-card);
  cursor: pointer;
  text-align: left;
}
.tool-entry:hover { border-color: var(--cpu-primary); }
.tool-entry.planned { background: var(--cpu-surface-subtle); }
.tool-icon { width: 40px; height: 40px; flex: 0 0 auto; display: grid; place-items: center; border-radius: 10px; background: var(--cpu-surface-subtle); font-size: 20px; }
.tool-copy { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 4px; }
.tool-copy strong,
.tool-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tool-copy strong { font-size: 13px; }
.tool-copy small { color: var(--cpu-text-secondary); font-size: 11px; }
.tool-entry em { flex: 0 0 auto; padding: 2px 6px; border-radius: 999px; color: #6d28d9; background: #f2edff; font-size: 10px; font-style: normal; }
@media (max-width: 700px) {
  .page-head,
  .section-head,
  .login-card { align-items: flex-start; flex-direction: column; }
  .login-card,
  .tool-section { padding: 15px; border-radius: 12px; }
  .login-card .el-button,
  .section-head .el-button { width: 100%; }
  .tool-grid { grid-template-columns: 1fr; }
}
</style>
