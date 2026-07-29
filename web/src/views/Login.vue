<template>
  <div class="auth-wrap">
    <div class="auth-card">
      <div class="auth-nav">
        <el-button text class="nav-btn" @click="goHome">
          <el-icon><ArrowLeft /></el-icon>
          {{ reconnectReturnLabel }}
        </el-button>
      </div>

      <div class="brand">
        <div class="brand-logo"><img :src="site.siteLogoUrl || '/brand/kaopu-mark.svg'" alt="靠浦" /></div>
        <div>
          <h1>{{ site.siteName }}</h1>
          <p>{{ site.siteSubtitle }}</p>
        </div>
      </div>

      <p class="welcome">
        <template v-if="reconnectMode">重新连接 <strong>学校服务</strong></template>
        <template v-else>使用 <strong>学校统一认证</strong> 登录</template>
      </p>
      <p class="hint">{{ loginHint }}</p>

      <el-alert type="warning" :closable="false" show-icon class="safety">
        账号仅用于学校身份验证；服务器不会保存密码。勾选“记住账号密码”后，凭据会加密保存在当前设备，用于掉线后自动恢复。
      </el-alert>

      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        size="large"
        class="form"
        autocomplete="on"
        @submit.prevent="auth.ssoMfa ? onMfaSubmit() : onSubmit()"
      >
        <el-form-item v-if="!auth.ssoMfa" prop="username">
          <el-input v-model="form.username" name="username" autocomplete="username" placeholder="XJTLU 用户名" :disabled="auth.ssoLoading || captchaRefreshing">
            <template #prefix><el-icon><User /></el-icon></template>
          </el-input>
        </el-form-item>
        <el-form-item v-if="!auth.ssoMfa" prop="password">
          <el-input v-model="form.password" name="password" type="password" show-password autocomplete="current-password" placeholder="密码" :disabled="auth.ssoLoading || captchaRefreshing">
            <template #prefix><el-icon><Lock /></el-icon></template>
          </el-input>
        </el-form-item>
        <el-form-item v-if="auth.ssoMfa" class="mfa-form-item">
          <div class="mfa-panel">
            <div class="mfa-head">
              <div>
                <span class="mfa-kicker">学校安全验证</span>
                <strong>完成二次身份验证</strong>
                <span>检测到异常登录活动，请完成 XJTLU 二次认证</span>
              </div>
              <el-button text :disabled="auth.ssoLoading" @click="restartPrimaryLogin">返回</el-button>
            </div>
            <p class="mfa-title">选择任意一种认证方式</p>
            <div class="mfa-methods">
              <button
                v-for="method in auth.ssoMfa.methods"
                :key="method.type"
                type="button"
                class="mfa-method"
                :class="{ active: selectedMfaType === method.type }"
                :disabled="auth.ssoLoading"
                @click="selectMfaMethod(method.type)"
              >
                <span class="mfa-method-icon">
                  <el-icon><Message v-if="method.type === 'email'" /><Key v-else-if="method.type === 'otp'" /><Cellphone v-else /></el-icon>
                </span>
                <span>{{ method.type === 'email' ? '邮箱验证码' : method.type === 'otp' ? '动态口令' : '短信验证码' }}</span>
              </button>
            </div>
            <div v-if="selectedMfaMethod" class="mfa-entry">
              <p v-if="selectedMfaMethod.destination" class="mfa-destination">
                验证码将发送至 {{ selectedMfaMethod.destination }}
              </p>
              <el-input
                v-if="selectedMfaMethod.codeRequired"
                v-model="mfaCode"
                name="one-time-code"
                autocomplete="one-time-code"
                inputmode="numeric"
                :maxlength="selectedMfaMethod.codeLength"
                :placeholder="selectedMfaMethod.type === 'otp' ? '输入动态口令 OTP' : '输入验证码'"
                :disabled="auth.ssoLoading"
              >
                <template #prefix><el-icon><Lock /></el-icon></template>
              </el-input>
              <el-input
                v-if="selectedMfaMethod.passwordRequired"
                v-model="mfaPassword"
                name="mfa-password"
                type="password"
                show-password
                autocomplete="current-password"
                placeholder="该认证方式还需要 XJTLU 密码"
                :disabled="auth.ssoLoading"
              />
              <div class="mfa-actions">
                <el-button
                  v-if="selectedMfaMethod.type !== 'otp'"
                  native-type="button"
                  :disabled="auth.ssoLoading || mfaCooldown > 0"
                  @click="sendMfaCode"
                >
                  {{ mfaCooldown > 0 ? `${mfaCooldown}s 后可重发` : '发送验证码' }}
                </el-button>
                <el-button native-type="submit" type="primary" :loading="auth.ssoLoading">验证并登录</el-button>
              </div>
            </div>
          </div>
        </el-form-item>
        <el-form-item v-if="auth.ssoNeedCaptcha" prop="captcha">
          <div class="vcode-row">
            <el-input v-model="form.captcha" placeholder="看图输入验证码" maxlength="8" style="flex:1" :disabled="auth.ssoLoading || captchaRefreshing" />
            <button
              v-if="auth.ssoCaptchaImage"
              type="button"
              class="vcode-img-button"
              :disabled="auth.ssoLoading || captchaRefreshing"
              aria-label="刷新验证码"
              title="刷新验证码"
              @click="reloadCaptcha"
            >
              <img :src="auth.ssoCaptchaImage" alt="captcha" class="vcode-img" loading="lazy" decoding="async" fetchpriority="low" />
            </button>
            <el-button text :loading="captchaRefreshing" :disabled="auth.ssoLoading" @click="reloadCaptcha"><el-icon><Refresh /></el-icon></el-button>
          </div>
        </el-form-item>
        <el-form-item v-if="auth.ssoVerification?.type === 'slider'" class="slider-form-item">
          <div class="slider-challenge">
            <div class="slider-heading">
              <span>第二步：拖动滑块完成拼图</span>
              <span v-if="sliderChecking">正在校验…</span>
            </div>
            <div class="slider-picture">
              <img
                :src="auth.ssoVerification.sourceImage"
                alt="XJTLU 滑块验证背景"
                class="slider-source"
                @load="onSliderSourceLoad"
              />
              <img
                :src="auth.ssoVerification.puzzleImage"
                alt="XJTLU 滑块拼图"
                class="slider-puzzle"
                :style="sliderPuzzleStyle"
                @load="onSliderPuzzleLoad"
              />
            </div>
            <input
              v-model.number="sliderValue"
              class="slider-range"
              type="range"
              min="0"
              max="1000"
              step="1"
              aria-label="拖动滑块完成拼图验证"
              :disabled="auth.ssoLoading || sliderChecking"
              @change="onSliderRelease"
            />
            <p class="slider-tip">把拼图块拖到缺口位置，松开后会自动继续登录。</p>
          </div>
        </el-form-item>
        <el-form-item v-if="auth.ssoError">
          <el-alert :title="auth.ssoError" type="error" :closable="false" show-icon />
        </el-form-item>
        <el-form-item v-if="!auth.ssoMfa">
          <el-checkbox v-model="remember">记住账号密码并保持登录（仅当前设备）</el-checkbox>
          <el-button v-if="savedCredsPresent" text type="danger" @click="forgetSavedCreds">
            清除已保存信息
          </el-button>
        </el-form-item>
        <el-form-item v-if="!auth.ssoMfa">
          <el-button native-type="submit" type="primary" class="btn-submit" :loading="auth.ssoLoading" :disabled="captchaRefreshing || sliderChecking">
            {{ reconnectMode ? "重新连接" : "登 录" }}
          </el-button>
        </el-form-item>
      </el-form>

      <PrivacyPolicyNotice />

      <!-- 仅开发环境保留本地测试账号，不作为生产登录方式。 -->
      <details v-if="isDev" class="dev-fallback">
        <summary>🔑 开发账号登录</summary>
        <div class="dev-tip">
          仅用于本地开发与调试；生产环境固定使用 XJTLU 统一认证。
        </div>
        <el-form size="default" class="dev-form" autocomplete="on" @submit.prevent="onDevSubmit">
          <el-input v-model="dev.username" name="username" autocomplete="username" placeholder="用户名" :disabled="dev.loading" />
          <el-input v-model="dev.password" name="password" type="password" show-password autocomplete="current-password" placeholder="密码" :disabled="dev.loading" />
          <el-button native-type="submit" :loading="dev.loading" :disabled="dev.loading">登录</el-button>
        </el-form>
        <div class="dev-accounts">
          <button type="button" @click="fillDev('alice', '123456')">alice / 123456</button>
          <button type="button" @click="fillDev('bob', '123456')">bob / 123456</button>
          <button type="button" @click="fillDev('carol', '123456')">carol / 123456</button>
          <button type="button" @click="fillDev('admin', 'admin123')">admin / admin123</button>
        </div>
      </details>

      <div class="alt-actions">
        <button type="button" @click="goHome">暂不登录，继续浏览</button>
        <span>·</span>
        <span class="muted-note">多数同学可直接使用统一认证登录</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onBeforeUnmount, onMounted, type CSSProperties } from "vue";
