import { defineStore } from "pinia";
import {
  authApi,
  type UserInfo,
  type RegisterPayload,
  type XjtluVerificationChallenge,
  type XjtluMfaChallenge,
  type XjtluMfaMethodType,
} from "@/api/auth";
import { clearToken, COOKIE_SESSION_MARKER, getToken, hasAuthPresence, setToken } from "@/api/request";
import { jwxtApi, clearJwxtToken } from "@/api/jwxt";
import { clearCreds, saveCreds } from "@/utils/credCrypto";
import { clearJwxtDataCaches, purgeLegacySensitiveJwxtCaches } from "@/utils/jwxtCache";
import {
  academicIdentityLabel,
  clearAcademicIdentity,
  DEFAULT_ACADEMIC_IDENTITY,
  readAcademicIdentity,
  writeAcademicIdentity,
  type AcademicIdentity,
} from "@/utils/academicIdentity";
import { applyAccountLocale, getActiveLocale } from "@/i18n";

const DATA_AUTH_KEY_PREFIX = "cpu-data-auth-agreement-v1";

function authText(chinese: string, english: string) {
  return getActiveLocale() === "en-US" ? english : chinese;
}

function ssoErrorText(value: string | null | undefined, englishFallback: string) {
  if (getActiveLocale() === "zh-CN") return value || "登录失败";
  return value && !/[\u3400-\u9fff]/u.test(value) ? value : englishFallback;
}

function dataAuthKey(username: string) {
  return `${DATA_AUTH_KEY_PREFIX}:${username}`;
}

function readDataAuthAgreement(username?: string | null) {
  if (!username) return false;
  try {
    return localStorage.getItem(dataAuthKey(username)) !== null;
  } catch {
    return false;
  }
}

function writeDataAuthAgreement(username?: string | null) {
  if (!username) return;
  try {
    localStorage.setItem(dataAuthKey(username), String(Date.now()));
  } catch {
    /* ignore */
  }
}

