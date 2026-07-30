<template>
  <el-config-provider :locale="elementLocale" :z-index="5000">
    <router-view />
    <el-dialog
      v-model="dataAuthOpen"
      :title="isEnglish ? 'XJTLU identity sign-in notice' : 'XJTLU 身份登录说明'"
      width="480"
      class="data-auth-dialog"
      append-to-body
      :close-on-click-modal="false"
      :close-on-press-escape="false"
      :show-close="false"
    >
      <div class="data-auth">
        <div class="auth-head">
          <el-tag size="small" type="warning" effect="plain">{{ locale.t("app.firstUse") }}</el-tag>
          <span class="auth-sub">{{ locale.t("app.readFirst") }}</span>
        </div>
        <p>
          {{ isEnglish
            ? "You are signing in with XJTLU authentication. This version verifies only your university identity and does not read your timetable, grades, exams, or programme data."
            : "你正在使用 XJTLU 统一身份认证登录本站。当前版本只验证学校身份，不读取课表、成绩、考试或培养方案。" }}
        </p>
        <p>
          {{ isEnglish
            ? "Your university password and verification codes are not stored by this site. If you choose to remember your credentials, they are encrypted and kept only in this browser. Do not use this option on a shared device."
            : "学校密码和验证码不会保存到本站；如勾选“记住登录信息”，学校账号和密码也只会保存在当前设备浏览器中，不会上传到本站。请勿在公共设备上使用。" }}
        </p>
        <p>
          {{ isEnglish
            ? "By continuing, you confirm that you understand this notice."
            : "继续点击同意，表示你已了解以上说明。" }}
        </p>
      </div>
      <template #footer>
        <div class="data-auth-footer">
          <span class="read-hint">{{ locale.t("app.readSeconds", { seconds: dataAuthReadSeconds }) }}</span>
          <el-button type="primary" :disabled="dataAuthReadSeconds > 0" @click="acceptDataAuth">
            {{ dataAuthReadSeconds > 0 ? locale.t("app.readSeconds", { seconds: dataAuthReadSeconds }) : locale.t("app.agree") }}
          </el-button>
        </div>
      </template>
    </el-dialog>
    <el-dialog
      v-model="strongNoticeOpen"
      :title="locale.t('app.strongNotice')"
      width="420"
      class="strong-notice-dialog"
      append-to-body
      :close-on-click-modal="false"
      :close-on-press-escape="false"
      :show-close="false"
    >
      <div v-if="currentStrongNotice" class="strong-notice">
        <div class="strong-notice-head">
          <el-tag size="small" type="danger" effect="plain">{{ locale.t("app.strongNotice") }}</el-tag>
          <span class="strong-notice-source">{{ currentStrongNotice.source || locale.t("app.siteTeam") }}</span>
        </div>
        <h3 class="strong-notice-title">{{ currentStrongNotice.title }}</h3>
        <div class="strong-notice-content">{{ currentStrongNotice.content }}</div>
        <div v-if="currentStrongNotice.link" class="strong-notice-link">
          <span>{{ isEnglish ? "Related link:" : "相关链接：" }}</span>
          <a :href="currentStrongNotice.link" target="_blank" rel="noopener noreferrer">{{ currentStrongNotice.link }}</a>
        </div>
      </div>
      <template #footer>
        <div class="strong-notice-footer">
          <el-button
            v-if="currentStrongNotice?.link"
            plain
            type="primary"
            :disabled="strongNoticeReadSeconds > 0"
            @click="openStrongNoticeLink"
          >
            {{ locale.t("app.details") }}
          </el-button>
          <el-button type="primary" :disabled="strongNoticeReadSeconds > 0" @click="ackStrongNotice">
            {{ strongNoticeReadSeconds > 0 ? locale.t("app.readSeconds", { seconds: strongNoticeReadSeconds }) : locale.t("app.understood") }}
          </el-button>
        </div>
      </template>
    </el-dialog>
    <el-dialog
      v-model="inAppTipOpen"
      :title="locale.t('app.externalBrowser')"
      width="420"
      class="in-app-tip-dialog"
      append-to-body
      :close-on-click-modal="inAppReadSeconds <= 0"
      :close-on-press-escape="inAppReadSeconds <= 0"
      :show-close="inAppReadSeconds <= 0"
    >
      <div class="in-app-tip">
        <p>
          {{ isEnglish
            ? `This site appears to be open inside ${inAppBrowserLabel}. Some university systems, authentication pages, or external links may not load correctly.`
            : `当前可能正在${inAppBrowserLabel}内打开本站。部分学校系统、统一认证或外部跳转页面可能无法正常加载。` }}
        </p>
        <p>
          {{ isEnglish
            ? "Use the menu in the top-right corner and choose “Open in browser” or “Open in default browser”."
            : "建议点击右上角菜单，选择“在浏览器打开”或“用默认浏览器打开”后继续使用。" }}
        </p>
        <p class="muted">
          {{ isEnglish
            ? "You can continue here if you only need to browse content on this site."
            : "如果只是浏览站内内容，也可以继续使用当前页面。" }}
        </p>
      </div>
      <template #footer>
        <el-button type="primary" :disabled="inAppReadSeconds > 0" @click="dismissInAppTip">
          {{ inAppReadSeconds > 0 ? locale.t("app.readSeconds", { seconds: inAppReadSeconds }) : locale.t("app.understood") }}
        </el-button>
      </template>
    </el-dialog>
  </el-config-provider>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import zhCn from "element-plus/es/locale/lang/zh-cn";
