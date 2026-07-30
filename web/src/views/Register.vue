<template>
  <div class="auth-wrap">
    <div class="auth-card">
      <div class="auth-nav">
        <el-button text class="nav-btn" @click="goHome">
          <el-icon><ArrowLeft /></el-icon>
          {{ isEnglish ? "Back to Home" : "返回首页" }}
        </el-button>
        <el-button text class="nav-btn" @click="goLogin">{{ isEnglish ? "Sign in" : "直接登录" }}</el-button>
      </div>

      <div class="brand">
        <div class="brand-logo"><img :src="site.siteLogoUrl || '/brand/kaopu-mark.svg'" alt="靠浦" /></div>
        <div>
          <h1>{{ isEnglish ? "Join" : "注册" }} {{ site.siteName }}</h1>
          <p>{{ isEnglish ? "Public registration is currently closed" : "暂不开放公开注册" }}</p>
        </div>
      </div>

      <!-- 生产模式：公开注册已关闭 -->
      <template v-if="!isDev">
        <el-alert type="info" :closable="false" show-icon class="closed-tip">
          <div style="line-height:1.7">
            <p style="margin:0 0 6px"><b>{{ isEnglish ? "Public registration is closed." : "公开注册已关闭。" }}</b></p>
            <p style="margin:0">
              <template v-if="isEnglish">XJTLU students and staff should use <button type="button" class="inline-link" @click="goLogin">the sign-in page</button> and <b>university authentication</b>. An account is created automatically on first sign-in.<br>Contact the site team if university authentication is temporarily unavailable for your account.</template>
              <template v-else>XJTLU 师生请在 <button type="button" class="inline-link" @click="goLogin">登录页</button> 使用<b>学校统一认证</b>登录，首次登录会自动创建账号。<br>暂时无法使用统一认证的账号，可联系站务协助处理。</template>
            </p>
          </div>
        </el-alert>
        <div class="alt" style="margin-top:18px">
          <button type="button" @click="goLogin">{{ isEnglish ? "Go to sign in" : "去登录页" }}</button>
        </div>
        <PrivacyPolicyNotice />
      </template>

      <!-- 开发模式：保留旧的注册表单便于自测 -->
      <template v-else>
        <el-form ref="formRef" :model="form" :rules="rules" size="large" label-position="top" @keyup.enter="submit">
          <el-form-item :label="isEnglish ? 'Username (for sign-in)' : '用户名（登录用）'" prop="username">
            <el-input v-model="form.username" :placeholder="isEnglish ? '3–20 letters, numbers, or underscores' : '3-20 位英文/数字/下划线'" :disabled="loading" />
          </el-form-item>
          <el-form-item :label="isEnglish ? 'Display name' : '昵称（显示用）'" prop="nickname">
            <el-input v-model="form.nickname" :placeholder="isEnglish ? 'Shown publicly' : '支持中文'" maxlength="20" show-word-limit :disabled="loading" />
          </el-form-item>
          <el-form-item :label="isEnglish ? 'Password' : '密码'" prop="password">
            <el-input v-model="form.password" type="password" show-password :placeholder="isEnglish ? 'At least 6 characters' : '至少 6 位'" :disabled="loading" />
          </el-form-item>
          <el-form-item :label="isEnglish ? 'School (optional)' : '院系（选填）'">
            <el-input v-model="form.college" :placeholder="isEnglish ? 'Example: School of Pharmacy' : '例如 药学院'" maxlength="40" :disabled="loading" />
          </el-form-item>
          <el-form-item :label="isEnglish ? 'Entry year (optional)' : '入学年份（选填）'">
            <el-input-number v-model="form.enrollYear" :min="2010" :max="2030" :step="1" style="width:100%" :disabled="loading" />
          </el-form-item>
          <el-form-item>
            <el-checkbox v-model="agree" :disabled="loading">{{ isEnglish ? "I have read and accept the" : "我已阅读并同意" }} <button type="button" class="inline-link" @click.stop="showTerms = true">{{ isEnglish ? "User Agreement" : "用户协议" }}</button></el-checkbox>
          </el-form-item>
          <el-form-item>
            <el-button type="primary" class="btn-submit" :loading="loading" :disabled="loading || !agree" @click="submit">{{ isEnglish ? "Register" : "注 册" }}</el-button>
          </el-form-item>
        </el-form>

        <div class="alt">
          {{ isEnglish ? "Already have an account?" : "已有账号？" }}<button type="button" @click="goLogin">{{ isEnglish ? "Sign in" : "直接登录" }}</button>
        </div>
        <PrivacyPolicyNotice />
      </template>
    </div>

    <el-dialog v-model="showTerms" :title="`${site.siteName} ${isEnglish ? 'User Agreement' : '用户协议'}`" width="500">
      <p>{{ isEnglish ? `${site.siteName} is a campus communication and services platform.` : `${site.siteName} 是面向校内同学的交流与服务平台。` }}</p>
      <p>{{ isEnglish ? "By registering, you agree to:" : "注册即表示你同意：" }}</p>
      <ol>
        <li>{{ isEnglish ? "Do not publish illegal, prohibited, or abusive content" : "不发布违法、违规、人身攻击内容" }}</li>
        <li>{{ isEnglish ? "Copyright in posts and replies remains with their authors" : "所有发帖与回复内容版权归发布者本人" }}</li>
        <li>{{ isEnglish ? "Student or staff IDs may create or link site accounts; the site does not store university passwords or verification codes" : "学号 / 工号会用于创建或关联站内账号，本站不保存学校密码和验证码" }}</li>
        <li>{{ isEnglish ? "The site may remove prohibited content or suspend accounts when appropriate" : "站方有权根据情节删除违规内容、封禁账号" }}</li>
        <li>{{ isEnglish ? "Evaluate information independently; official university notices prevail for important matters" : "请自行判断信息内容，重要事项以学校正式通知为准" }}</li>
      </ol>
      <template #footer>
        <el-button type="primary" @click="agree = true; showTerms = false">{{ isEnglish ? "I agree" : "我同意" }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage, type FormInstance, type FormRules } from "element-plus";