import { useRouter, useRoute } from "vue-router";
import { ElMessage, type FormInstance, type FormRules } from "element-plus";
import { User, Lock, Refresh, ArrowLeft, Message, Key, Cellphone } from "@element-plus/icons-vue";
import { useAuthStore } from "@/stores/auth";
import { useSiteStore } from "@/stores/site";
import { clearCreds, loadCreds, hasCreds } from "@/utils/credCrypto";
import { resolveSafeRedirect } from "@/utils/redirect";
import PrivacyPolicyNotice from "@/components/common/PrivacyPolicyNotice.vue";

const router = useRouter();
const route = useRoute();
const auth = useAuthStore();
const site = useSiteStore();
const formRef = ref<FormInstance>();
const remember = ref(false);
const savedCredsPresent = ref(hasCreds());
const isDev = computed(() => import.meta.env.DEV);
const reconnectSource = computed(() => (
  typeof route.query.reconnect === "string" ? route.query.reconnect : ""
));
const reconnectMode = computed(() => ["ehall", "ebridge", "school"].includes(reconnectSource.value));
const reconnectReturnLabel = computed(() => (
  reconnectSource.value === "ebridge" ? "返回教务页" : reconnectMode.value ? "返回服务页" : "返回首页"
));
const captchaRefreshing = ref(false);
const sliderValue = ref(0);
const sliderChecking = ref(false);
const sliderMetrics = reactive({ sourceWidth: 0, sourceHeight: 0, puzzleWidth: 0 });
const selectedMfaType = ref<"" | "email" | "otp" | "sms">("");
const mfaCode = ref("");
const mfaPassword = ref("");
const mfaCooldown = ref(0);
let mfaCooldownTimer: ReturnType<typeof setInterval> | null = null;

