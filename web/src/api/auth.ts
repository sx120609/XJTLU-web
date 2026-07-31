import { request, type RequestOptions } from "./request";

const XJTLU_SSO_TIMEOUT_MS = 55_000;

export interface LoginPayload { username: string; password: string }
export interface RegisterPayload { username: string; password: string; nickname: string; college?: string; major?: string; enrollYear?: number }
export interface UserInfo {
  id: number;
  username: string;
  nickname: string;
  avatar?: string | null;
  bio?: string | null;
  college?: string | null;
  major?: string | null;
  enrollYear?: number | null;
  role: string;
  studentSso?: boolean;
  dataAuthAgreedAt?: string | null;
  forumEnabled?: boolean;
  forumEnabledAt?: string | null;
  status?: string;
  mutedUntil?: string | null;
  postCount: number;
  replyCount: number;
  reputation: number;
  points?: number;
  preferredLocale?: "en-US" | "zh-CN";
  sponsorTotalCents?: number;
  sponsorAmount?: number;
  lastSeenAt?: string;
  lastLoginAt?: string | null;
  lastLoginClient?: string | null;
  usedIosClient?: boolean;
  usedAndroidClient?: boolean;
  usedHarmonyClient?: boolean;
  topicSubmissionLocked?: boolean;
  aiReviewWhitelisted?: boolean;
  anonymousState?: {
    eligible: boolean;
    minReputation: number;
    weeklyQuota: number;
    availableCredits: number;
    storedCredits: number;
    frozen: boolean;
    weekKey: string;
    staleWeek: boolean;
    nextResetAt: string;
    nextTier?: { reputation: number; weeklyQuota: number; need: number } | null;
  };
  reputationBreakdown?: {
    total: number;
    accountAgeDays: number;
    agePoints: number;
    postPoints: number;
    replyPoints: number;
    forumPoints: number;
    caps: {
      agePoints: number;
      postPoints: number;
      replyPoints: number;
    };
  };
  createdAt: string;
}

export interface SsoBeginResult {
  pendingId: string;
  needCaptcha: boolean;
  captchaImage?: string;
}

export type XjtluVerificationChallenge =
  | { type: "image"; pendingId: string; image: string }
  | {
    type: "slider";
    pendingId: string;
    sourceImage: string;
    puzzleImage: string;
    y: number;
    token: string;
  };

export type XjtluMfaMethodType = "email" | "otp" | "sms";

export interface XjtluMfaMethod {
  type: XjtluMfaMethodType;
  authType: "webExtendEmailCodeAuth" | "webOtpAuth" | "webSmsAuth";
  label: string;
  destination?: string;
  codeLength: number;
  codeRequired: boolean;
  cooldownSeconds: number;
  passwordRequired: boolean;
}

export interface XjtluMfaChallenge {
  pendingId: string;
  reason: "abnormal-login";
  methods: XjtluMfaMethod[];
  currentStep: number;
  totalSteps: number;
}

export interface SsoLoginResult {
  ok: boolean;
  sessionAuthenticated?: boolean;
  siteToken?: string;
  user?: UserInfo;
  needNickname?: boolean;
  portalReady?: boolean;
  portalConnecting?: boolean;
  error?: string;
  needVerification?: boolean;
  verification?: XjtluVerificationChallenge;
  needMfa?: boolean;
  mfa?: XjtluMfaChallenge;
}

export interface XjtluSliderCheckResult {
  ok: boolean;
  verificationToken?: string;
  error?: string;
  verification?: Extract<XjtluVerificationChallenge, { type: "slider" }>;
}

export interface XjtluMfaSendResult {
  ok: boolean;
  method?: "email" | "sms";
  destination?: string;
  cooldownSeconds?: number;
  error?: string;
}

export const authApi = {
  login: (payload: LoginPayload) => request.post<{ token?: string; sessionAuthenticated?: boolean; user: UserInfo }>("/auth/login", payload),
  register: (payload: RegisterPayload) => request.post<{ token?: string; sessionAuthenticated?: boolean; user: UserInfo }>("/auth/register", payload),
  ssoBegin: () => request.post<SsoBeginResult>("/auth/xjtlu-sso-begin", undefined, { timeout: XJTLU_SSO_TIMEOUT_MS }),
  ssoLogin: (p: { pendingId: string; username: string; password: string; verificationToken?: string; remember?: boolean }) =>
    request.post<SsoLoginResult>("/auth/xjtlu-sso-login", { ...p, school: "xjtlu" }, { timeout: XJTLU_SSO_TIMEOUT_MS }),
  ssoSliderCheck: (p: { pendingId: string; x: number; y: number; token: string }) =>
    request.post<XjtluSliderCheckResult>("/auth/xjtlu-sso-slider-check", { ...p, school: "xjtlu" }, { timeout: XJTLU_SSO_TIMEOUT_MS }),
  ssoMfaSend: (p: { pendingId: string; method: "email" | "sms" }) =>
    request.post<XjtluMfaSendResult>("/auth/xjtlu-sso-mfa-send", { ...p, school: "xjtlu" }, { timeout: XJTLU_SSO_TIMEOUT_MS }),
  ssoMfaVerify: (p: {
    pendingId: string;
    method: XjtluMfaMethodType;
    code: string;
    password?: string;
    verificationToken?: string;
    remember?: boolean;
  }) => request.post<SsoLoginResult>("/auth/xjtlu-sso-mfa-verify", { ...p, school: "xjtlu" }, { timeout: XJTLU_SSO_TIMEOUT_MS }),
  logout: () => request.post<{ ok: true }>("/auth/logout"),
  me: (options?: RequestOptions) => request.get<UserInfo>("/user/me", undefined, options),
  updateMe: (payload: Partial<UserInfo>) => request.patch<UserInfo>("/user/me", payload),
  enableForumAccess: (confirmText: string) => request.post<UserInfo>("/user/forum-access/enable", { confirmText }),
  changePassword: (oldPassword: string, newPassword: string) =>
    request.patch<{ ok: true }>("/user/password", { oldPassword, newPassword }),
};