import { ArrowLeft } from "@element-plus/icons-vue";
import { useAuthStore } from "@/stores/auth";
import { useSiteStore } from "@/stores/site";
import { resolveSafeRedirect } from "@/utils/redirect";
import PrivacyPolicyNotice from "@/components/common/PrivacyPolicyNotice.vue";
import { useLocale } from "@/i18n";

const router = useRouter();
const route = useRoute();
const auth = useAuthStore();
const site = useSiteStore();
const { isEnglish } = useLocale();
const formRef = ref<FormInstance>();
const loading = ref(false);
const agree = ref(false);
const showTerms = ref(false);
const isDev = computed(() => import.meta.env.DEV);

const form = reactive({
  username: "", password: "", nickname: "",
  college: "", enrollYear: undefined as number | undefined,
});

const rules = computed<FormRules>(() => ({
  username: [
    { required: true, message: isEnglish.value ? "Enter a username" : "请输入用户名" },
    { pattern: /^[a-zA-Z0-9_]{3,20}$/, message: isEnglish.value ? "Use 3–20 letters, numbers, or underscores" : "3-20 位英文/数字/下划线" },
  ],
  nickname: [{ required: true, message: isEnglish.value ? "Enter a display name" : "请输入昵称" }],
  password: [
    { required: true, message: isEnglish.value ? "Enter a password" : "请输入密码" },
    { min: 6, message: isEnglish.value ? "Use at least 6 characters" : "至少 6 位" },
  ],
}));

onMounted(() => {
  if (auth.isLoggedIn) router.replace(redirectTarget());
});

function redirectTarget() {
  return resolveSafeRedirect(route.query.redirect);
}

function goHome() {
  router.replace("/home");
}

function goLogin() {
  router.push({ name: "login", query: route.query.redirect ? { redirect: redirectTarget() } : undefined });
}

async function submit() {
  if (loading.value) return;
  try { await formRef.value?.validate(); } catch { return; }
  if (!agree.value) { ElMessage.warning(isEnglish.value ? "Accept the User Agreement first" : "请先同意用户协议"); return; }
  loading.value = true;
  try {
    await auth.register({
      username: form.username,
      password: form.password,
      nickname: form.nickname,
      college: form.college || undefined,
      enrollYear: form.enrollYear,
    });
    ElMessage.success(isEnglish.value ? `Welcome, ${auth.user?.nickname}! Registration complete.` : `欢迎，${auth.user?.nickname}！注册成功`);
    router.replace(redirectTarget());
  } catch { /* 拦截器已提示 */ }
  finally { loading.value = false; }
}
</script>

<style scoped lang="scss">
.auth-wrap {
  min-height: 100vh;
  min-height: 100dvh;
  display: grid;
  place-items: center;
  background: linear-gradient(135deg, #f4f6f8, #e0f2ef);
  padding: 20px;
}

.auth-card {
  width: 460px;
  max-width: 100%;
  background: #fff;
  border-radius: 16px;
  padding: 32px 36px 24px;
  box-shadow: 0 24px 60px rgba(15, 23, 42, 0.1);
}

.auth-nav {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: -12px -10px 18px;
}

.nav-btn {
  min-height: 34px;
  padding: 0 10px;
  color: var(--cpu-primary);
}

.brand {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 20px;
}

.brand-logo {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: #6d5ce7;
  color: #fff;
  display: grid;
  place-items: center;
  font-family: serif;
  font-size: 24px;
  font-weight: 700;
}
.brand-logo img { width: 100%; height: 100%; object-fit: cover; border-radius: inherit; }

.brand h1 { margin: 0; font-size: 20px; color: var(--cpu-primary); }
.brand p { margin: 2px 0 0; font-size: 12px; color: #6b7280; }

.btn-submit { width: 100%; letter-spacing: 4px; }

.inline-link {
  border: 0;
  background: transparent;
  color: var(--el-color-primary);
  padding: 0;
  font: inherit;
  cursor: pointer;
  vertical-align: baseline;
}

.inline-link:hover,
.inline-link:focus-visible {
  text-decoration: underline;
}

.alt {
  text-align: center;
  font-size: 13px;
  color: #6b7280;
  margin-top: 8px;
  button {
    border: none;
    background: none;
    padding: 0;
    color: var(--cpu-primary);
    font: inherit;
    cursor: pointer;
    margin-left: 4px;
  }
}

ol { padding-left: 20px; line-height: 1.8; color: #4b5563; font-size: 13px; }
.closed-tip { font-size: 13px; line-height: 1.6; }
.closed-tip a { color: var(--cpu-primary); text-decoration: underline; }

@media (max-width: 640px) {
  .auth-wrap {
    min-height: 100dvh;
    align-items: start;
    padding: calc(18px + env(safe-area-inset-top)) 12px 18px;
  }

  .auth-card {
    width: 100%;
    border-radius: 14px;
    padding: 22px 18px 18px;
  }

  .brand {
    margin-bottom: 16px;
  }

  .auth-nav {
    margin: -8px -8px 16px;
  }

  .brand-logo {
    width: 40px;
    height: 40px;
    border-radius: 10px;
    font-size: 22px;
  }
}
</style>