const selectedMfaMethod = computed(() => (
  auth.ssoMfa?.methods.find((method) => method.type === selectedMfaType.value) ?? null
));

const sliderPuzzleStyle = computed<CSSProperties>(() => {
  const challenge = auth.ssoVerification;
  if (challenge?.type !== "slider" || !sliderMetrics.sourceWidth || !sliderMetrics.sourceHeight) {
    return { visibility: "hidden" };
  }
  const puzzleRatio = sliderMetrics.puzzleWidth / sliderMetrics.sourceWidth;
  const progress = sliderValue.value / 1000;
  return {
    visibility: "visible",
    width: `${puzzleRatio * 100}%`,
    top: `${(challenge.y / sliderMetrics.sourceHeight) * 100}%`,
    left: `${progress * (1 - puzzleRatio) * 100}%`,
  };
});

const form = reactive({ username: "", password: "", captcha: "" });
const rules: FormRules = {
  username: [{ required: true, message: "请输入学校账号" }],
  password: [{ required: true, message: "请输入密码" }],
};

const dev = reactive({ username: "", password: "", loading: false });

const loginHint = computed(() => {
  if (reconnectMode.value) {
    return "站内账号仍保持登录；重新完成一次 XJTLU 学校认证，用于恢复融合门户与 eBridge 会话。";
  }
  const uses: string[] = [];
  if (site.features.forum) uses.push("发帖");
  uses.push("消息通知");
  return `完成 XJTLU 统一认证后会自动创建站内账号，可用于${uses.join("、")}，并同步建立融合门户与 eBridge 教务会话。`;
});

