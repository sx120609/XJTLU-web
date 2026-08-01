<template>
  <main class="manage-login-page">
    <section class="manage-login-panel">
      <div class="brand-block">
        <div class="brand-mark">K</div>
        <div>
          <p class="eyebrow">KAOPU MANAGEMENT</p>
          <h1>独立管理控制台</h1>
          <p>管理账号与个人账号完全隔离。请使用 BOSS 或管理员凭据登录。</p>
        </div>
      </div>

      <el-form label-position="top" @submit.prevent="submit">
        <el-form-item label="管理账号">
          <el-input v-model="form.username" size="large" autocomplete="username" autofocus placeholder="请输入管理账号" @keyup.enter="submit" />
        </el-form-item>
        <el-form-item label="密码">
          <el-input v-model="form.password" size="large" type="password" show-password autocomplete="current-password" placeholder="请输入密码" @keyup.enter="submit" />
        </el-form-item>
        <el-form-item label="MFA 动态验证码">
          <el-input v-model="form.otp" size="large" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="BOSS 必填，管理员启用 MFA 后必填" @keyup.enter="submit" />
        </el-form-item>
        <el-button type="primary" size="large" class="login-button" :loading="management.loading" @click="submit">
          进入管理控制台
        </el-button>
      </el-form>

      <div class="security-note">
        <b>安全边界</b>
        <span>此处不会读取或复用个人用户登录状态，管理会话仅保留在当前浏览器标签会话中。</span>
      </div>
      <router-link to="/home" class="back-link">返回用户站点</router-link>
    </section>
  </main>
</template>

<script setup lang="ts">
import { reactive } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { useManagementStore } from "@/stores/management";

const route = useRoute();
const router = useRouter();
const management = useManagementStore();
const form = reactive({ username: "", password: "", otp: "" });

async function submit() {
  if (!form.username.trim() || !form.password) {
    ElMessage.warning("请输入管理账号和密码");
    return;
  }
  if (form.otp && !/^\d{6}$/.test(form.otp)) {
    ElMessage.warning("MFA 验证码应为 6 位数字");
    return;
  }
  await management.login({
    username: form.username.trim(),
    password: form.password,
    otp: form.otp || undefined,
  });
  const redirect = typeof route.query.redirect === "string" && route.query.redirect.startsWith("/manage/")
    ? route.query.redirect
    : "/manage/dashboard";
  await router.replace(redirect);
}
</script>

<style scoped>
.manage-login-page {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 28px;
  background:
    radial-gradient(circle at 18% 15%, rgba(109, 92, 231, .22), transparent 34%),
    radial-gradient(circle at 82% 84%, rgba(16, 185, 129, .14), transparent 32%),
    #0b1020;
}
.manage-login-panel {
  width: min(100%, 480px);
  padding: 40px;
  border: 1px solid rgba(255, 255, 255, .11);
  border-radius: 22px;
  background: rgba(255, 255, 255, .97);
  box-shadow: 0 30px 80px rgba(0, 0, 0, .36);
}
.brand-block { display: flex; gap: 16px; align-items: flex-start; margin-bottom: 30px; }
.brand-mark { width: 52px; height: 52px; display: grid; place-items: center; flex: 0 0 auto; border-radius: 15px; color: white; font-weight: 800; font-size: 24px; background: linear-gradient(135deg, #6d5ce7, #4838b8); }
.eyebrow { margin: 1px 0 5px; color: #6d5ce7; letter-spacing: .13em; font-size: 11px; font-weight: 800; }
h1 { margin: 0; color: #111827; font-size: 27px; }
.brand-block p:last-child { margin: 8px 0 0; color: #64748b; font-size: 13px; line-height: 1.65; }
.login-button { width: 100%; margin-top: 4px; }
.security-note { margin-top: 22px; padding: 13px 14px; display: grid; gap: 3px; border-radius: 12px; background: #f1f5f9; color: #64748b; font-size: 12px; line-height: 1.55; }
.security-note b { color: #334155; }
.back-link { display: block; margin-top: 18px; text-align: center; color: #64748b; font-size: 13px; text-decoration: none; }
.back-link:hover { color: #6d5ce7; }
@media (max-width: 560px) { .manage-login-page { padding: 0; align-items: stretch; } .manage-login-panel { width: auto; border-radius: 0; padding: 32px 22px; } }
</style>
