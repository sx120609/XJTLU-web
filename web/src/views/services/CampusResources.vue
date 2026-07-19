<template>
  <div class="resources-page">
    <header class="page-head">
      <div>
        <span>CAMPUS RESOURCES</span>
        <h1>校园资源</h1>
        <p>连接 XJTLU 融合门户，集中查看校内服务与信息入口。</p>
      </div>
      <a href="https://ehall.xjtlu.edu.cn/default/index.html#/apps" target="_blank" rel="noopener noreferrer">打开官方融合门户 →</a>
    </header>

    <EhallServicesPane v-if="auth.isLoggedIn" />
    <section v-else class="login-card cpu-card">
      <span class="lock-icon"><el-icon><Lock /></el-icon></span>
      <div>
        <h2>登录后连接融合门户</h2>
        <p>使用 XJTLU 统一认证登录后，系统会自动建立短期门户会话；学校密码不会保存。</p>
      </div>
      <el-button type="primary" @click="$router.push({ name: 'login', query: { redirect: '/services/resources' } })">前往登录</el-button>
    </section>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from "vue";
import { Lock } from "@element-plus/icons-vue";
import EhallServicesPane from "@/components/xjtlu/EhallServicesPane.vue";
import { useAuthStore } from "@/stores/auth";

const auth = useAuthStore();
onMounted(() => auth.hydrate());
</script>

<style scoped>
.resources-page{display:flex;flex-direction:column;gap:20px}.page-head,.login-card{display:flex;align-items:center}.page-head{justify-content:space-between;gap:18px;padding:8px 2px}.page-head span{color:var(--cpu-primary);font-size:10px;font-weight:800;letter-spacing:.16em}.page-head h1{margin:6px 0 5px;font-size:29px}.page-head p{margin:0;color:var(--cpu-text-secondary);font-size:13px}.page-head a{flex:0 0 auto;color:var(--cpu-primary);font-size:12px;font-weight:700;text-decoration:none}.login-card{gap:16px;padding:22px;border-radius:16px}.login-card>div{min-width:0;flex:1}.login-card h2{margin:0;font-size:17px}.login-card p{margin:6px 0 0;color:var(--cpu-text-secondary);font-size:12px;line-height:1.65}.lock-icon{display:grid;width:48px;height:48px;flex:0 0 auto;place-items:center;border-radius:13px;color:var(--cpu-primary);background:var(--cpu-primary-soft);font-size:22px}@media(max-width:700px){.page-head,.login-card{align-items:flex-start;flex-direction:column}.page-head h1{font-size:25px}.login-card{padding:17px}.login-card .el-button{width:100%}}
</style>