onMounted(async () => {
  if (auth.isLoggedIn && !reconnectMode.value) {
    router.replace(redirectTarget());
    return;
  }
  // 初始化 XJTLU ParaSSO 会话并取得一次性加密公钥。
  // 失败时显式回显，避免移动端用户看到一个能填但提交失败的表单
  try {
    await auth.ssoBegin();
  } catch (e: any) {
    auth.ssoError = "XJTLU 统一认证暂时不可用，请稍后再试。";
  }
  // 已保存凭据时静默恢复；遇到验证码或二步认证则停留在当前页让用户继续完成。
  let justLoggedOut = false;
  try {
    justLoggedOut = sessionStorage.getItem("xjtlu-just-logged-out") === "1";
    if (justLoggedOut) sessionStorage.removeItem("xjtlu-just-logged-out");
  } catch { /* ignore */ }
  if (!justLoggedOut && hasCreds() && !auth.ssoError) {
    const creds = await loadCreds().catch(() => null);
    if (creds && !auth.ssoNeedCaptcha) {
      ElMessage.info("正在恢复学校登录…");
      const ok = await auth.ssoLogin(creds.username, creds.password, undefined, true);
      if (ok) {
        ElMessage.success(loginSuccessMessage(auth.user?.nickname || creds.username));
        router.replace(redirectTarget());
      } else if (auth.ssoVerification || auth.ssoMfa) {
        form.username = creds.username;
        form.password = creds.password;
        remember.value = true;
      }
    }
  }
});

onBeforeUnmount(clearMfaCooldown);

async function reloadCaptcha() {
  if (auth.ssoLoading || captchaRefreshing.value) return;
  if (auth.ssoMfa) {
    auth.ssoError = "请重新提交二次认证验证码以刷新安全验证";
    return;
  }
  captchaRefreshing.value = true;
  try {
    await auth.ssoBegin();
  } catch {
    auth.ssoError = "统一认证暂时不可用，请稍后再试";
  } finally {
    captchaRefreshing.value = false;
  }
  form.captcha = "";
}

function clearMfaCooldown() {
  if (mfaCooldownTimer) clearInterval(mfaCooldownTimer);
  mfaCooldownTimer = null;
  mfaCooldown.value = 0;
}

function startMfaCooldown(seconds: number) {
  clearMfaCooldown();
  mfaCooldown.value = Math.max(1, seconds);
  mfaCooldownTimer = setInterval(() => {
    mfaCooldown.value -= 1;
    if (mfaCooldown.value <= 0) clearMfaCooldown();
  }, 1000);
}

function selectMfaMethod(type: "email" | "otp" | "sms") {
  selectedMfaType.value = type;
  mfaCode.value = "";
  mfaPassword.value = "";
  form.captcha = "";
  auth.ssoError = "";
  clearMfaCooldown();
}

async function sendMfaCode() {
  const method = selectedMfaMethod.value;
  if (!method || method.type === "otp" || mfaCooldown.value > 0) return;
  const result = await auth.sendSsoMfaCode(method.type);
  if (!result.ok) return;
  startMfaCooldown(result.cooldownSeconds || method.cooldownSeconds || 60);
  ElMessage.success(method.type === "email" ? "验证码已发送到绑定邮箱" : "验证码已发送到绑定手机");
}

async function restartPrimaryLogin() {
  clearMfaCooldown();
  selectedMfaType.value = "";
  mfaCode.value = "";
  mfaPassword.value = "";
  form.password = "";
  form.captcha = "";
  await auth.ssoBegin();
}