import en from "element-plus/es/locale/lang/en";
import { ElMessage } from "element-plus";
import { useAuthStore } from "@/stores/auth";
import { useMessageStore } from "@/stores/message";
import { router } from "@/router";
import { messageApi } from "@/api/message";
import { AUTH_EXPIRED_EVENT } from "@/api/request";
import { detectInAppBrowser } from "@/utils/inAppBrowser";
import {
  isExternalNotificationLink,
  safeNotificationLink,
} from "@/utils/notificationLink";
import { useLocale } from "@/i18n";

const auth = useAuthStore();
const msg = useMessageStore();
const locale = useLocale();
const isEnglish = locale.isEnglish;
const elementLocale = computed(() => isEnglish.value ? en : zhCn);
const dataAuthOpen = ref(false);
const dataAuthReadSeconds = ref(0);
const inAppTipOpen = ref(false);
const inAppBrowserLabel = ref("微信 / QQ");
const inAppReadSeconds = ref(0);
let inAppReadTimer: number | null = null;
let dataAuthTimer: number | null = null;

type NoticeRow = {
  id: number;
  title: string;
  content: string;
  link?: string | null;
  source?: string | null;
  level?: string;
  readAt?: string | null;
  createdAt?: string;
};

const strongNoticeQueue = ref<NoticeRow[]>([]);
const strongNoticeOpen = ref(false);
const strongNoticeReadSeconds = ref(0);
let strongNoticeTimer: number | null = null;
let strongNoticePoller: number | null = null;
let strongNoticeLoading = false;
let pendingStrongNoticeOpen = false;
let strongNoticeLoadSeq = 0;
let disposed = false;

const currentStrongNotice = computed(() => strongNoticeQueue.value[0] ?? null);

onMounted(() => {
  disposed = false;
  window.addEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
  if (isSchedulePage()) return;
  const info = detectInAppBrowser();
  if (!info.isInApp) return;
  inAppBrowserLabel.value = info.label;
  inAppTipOpen.value = true;
});

watch(inAppTipOpen, (open) => {
  if (open) startInAppReadTimer();
  else {
    clearInAppReadTimer();
    if (auth.needDataAuthAgreement && !dataAuthOpen.value) {
      openDataAuth();
    }
    if (strongNoticeQueue.value.length && !strongNoticeOpen.value) {
      requestStrongNoticeOpen();
    }
  }
});

onBeforeUnmount(() => {
  disposed = true;
  strongNoticeLoadSeq += 1;
  strongNoticeLoading = false;
  window.removeEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
  clearInAppReadTimer();
  clearDataAuthTimer();
  clearStrongNoticeTimer();
  clearStrongNoticePoller();
});

function handleAuthExpired() {
  auth.expireSession();
  strongNoticeLoadSeq += 1;
  strongNoticeLoading = false;
  dataAuthOpen.value = false;
  strongNoticeOpen.value = false;
  strongNoticeQueue.value = [];
  pendingStrongNoticeOpen = false;
  clearDataAuthTimer();
  clearStrongNoticeTimer();
  clearStrongNoticePoller();
}