export const useAuthStore = defineStore("auth", {
  state: () => {
    const storedIdentity = readAcademicIdentity();
    return ({
    user: null as UserInfo | null,
    token: "",
    academicIdentity: storedIdentity ?? DEFAULT_ACADEMIC_IDENTITY,
    academicIdentityResolved: Boolean(storedIdentity),
    academicIdentityDetecting: false,
    ready: false,
    dataAuthAgreed: false,
    /** SSO 登录流程的临时状态 */
    ssoPendingId: "",
    ssoNeedCaptcha: false,
    ssoCaptchaImage: "",
    ssoVerification: null as XjtluVerificationChallenge | null,
    ssoVerificationToken: "",
    ssoMfa: null as XjtluMfaChallenge | null,
    ssoError: "",
    ssoLoading: false,
    _pendingFetchMe: null as Promise<void> | null,
    _pendingIdentityDetection: null as Promise<AcademicIdentity> | null,
  });
  },
  getters: {
    isLoggedIn: (s) => !!s.token && !!s.user,
    nickname: (s) => s.user?.nickname ?? "",
    isAdmin: (s) => s.user?.role === "admin",
    isMod: (s) => s.user?.role === "admin" || s.user?.role === "mod",
    canAccessForum: (s) => !!s.user && s.user.status !== "banned",
    needSetupNickname: (s) => !!s.user && (!s.user.nickname || s.user.nickname.trim() === ""),
    // 当前只做身份登录，不读取教务数据，因此不显示旧教务数据授权门槛。
    needDataAuthAgreement: () => false,
    isGraduateIdentity: (s) => s.academicIdentity === "graduate",
    academicIdentityLabel: (s) => academicIdentityLabel(s.academicIdentity),
  },
  actions: {
    hydrate() {
      purgeLegacySensitiveJwxtCaches();
      const legacyToken = getToken();
      this.token = legacyToken || (hasAuthPresence() ? COOKIE_SESSION_MARKER : "");
      const storedIdentity = readAcademicIdentity();
      this.academicIdentity = storedIdentity ?? DEFAULT_ACADEMIC_IDENTITY;
      this.academicIdentityResolved = Boolean(storedIdentity);
    },

    setAcademicIdentity(identity: AcademicIdentity) {
      this.academicIdentity = identity;
      this.academicIdentityResolved = true;
      writeAcademicIdentity(identity);
    },

    clearAcademicIdentity() {
      this.academicIdentity = DEFAULT_ACADEMIC_IDENTITY;
      this.academicIdentityResolved = false;
      clearAcademicIdentity();
    },

    async detectAcademicIdentity(options?: { force?: boolean; silent?: boolean; fallback?: AcademicIdentity }) {
      if (!getToken() || !this.user?.studentSso) {
        return this.academicIdentity;
      }
      if (this.academicIdentityResolved && !options?.force) {
        return this.academicIdentity;
      }
      if (this._pendingIdentityDetection) return this._pendingIdentityDetection;

      const fallback = options?.fallback ?? this.academicIdentity ?? DEFAULT_ACADEMIC_IDENTITY;
      const task = (async () => {
        this.academicIdentityDetecting = true;
        try {
          const result = await jwxtApi.identity({ silent: options?.silent ?? true });
          this.setAcademicIdentity(result.identity);
          return result.identity;
        } catch {
          this.academicIdentity = fallback;
          return fallback;
        } finally {
          this.academicIdentityDetecting = false;
          this._pendingIdentityDetection = null;
        }
      })();

      this._pendingIdentityDetection = task;
      return task;
    },

    syncDataAuthAgreement(user?: UserInfo | null) {
      if (user?.preferredLocale) applyAccountLocale(user.preferredLocale);
      if (user && user.studentSso) {
        this.dataAuthAgreed = Boolean(user.dataAuthAgreedAt) || readDataAuthAgreement(user.username);
      } else {
        this.dataAuthAgreed = false;
      }
    },

    async acceptDataAuthAgreement() {
      if (!this.user?.studentSso) {
        this.dataAuthAgreed = false;
        return;
      }
      writeDataAuthAgreement(this.user.username);
      try {
        const updated = await authApi.updateMe({ dataAuthAgreed: true } as any);
        this.user = updated;
      } catch {
        /* ignore */
      }
      this.dataAuthAgreed = true;
    },

    async login(username: string, password: string) {
      const { token, sessionAuthenticated, user } = await authApi.login({ username, password });
      clearJwxtToken();
      clearJwxtDataCaches();
      this.clearAcademicIdentity();
      const authToken = sessionAuthenticated ? COOKIE_SESSION_MARKER : (token || "");
      setToken(authToken); this.token = authToken; this.user = user; this.syncDataAuthAgreement(user); this.ready = true;
    },

    async register(p: RegisterPayload) {
      const { token, sessionAuthenticated, user } = await authApi.register(p);
      clearJwxtToken();
      clearJwxtDataCaches();
      this.clearAcademicIdentity();
      const authToken = sessionAuthenticated ? COOKIE_SESSION_MARKER : (token || "");
      setToken(authToken); this.token = authToken; this.user = user; this.syncDataAuthAgreement(user); this.ready = true;
    },

    async ssoBegin() {
      this.ssoLoading = true;
      this.ssoError = "";
      this.ssoVerification = null;
      this.ssoVerificationToken = "";
      this.ssoMfa = null;
      try {
        const r = await authApi.ssoBegin();
        this.ssoPendingId = r.pendingId;
        this.ssoNeedCaptcha = r.needCaptcha;
        this.ssoCaptchaImage = r.captchaImage ?? "";
      } finally { this.ssoLoading = false; }
    },

    /** XJTLU SSO 登录：验证学校身份并取得站内 JWT。 */
    async ssoLogin(username: string, password: string, verificationToken: string | undefined, remember: boolean): Promise<boolean> {
      this.ssoLoading = true;
      this.ssoError = "";
      try {
        if (this.ssoPendingId.trim().length < 8) {
          await this.ssoBegin();
          this.ssoLoading = true;
          if (this.ssoNeedCaptcha && !verificationToken) {
            this.ssoError = authText("登录会话已刷新，请输入验证码", "The sign-in session was refreshed. Enter the verification code.");
            return false;
          }
        }
        const r = await authApi.ssoLogin({
          pendingId: this.ssoPendingId,
          username,
          password,
          verificationToken: this.ssoVerification?.type === "slider"
            ? this.ssoVerificationToken || undefined
            : verificationToken,
          remember,
        });
        if (!r.ok || (!r.sessionAuthenticated && !r.siteToken) || !r.user) {
          this.ssoError = ssoErrorText(r.error, "XJTLU authentication could not be completed. Review your details and try again.");
          if (r.needVerification && r.verification) {
            this.applySsoVerification(r.verification);
            this.ssoError = "";
            if (r.needMfa && r.mfa) this.applySsoMfa(r.mfa);
          } else if (r.needMfa && r.mfa) {
            this.ssoVerification = null;
            this.ssoVerificationToken = "";
            this.ssoNeedCaptcha = false;
            this.ssoCaptchaImage = "";
            this.applySsoMfa(r.mfa);
            this.ssoError = "";
          } else {
            // 学校登录 pending 在提交后即失效；下次点击登录时先静默刷新。
            this.ssoPendingId = "";
            this.ssoVerification = null;
            this.ssoVerificationToken = "";
            this.ssoMfa = null;
          }
          return false;
        }
        const authToken = r.sessionAuthenticated ? COOKIE_SESSION_MARKER : (r.siteToken || "");
        setToken(authToken);
        this.token = authToken;
        this.user = r.user;
        this.syncDataAuthAgreement(r.user);
        this.ready = true;
        // XJTLU 项目不使用旧 CPU 教务会话。
        clearJwxtToken();
        clearJwxtDataCaches();
        if (remember) {
          try { await saveCreds(username, password); } catch { /* ignore */ }
        } else {
          clearCreds();
        }
        this.ssoNeedCaptcha = false;
        this.ssoCaptchaImage = "";
        this.ssoVerification = null;
        this.ssoVerificationToken = "";
        this.ssoMfa = null;
        this.ssoPendingId = "";
        this.clearAcademicIdentity();
        return true;
      } catch (error) {
        // 网络错误发生时服务端也可能已消费 pending，禁止下次复用不确定会话。
        this.ssoPendingId = "";
        this.ssoVerification = null;
        this.ssoVerificationToken = "";
        this.ssoMfa = null;
        throw error;
      } finally { this.ssoLoading = false; }
    },

    applySsoVerification(verification: XjtluVerificationChallenge) {
      this.ssoVerification = verification;
      this.ssoPendingId = verification.pendingId;
      this.ssoVerificationToken = "";
      this.ssoNeedCaptcha = verification.type === "image";
      this.ssoCaptchaImage = verification.type === "image" ? verification.image : "";
    },

    applySsoMfa(mfa: XjtluMfaChallenge) {
      this.ssoMfa = mfa;
      this.ssoPendingId = mfa.pendingId;
    },

    async verifySsoSlider(x: number): Promise<boolean> {
      const challenge = this.ssoVerification;
      if (!challenge || challenge.type !== "slider") return false;
      this.ssoLoading = true;
      this.ssoError = "";
      try {
        const result = await authApi.ssoSliderCheck({
          pendingId: challenge.pendingId,
          x,
          y: challenge.y,
          token: challenge.token,
        });
        if (result.ok && result.verificationToken) {
          this.ssoVerificationToken = result.verificationToken;
          return true;
        }
        this.ssoError = ssoErrorText(result.error, "Slider verification failed. Please try again.");
        if (result.verification) this.applySsoVerification(result.verification);
        return false;
      } finally {
        this.ssoLoading = false;
      }
    },

    async sendSsoMfaCode(method: "email" | "sms") {
      if (!this.ssoMfa) return { ok: false as const, error: authText("二次认证会话不存在", "The two-step verification session is unavailable.") };
      this.ssoLoading = true;
      this.ssoError = "";
      try {
        const result = await authApi.ssoMfaSend({ pendingId: this.ssoMfa.pendingId, method });
        if (!result.ok) this.ssoError = ssoErrorText(result.error, "Could not send the verification code.");
        return result;
      } finally {
        this.ssoLoading = false;
      }
    },

    async verifySsoMfa(
      method: XjtluMfaMethodType,
      code: string,
      methodPassword: string | undefined,
      securityVerificationToken: string | undefined,
      remember: boolean,
      primaryUsername: string,
      primaryPassword: string,
    ): Promise<boolean> {
      if (!this.ssoMfa) return false;
      this.ssoLoading = true;
      this.ssoError = "";
      try {
        const result = await authApi.ssoMfaVerify({
          pendingId: this.ssoMfa.pendingId,
          method,
          code,
          password: methodPassword,
          verificationToken: this.ssoVerification?.type === "slider"
            ? this.ssoVerificationToken || undefined
            : securityVerificationToken,
          remember,
        });
        if (!result.ok || (!result.sessionAuthenticated && !result.siteToken) || !result.user) {
          this.ssoError = ssoErrorText(result.error, "Two-step verification failed.");
          if (result.needMfa && result.mfa) this.applySsoMfa(result.mfa);
          if (result.needVerification && result.verification) this.applySsoVerification(result.verification);
          return false;
        }
        const authToken = result.sessionAuthenticated ? COOKIE_SESSION_MARKER : (result.siteToken || "");
        setToken(authToken);
        this.token = authToken;
        this.user = result.user;
        this.syncDataAuthAgreement(result.user);
        this.ready = true;
        clearJwxtToken();
        clearJwxtDataCaches();
        if (remember) {
          try { await saveCreds(primaryUsername, primaryPassword); } catch { /* ignore */ }
        } else {
          clearCreds();
        }
        this.ssoPendingId = "";
        this.ssoNeedCaptcha = false;
        this.ssoCaptchaImage = "";
        this.ssoVerification = null;
        this.ssoVerificationToken = "";
        this.ssoMfa = null;
        this.clearAcademicIdentity();
        return true;
      } finally {
        this.ssoLoading = false;
      }
    },

    async fetchMe(options?: { probe?: boolean }) {
      if (!this.token && !options?.probe) return;
      if (this._pendingFetchMe) return this._pendingFetchMe;
      const task = (async () => {
        try {
          this.user = await authApi.me(options?.probe ? {
            suppressAuthRedirect: true,
            suppressAuthMessage: true,
            suppressErrorMessage: true,
          } : undefined);
        } catch {
          this.user = null;
        }
        finally {
          if (this.user) {
            setToken(COOKIE_SESSION_MARKER);
            this.token = COOKIE_SESSION_MARKER;
          }
          this.syncDataAuthAgreement(this.user);
          this.ready = true;
          this._pendingFetchMe = null;
        }
      })();
      this._pendingFetchMe = task;
      return task;
    },

    async updateProfile(patch: Partial<UserInfo>) {
      const u = await authApi.updateMe(patch);
      this.user = u;
      if (u.preferredLocale) applyAccountLocale(u.preferredLocale);
      return u;
    },

    async enableForumAccess(confirmText: string) {
      const user = await authApi.enableForumAccess(confirmText);
      this.user = user;
      return user;
    },

    async logout() {
      try { await authApi.logout(); } catch { /* ignore */ }
      clearToken(); this.token = ""; this.user = null; this.dataAuthAgreed = false; this.ready = false;
      this._pendingIdentityDetection = null;
      this.academicIdentityDetecting = false;
      clearJwxtToken();
      clearJwxtDataCaches();
      this.clearAcademicIdentity();
      // 主动退出同时清除当前设备保存的 XJTLU 凭据，避免下次自动重登。
      clearCreds();
      try { sessionStorage.setItem("xjtlu-just-logged-out", "1"); } catch { /* ignore */ }
    },

    expireSession() {
      clearToken();
      this.token = "";
      this.user = null;
      this.dataAuthAgreed = false;
      this.ready = true;
      this._pendingFetchMe = null;
      this._pendingIdentityDetection = null;
      this.academicIdentityDetecting = false;
      clearJwxtToken();
      clearJwxtDataCaches();
      this.clearAcademicIdentity();
    },
  },
});