async function onMfaSubmit() {
  const method = selectedMfaMethod.value;
  if (!method) {
    ElMessage.warning("请选择一种二次认证方式");
    return;
  }
  if (method.codeRequired && !mfaCode.value.trim()) {
    ElMessage.warning(method.type === "otp" ? "请输入动态口令 OTP" : "请输入验证码");
    return;
  }
  if (method.passwordRequired && !mfaPassword.value) {
    ElMessage.warning("该认证方式还需要输入 XJTLU 密码");
    return;
  }
  if (auth.ssoNeedCaptcha && !form.captcha) {
    ElMessage.warning("请输入图片安全验证码");
    return;
  }
  const ok = await auth.verifySsoMfa(
    method.type,
    mfaCode.value.trim(),
    method.passwordRequired ? mfaPassword.value : undefined,
    form.captcha || undefined,
    remember.value,
    form.username,
    form.password,
  );
  if (!ok) {
    if (auth.ssoNeedCaptcha) form.captcha = "";
    return;
  }
  clearMfaCooldown();
  form.password = "";
  mfaPassword.value = "";
  mfaCode.value = "";
  savedCredsPresent.value = hasCreds();
  ElMessage.success(loginSuccessMessage(auth.user?.nickname || form.username));
  router.replace(redirectTarget());
}

function onSliderSourceLoad(event: Event) {
  const image = event.currentTarget as HTMLImageElement;
  sliderMetrics.sourceWidth = image.naturalWidth;
  sliderMetrics.sourceHeight = image.naturalHeight;
  sliderValue.value = 0;
}

function onSliderPuzzleLoad(event: Event) {
  sliderMetrics.puzzleWidth = (event.currentTarget as HTMLImageElement).naturalWidth;
}

async function onSliderRelease() {
  const challenge = auth.ssoVerification;
  if (challenge?.type !== "slider" || sliderChecking.value || auth.ssoLoading) return;
  if (!sliderMetrics.sourceWidth || !sliderMetrics.puzzleWidth) {
    ElMessage.warning("验证码图片尚未加载完成，请稍候");
    return;
  }
  const maxX = Math.max(0, sliderMetrics.sourceWidth - sliderMetrics.puzzleWidth);
  const x = Math.round((sliderValue.value / 1000) * maxX);
  sliderChecking.value = true;
  try {
    const verified = await auth.verifySsoSlider(x);
    if (!verified) {
      sliderValue.value = 0;
      return;
    }
    ElMessage.success("安全验证通过，正在继续登录");
    if (auth.ssoMfa) await onMfaSubmit();
    else await onSubmit();
  } finally {
    sliderChecking.value = false;
  }
}

function redirectTarget() {
  return resolveSafeRedirect(route.query.redirect);
}

function loginSuccessMessage(name: string) {
  return reconnectMode.value ? "学校服务已重新连接" : `欢迎，${name}`;
}

function goHome() {
  router.replace(reconnectMode.value ? redirectTarget() : "/home");
}

async function onSubmit() {
  if (auth.ssoMfa) return onMfaSubmit();
  if (auth.ssoLoading || captchaRefreshing.value) return;
  try { await formRef.value?.validate(); } catch { return; }
  if (auth.ssoNeedCaptcha && !form.captcha) {
    ElMessage.warning("请输入验证码");
    return;
  }
  if (auth.ssoVerification?.type === "slider" && !auth.ssoVerificationToken) {
    ElMessage.warning("请先完成滑块安全验证");
    return;
  }
  let ok = false;
  try {
    ok = await auth.ssoLogin(form.username, form.password, form.captcha || undefined, remember.value);
  } catch {
    return; // API 拦截器已展示错误
  }
  if (ok) {
    savedCredsPresent.value = hasCreds();
    ElMessage.success(loginSuccessMessage(auth.user?.nickname || form.username));
    router.replace(redirectTarget());
  } else if (auth.ssoNeedCaptcha) {
    form.captcha = "";
  }
}

function forgetSavedCreds() {
  clearCreds();
  savedCredsPresent.value = false;
  remember.value = false;
  ElMessage.success("已清除当前设备保存的登录信息");
}

function fillDev(u: string, p: string) {
  dev.username = u;
  dev.password = p;
}