function dismissInAppTip() {
  if (inAppReadSeconds.value > 0) return;
  inAppTipOpen.value = false;
}

function isSchedulePage() {
  return window.location.pathname.replace(/\/+$/, "") === "/schedule";
}

function startInAppReadTimer() {
  clearInAppReadTimer();
  inAppReadSeconds.value = 1;
  inAppReadTimer = window.setInterval(() => {
    inAppReadSeconds.value -= 1;
    if (inAppReadSeconds.value <= 0) {
      clearInAppReadTimer();
    }
  }, 1000);
}

function clearInAppReadTimer() {
  if (inAppReadTimer) {
    window.clearInterval(inAppReadTimer);
    inAppReadTimer = null;
  }
  if (!inAppTipOpen.value) inAppReadSeconds.value = 0;
}

watch(
  () => [auth.token, auth.user?.id, auth.needDataAuthAgreement],
  () => {
    strongNoticeLoadSeq += 1;
    strongNoticeLoading = false;
    if (auth.isLoggedIn) {
      if (auth.needDataAuthAgreement) {
        suspendStrongNotice();
        if (!inAppTipOpen.value) {
          openDataAuth();
        } else {
          dataAuthOpen.value = false;
          clearDataAuthTimer();
        }
        clearStrongNoticeTimer();
        clearStrongNoticePoller();
      } else {
        void loadStrongNotices();
        startStrongNoticePoller();
      }
    } else {
      dataAuthOpen.value = false;
      clearDataAuthTimer();
      strongNoticeQueue.value = [];
      strongNoticeOpen.value = false;
      pendingStrongNoticeOpen = false;
      clearStrongNoticeTimer();
      clearStrongNoticePoller();
    }
  },
  { immediate: true }
);

watch(dataAuthOpen, async (open) => {
  if (open) {
    suspendStrongNotice();
    return;
  }
  await nextTick();
  if (disposed) return;
  requestStrongNoticeOpen();
});

function openDataAuth() {
  if (inAppTipOpen.value) return;
  if (!auth.needDataAuthAgreement) return;
  dataAuthOpen.value = true;
  startDataAuthTimer();
}

function startDataAuthTimer() {
  clearDataAuthTimer();
  dataAuthReadSeconds.value = 6;
  dataAuthTimer = window.setInterval(() => {
    dataAuthReadSeconds.value -= 1;
    if (dataAuthReadSeconds.value <= 0) {
      clearDataAuthTimer();
    }
  }, 1000);
}

function clearDataAuthTimer() {
  if (dataAuthTimer) {
    window.clearInterval(dataAuthTimer);
    dataAuthTimer = null;
  }
  if (!dataAuthOpen.value) dataAuthReadSeconds.value = 0;
}

async function acceptDataAuth() {
  if (dataAuthReadSeconds.value > 0) return;
  await auth.acceptDataAuthAgreement();
  if (disposed) return;
  dataAuthOpen.value = false;
  clearDataAuthTimer();
  await nextTick();
  if (disposed) return;
  requestStrongNoticeOpen();
}

async function loadStrongNotices() {
  if (disposed || !auth.isLoggedIn || auth.needDataAuthAgreement || strongNoticeLoading) return;
  const seq = ++strongNoticeLoadSeq;
  strongNoticeLoading = true;
  try {
    const list = await messageApi.list("system").catch(() => []);
    if (disposed || seq !== strongNoticeLoadSeq || !auth.isLoggedIn || auth.needDataAuthAgreement) return;
    strongNoticeQueue.value = (list as NoticeRow[])
      .filter((n) => n.level === "strong" && !n.readAt)
      .sort((a, b) => (new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()));
    requestStrongNoticeOpen();
  } finally {
    if (seq === strongNoticeLoadSeq) strongNoticeLoading = false;
  }
}

function openStrongNotice() {
  if (disposed) return;
  if (auth.needDataAuthAgreement) return;
  if (inAppTipOpen.value) return;
  if (!currentStrongNotice.value) return;
  strongNoticeOpen.value = true;
  startStrongNoticeTimer();
}

