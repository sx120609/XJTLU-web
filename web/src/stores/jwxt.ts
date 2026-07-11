import { defineStore } from "pinia";
import { jwxtApi, getJwxtToken, clearJwxtToken, JWXT_AUTH_EXPIRED_EVENT } from "@/api/jwxt";
import { clearCreds } from "@/utils/credCrypto";
import { useAuthStore } from "@/stores/auth";
import { clearJwxtDataCaches } from "@/utils/jwxtCache";

let authExpiredListenerInstalled = false;

/**
 * XJTLU 教务接口尚未接入。本 store 暂时保留数据页所需状态，但所有旧 CPU
 * 教务登录入口均明确禁用，避免把 XJTLU 凭据发送到错误的学校系统。
 */
export const useJwxtStore = defineStore("jwxt", {
  state: () => ({
    token: "",
    active: false,
    autoLoginTried: false,
    rememberSaved: false,
  }),
  getters: {
    isLoggedIn: (s) => s.active && !!s.token,
    // 把 auth store 的 SSO 流程态代理出来，供模板 v-if / v-model 直接绑定
    error(): string {
      return useAuthStore().ssoError;
    },
    loading(): boolean {
      return useAuthStore().ssoLoading;
    },
    needCaptcha(): boolean {
      return useAuthStore().ssoNeedCaptcha;
    },
    captchaImage(): string {
      return useAuthStore().ssoCaptchaImage;
    },
    pendingId(): string {
      return useAuthStore().ssoPendingId;
    },
    isGraduateIdentity(): boolean {
      return useAuthStore().academicIdentity === "graduate";
    },
  },
  actions: {
    hydrate() {
      clearJwxtToken();
      clearJwxtDataCaches();
      this.token = "";
      this.active = false;
      this.rememberSaved = false;
      if (!authExpiredListenerInstalled) {
        authExpiredListenerInstalled = true;
        window.addEventListener(JWXT_AUTH_EXPIRED_EVENT, () => {
          const store = useJwxtStore();
          store.token = "";
          store.active = false;
          store.autoLoginTried = false;
        });
      }
    },
    async refreshStatus() {
      if (!this.token) {
        this.active = false;
        return;
      }
      try {
        const auth = useAuthStore();
        if (auth.token && !auth.user) await auth.fetchMe();
        const r = await jwxtApi.status({ silent: true });
        const currentUsername = auth.user?.username;
        if (r.username && currentUsername && r.username !== currentUsername) {
          clearJwxtToken();
          clearJwxtDataCaches();
          this.token = "";
          this.active = false;
          return;
        }
        this.active = r.active;
        if (!r.active) {
          clearJwxtToken();
          clearJwxtDataCaches();
          this.token = "";
        } else {
          await auth.detectAcademicIdentity({
            force: true,
            silent: true,
            fallback: auth.academicIdentity,
          });
          void this.refreshWidgetTokens();
        }
      } catch {
        this.active = false;
        if (!getJwxtToken()) {
          this.token = "";
          this.autoLoginTried = false;
        }
      }
    },
    async beginLogin() {
      const auth = useAuthStore();
      auth.ssoNeedCaptcha = false;
      auth.ssoCaptchaImage = "";
      auth.ssoError = "XJTLU 教务数据功能尚未接入";
    },
    /**
     * 提交账号密码：走 auth.ssoLogin —— 一次同时完成站内登录 + 教务授权
     */
    async submitLogin(
      _username: string,
      _password: string,
      _captcha: string | undefined,
      _remember: boolean,
    ): Promise<boolean> {
      const auth = useAuthStore();
      auth.ssoError = "XJTLU 教务数据功能尚未接入";
      return false;
    },
    /** 用本地保存的账号悄悄走一遍统一登录 */
    async tryAutoLogin(options?: { force?: boolean }): Promise<boolean> {
      if (this.autoLoginTried && !options?.force) return false;
      this.autoLoginTried = true;
      return false;
    },
    async refreshWidgetTokens() {
      if (!this.token || !this.active || !useAuthStore().isLoggedIn) return;
      try { await jwxtApi.refreshScheduleWidgetTokens({ silent: true }); }
      catch { /* 小组件续期是兜底能力，不影响主流程 */ }
    },
    forgetSavedCreds() {
      clearCreds();
      this.rememberSaved = false;
    },
    async logout() {
      try { await jwxtApi.logout(); } catch { /* ignore */ }
      clearJwxtToken();
      clearJwxtDataCaches();
      this.token = "";
      this.active = false;
      // 注意：默认不删 saved creds，下次还能自动登录
      // 站内会话由 useAuthStore().logout() 单独处理（这里不动）
    },
  },
});