async function onDevSubmit() {
  if (dev.loading) return;
  if (!dev.username || !dev.password) {
    ElMessage.warning("请填写账号和密码");
    return;
  }
  dev.loading = true;
  try {
    await auth.login(dev.username, dev.password);
    ElMessage.success(`欢迎，${auth.user?.nickname}`);
    router.replace(redirectTarget());
  } catch { /* 拦截器已提示 */ }
  finally { dev.loading = false; }
}
</script>

<style scoped lang="scss">
.auth-wrap {
  min-height: 100vh;
  min-height: 100dvh;
  display: grid;
  place-items: center;
  background:
    radial-gradient(circle at top right, rgba(20, 184, 166, 0.16), transparent 34%),
    linear-gradient(135deg, var(--cpu-bg), var(--cpu-surface));
  padding: 20px;
}

.auth-card {
  width: 440px;
  max-width: 100%;
  background: var(--cpu-card);
  border: 1px solid var(--cpu-border-soft);
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

.brand h1 { margin: 0; font-size: 20px; color: var(--cpu-primary); }
.brand p { margin: 2px 0 0; font-size: 12px; color: var(--cpu-text-secondary); }

.welcome { font-size: 18px; color: var(--cpu-text); margin: 6px 0 4px; font-weight: 600; }
.welcome strong { color: var(--cpu-primary); }
.hint { font-size: 13px; color: var(--cpu-text-secondary); margin: 0 0 14px; line-height: 1.6; }
.identity-picker { margin-bottom: 14px; }

.safety { margin-bottom: 14px; font-size: 12px; }
.safety b { color: #b45309; }

.mfa-form-item :deep(.el-form-item__content) { display: block; }
.mfa-panel {
  width: 100%;
  padding: 18px;
  border: 1px solid var(--cpu-border);
  border-radius: 14px;
  background: var(--cpu-surface-soft);
  box-shadow: var(--cpu-shadow-sm);
}
.brand-logo img { width: 100%; height: 100%; object-fit: cover; border-radius: inherit; }
.mfa-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.mfa-head div { display: grid; gap: 3px; }
.mfa-head strong { color: var(--cpu-text); font-size: 16px; }
.mfa-head span { color: var(--cpu-text-secondary); font-size: 12px; line-height: 1.45; }
.mfa-head .mfa-kicker {
  width: fit-content;
  margin-bottom: 3px;
  padding: 3px 7px;
  border-radius: 999px;
  background: var(--cpu-primary-soft);
  color: var(--cpu-primary);
  font-size: 11px;
  font-weight: 700;
}
.mfa-title { margin: 18px 0 10px; color: var(--cpu-text); font-size: 14px; font-weight: 700; }
.mfa-methods { display: grid; grid-template-columns: repeat(3, 1fr); gap: 9px; }
.mfa-method {
  min-width: 0;
  min-height: 96px;
  padding: 12px 6px 10px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 11px;
  background: var(--cpu-card);
  color: var(--cpu-text);
  cursor: pointer;
  display: grid;
  justify-items: center;
  gap: 7px;
  font: inherit;
  font-size: 12px;
  transition: border-color .18s ease, background .18s ease, transform .18s ease, box-shadow .18s ease;
}
.mfa-method:hover { border-color: var(--cpu-primary); transform: translateY(-1px); box-shadow: var(--cpu-shadow-sm); }
.mfa-method.active { border-color: var(--cpu-primary); background: var(--cpu-primary-soft); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--cpu-primary) 24%, transparent); }
.mfa-method:disabled { cursor: wait; opacity: 0.65; }
.mfa-method-icon {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  background: var(--cpu-primary-soft);
  color: var(--cpu-primary);
  font-size: 19px;
  line-height: 1;
}
.mfa-method.active .mfa-method-icon { background: var(--cpu-primary); color: var(--cpu-card); }
.mfa-entry { display: grid; gap: 10px; margin-top: 14px; }
.mfa-destination { margin: 0; padding: 9px 10px; border-radius: 8px; background: var(--cpu-primary-soft); color: var(--cpu-text-secondary); font-size: 12px; }
.mfa-actions { display: flex; justify-content: flex-end; gap: 8px; }
.mfa-actions :deep(.el-button) { flex: 1; margin-left: 0; }