function requestStrongNoticeOpen() {
  if (disposed) return;
  if (!currentStrongNotice.value) {
    pendingStrongNoticeOpen = false;
    return;
  }
  if (auth.needDataAuthAgreement || inAppTipOpen.value || dataAuthOpen.value) {
    pendingStrongNoticeOpen = true;
    return;
  }
  if (strongNoticeOpen.value) {
    pendingStrongNoticeOpen = false;
    return;
  }
  pendingStrongNoticeOpen = false;
  openStrongNotice();
}

function suspendStrongNotice() {
  if (currentStrongNotice.value) {
    pendingStrongNoticeOpen = true;
  }
  if (strongNoticeOpen.value) {
    strongNoticeOpen.value = false;
    clearStrongNoticeTimer();
  }
}

function startStrongNoticeTimer() {
  clearStrongNoticeTimer();
  strongNoticeReadSeconds.value = 3;
  strongNoticeTimer = window.setInterval(() => {
    strongNoticeReadSeconds.value -= 1;
    if (strongNoticeReadSeconds.value <= 0) {
      clearStrongNoticeTimer();
    }
  }, 1000);
}

function clearStrongNoticeTimer() {
  if (strongNoticeTimer) {
    window.clearInterval(strongNoticeTimer);
    strongNoticeTimer = null;
  }
  if (!strongNoticeOpen.value) strongNoticeReadSeconds.value = 0;
}

function startStrongNoticePoller() {
  if (disposed || strongNoticePoller || !auth.isLoggedIn) return;
  strongNoticePoller = window.setInterval(() => {
    if (document.hidden) return;
    void loadStrongNotices();
  }, 60_000);
}

function clearStrongNoticePoller() {
  if (strongNoticePoller) {
    window.clearInterval(strongNoticePoller);
    strongNoticePoller = null;
  }
}

async function ackStrongNotice() {
  if (strongNoticeReadSeconds.value > 0) return;
  const current = currentStrongNotice.value;
  if (!current) return;
  try {
    await messageApi.read(current.id);
    if (disposed) return;
    msg.refresh();
    strongNoticeQueue.value.shift();
    if (strongNoticeQueue.value.length) {
      strongNoticeOpen.value = false;
      await nextTick();
      requestStrongNoticeOpen();
    } else {
      strongNoticeOpen.value = false;
      pendingStrongNoticeOpen = false;
      clearStrongNoticeTimer();
    }
  } catch {
    ElMessage.error(isEnglish.value ? "Could not mark the notice as read. Please try again later." : "已读标记失败，请稍后重试");
  }
}

function openStrongNoticeLink() {
  const current = currentStrongNotice.value;
  const target = safeNotificationLink(current?.link);
  if (!target) return;
  if (!isExternalNotificationLink(target)) {
    router.push(target);
  } else {
    window.open(target, "_blank", "noopener,noreferrer");
  }
}
</script>

<style lang="scss">
html, body, #app {
  height: 100%;
  margin: 0;
}

.in-app-tip {
  color: #374151;
  font-size: 14px;
  line-height: 1.7;

  p {
    margin: 0 0 8px;
  }

  .muted {
    color: #6b7280;
    font-size: 13px;
  }
}

.data-auth {
  color: #374151;
  font-size: 14px;
  line-height: 1.8;
}

.auth-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.auth-sub {
  font-size: 12px;
  color: #9ca3af;
}

.data-auth p {
  margin: 0 0 10px;
}

.data-auth-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.read-hint {
  font-size: 12px;
  color: #9ca3af;
}

.strong-notice {
  color: #1f2937;
  font-size: 14px;
  line-height: 1.7;
}

.strong-notice-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.strong-notice-source {
  font-size: 12px;
  color: #9ca3af;
}

.strong-notice-title {
  margin: 0 0 10px;
  font-size: 18px;
  line-height: 1.45;
  color: #111827;
}

.strong-notice-content {
  white-space: pre-wrap;
  color: #374151;
  font-size: 14px;
}

.strong-notice-link {
  margin-top: 12px;
  font-size: 12px;
  color: #6b7280;
  word-break: break-all;
}

.strong-notice-link a {
  color: var(--cpu-primary);
}

.strong-notice-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
</style>