:global(html[data-theme="dark"]) .mfa-panel {
  background: color-mix(in srgb, var(--cpu-surface-soft) 88%, var(--cpu-card));
  border-color: rgba(163, 186, 179, 0.26);
}
:global(html[data-theme="dark"]) .mfa-method { background: var(--cpu-surface); }
:global(html[data-theme="dark"]) .mfa-method.active { background: var(--cpu-primary-soft); }

.btn-submit { width: 100%; letter-spacing: 4px; }

.vcode-row { display: flex; gap: 8px; align-items: center; }
.vcode-img-button {
  height: 38px;
  min-width: 112px;
  border: 1px solid var(--cpu-border);
  border-radius: 5px;
  background: var(--cpu-card);
  display: grid;
  place-items: center;
  padding: 0;
  cursor: pointer;
  overflow: hidden;
}

.vcode-img {
  height: 36px;
  max-width: 112px;
  object-fit: contain;
  display: block;
}

.vcode-img-button:disabled {
  cursor: not-allowed;
  opacity: 0.62;
}

.vcode-img-button:focus-visible {
  outline: 2px solid var(--cpu-primary);
  outline-offset: 2px;
}

.slider-form-item :deep(.el-form-item__content) { display: block; }
.slider-challenge {
  width: 100%;
  padding: 12px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 10px;
  background: var(--cpu-surface-subtle);
}
.slider-heading {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 9px;
  color: var(--cpu-text);
  font-size: 13px;
  font-weight: 600;
}
.slider-heading span:last-child:not(:first-child) { color: var(--cpu-primary); font-weight: 500; }
.slider-picture {
  position: relative;
  width: 100%;
  overflow: hidden;
  border-radius: 8px;
  background: #dbe4e1;
  line-height: 0;
}
.slider-source { display: block; width: 100%; height: auto; }
.slider-puzzle {
  position: absolute;
  z-index: 1;
  height: auto;
  pointer-events: none;
  filter: drop-shadow(0 2px 3px rgba(15, 23, 42, 0.35));
}
.slider-range {
  width: 100%;
  margin: 12px 0 2px;
  accent-color: var(--cpu-primary);
  cursor: ew-resize;
}
.slider-range:disabled { cursor: wait; opacity: 0.62; }
.slider-tip { margin: 0; color: var(--cpu-text-secondary); font-size: 12px; line-height: 1.5; }

.dev-fallback {
  margin-top: 18px;
  padding: 10px 14px;
  background: var(--cpu-surface-subtle);
  border-radius: 8px;
  border: 1px dashed var(--cpu-border);
}
.dev-fallback summary {
  cursor: pointer;
  font-size: 12px;
  color: #9ca3af;
  user-select: none;
}
.dev-tip { font-size: 11px; color: #b45309; margin: 8px 0; }
.dev-form { display: flex; gap: 6px; flex-direction: column; margin-top: 8px; }
.dev-accounts {
  font-size: 11px;
  color: var(--cpu-primary);
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 6px;
}
.dev-accounts button {
  border: 0;
  background: transparent;
  padding: 0;
  color: var(--cpu-primary);
  font: inherit;
  cursor: pointer;
  text-decoration: underline;
}

.dev-accounts button:focus-visible {
  outline: 2px solid var(--cpu-primary);
  outline-offset: 2px;
  border-radius: 4px;
}

.alt-actions {
  display: flex;
  justify-content: center;
  gap: 8px;
  margin-top: 14px;
  color: #cbd5e1;
  font-size: 12px;
}

.alt-actions button {
  border: none;
  background: none;
  padding: 0;
  color: var(--cpu-primary);
  font: inherit;
  cursor: pointer;
}

.alt-actions .muted-note {
  color: #9ca3af;
}

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

  .welcome {
    font-size: 17px;
  }

  .vcode-row {
    gap: 6px;
  }

  .vcode-img {
    max-width: 108px;
  }
}
</style>
