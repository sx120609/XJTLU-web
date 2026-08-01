import axios, { type AxiosError, type AxiosRequestConfig } from "axios";
import { ElMessage } from "element-plus";

const MANAGEMENT_TOKEN_KEY = "xjtlu-management-session";
export const MANAGEMENT_AUTH_EXPIRED_EVENT = "xjtlu-management-auth-expired";

export type ManagementAccountType = "boss" | "admin";

export type ManagementPrincipal = {
  adminAccountId: number;
  sessionId: string;
  accountType: ManagementAccountType;
  username: string;
  displayName: string;
  permissionVersion: number;
  permissions: string[];
};

export type ManagementAccount = {
  id: number;
  username: string;
  displayName: string;
  accountType: ManagementAccountType;
  status: "active" | "disabled" | "locked";
  mfaEnabled: boolean;
  permissionVersion: number;
  lastLoginAt?: string | null;
  lastLoginIp?: string | null;
  createdAt: string;
  permissions: string[];
};

export type ManagementPermissionDefinition = {
  code: string;
  label: string;
  group: string;
};

export type ManagementUserRow = {
  id: number;
  username: string;
  nickname: string;
  status: "active" | "banned" | "muted";
  mutedUntil?: string | null;
  studentSso: boolean;
  postCount: number;
  replyCount: number;
  reputation: number;
  aiReviewWhitelisted: boolean;
  forumEnabled: boolean;
  lastLoginAt?: string | null;
  createdAt: string;
};

export type ManagementTopicRow = {
  id: number;
  title: string;
  content: string;
  hidden: boolean;
  pinned: boolean;
  locked: boolean;
  aiReviewStatus: string;
  aiRiskLevel?: string | null;
  aiRiskScore?: number | null;
  aiReviewReason?: string | null;
  createdAt: string;
  board?: { id: number; slug: string; name: string };
  author?: { id: number; username: string; nickname: string };
};

export type ManagementAuditRow = {
  id: number;
  action: string;
  targetType: string;
  targetId: string;
  summary: string;
  detail: string;
  ip: string;
  createdAt: string;
  actor?: { id: number; username: string; displayName: string; accountType: string } | null;
};

export type ManagementMarketReviewRow = {
  id: number;
  title: string;
  description: string;
  category: string;
  price: number;
  condition: string;
  campus: string;
  location: string;
  cover: string;
  images: Array<{ id: number; url: string; sort: number }>;
  createdAt: string;
  seller?: { id: number; username: string; nickname: string };
};

export type ManagementLearningReviewRow = {
  id: number;
  round: number;
  status: string;
  submittedAt: string;
  reason: string;
  submittedBy: { id: number; username: string; nickname: string };
  reviewedByAdmin?: { id: number; username: string; displayName: string } | null;
  version: {
    id: number;
    label: string;
    files: Array<{ id: number; originalName: string; format: string; fileSize: number; pageCount?: number | null; previewEnabled: boolean; previewPageStart?: number | null; previewPageEnd?: number | null; status: string }>;
    profile: {
      item: { id: number; title: string; description: string; priceCents: number; images: Array<{ id: number; url: string }> };
      type?: { id: number; name: string } | null;
    };
  };
};

export type ManagementOverview = {
  generatedAt: string;
  personalUsers: { total: number; active: number };
  managementAccounts: number;
  forum: { topics: number; todayTopics: number; pendingTopics: number; pendingReplies: number };
  reviewQueues: { physicalItems: number; learningMaterials: number };
  todayAuditActions: number;
};

export type ManagementBoard = {
  id: number;
  slug: string;
  name: string;
  description?: string | null;
  icon?: string | null;
  color?: string | null;
  order: number;
  type: string;
  section?: string | null;
  anonymousEnabled: boolean;
  readOnly?: boolean;
  systemManaged: boolean;
  feedSource?: { id: number; name: string } | null;
};

export type ManagementSystemHealth = {
  generatedAt: string;
  database: { ok: boolean; latencyMs: number; error: string | null };
  cache?: unknown;
  http?: unknown;
};

type ApiEnvelope<T> = { code: number; data: T; message: string };
type ManagementRequestOptions = AxiosRequestConfig & { suppressAuthRedirect?: boolean; suppressErrorMessage?: boolean };

let managementToken = "";

export function readManagementToken() {
  return managementToken;
}

export function hydrateManagementToken() {
  try { managementToken = sessionStorage.getItem(MANAGEMENT_TOKEN_KEY) || ""; } catch { managementToken = ""; }
  return managementToken;
}

export function setManagementToken(token: string) {
  managementToken = token;
  try {
    if (token) sessionStorage.setItem(MANAGEMENT_TOKEN_KEY, token);
    else sessionStorage.removeItem(MANAGEMENT_TOKEN_KEY);
  } catch { /* session-only token remains in memory */ }
}

export function clearManagementToken() {
  setManagementToken("");
}

const instance = axios.create({
  baseURL: "/api/manage",
  timeout: 20_000,
  withCredentials: false,
});

instance.interceptors.request.use((config) => {
  if (managementToken) config.headers.Authorization = `Bearer ${managementToken}`;
  return config;
});

instance.interceptors.response.use(
  (response) => {
    const body = response.data as ApiEnvelope<unknown>;
    if (body && typeof body.code === "number") {
      if (body.code !== 0) return Promise.reject(new Error(body.message || "管理请求失败"));
      return body.data;
    }
    return response.data;
  },
  (error: AxiosError<ApiEnvelope<unknown>>) => {
    const config = error.config as ManagementRequestOptions | undefined;
    if (error.response?.status === 401) {
      clearManagementToken();
      window.dispatchEvent(new Event(MANAGEMENT_AUTH_EXPIRED_EVENT));
      if (!config?.suppressAuthRedirect && window.location.pathname !== "/manage/login") {
        const redirect = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.replace(`/manage/login?redirect=${redirect}`);
      }
    }
    if (!config?.suppressErrorMessage) {
      ElMessage.error(error.response?.data?.message || error.message || "管理请求失败");
    }
    return Promise.reject(error);
  },
);

const get = <T>(url: string, params?: Record<string, unknown>, options?: ManagementRequestOptions) =>
  instance.get<unknown, T>(url, { ...options, params });
const post = <T>(url: string, data?: unknown, options?: ManagementRequestOptions) =>
  instance.post<unknown, T>(url, data, options);
const put = <T>(url: string, data?: unknown, options?: ManagementRequestOptions) =>
  instance.put<unknown, T>(url, data, options);
const patch = <T>(url: string, data?: unknown, options?: ManagementRequestOptions) =>
  instance.patch<unknown, T>(url, data, options);

export const managementApi = {
  login: (data: { username: string; password: string; otp?: string }) =>
    post<{ token: string; sessionId: string; account: ManagementAccount }>("/auth/login", data, { suppressAuthRedirect: true }),
  me: (options?: ManagementRequestOptions) => get<ManagementPrincipal>("/auth/me", undefined, options),
  logout: () => post<{ ok: true }>("/auth/logout"),
  logoutAll: () => post<{ ok: true; revoked: number }>("/auth/logout-all"),

  permissionCatalog: () => get<{ permissions: ManagementPermissionDefinition[]; bossOnly: string[] }>("/permissions"),
  accounts: () => get<ManagementAccount[]>("/accounts"),
  createAccount: (data: { username: string; password: string; displayName: string }) => post<ManagementAccount>("/accounts", data),
  updateAccount: (id: number, data: { displayName?: string; status?: string }) => patch<ManagementAccount>(`/accounts/${id}`, data),
  resetAccountPassword: (id: number, newPassword: string) => patch(`/accounts/${id}/password`, { newPassword }),
  replaceAccountPermissions: (id: number, permissions: string[]) => put(`/accounts/${id}/permissions`, { permissions }),
  revokeAccountSessions: (id: number) => post(`/accounts/${id}/revoke-sessions`),

  users: (params: Record<string, unknown>) => get<{ page: number; size: number; total: number; list: ManagementUserRow[] }>("/users", params),
  updateUser: (id: number, data: Record<string, unknown>) => patch<ManagementUserRow>(`/users/${id}`, data),
  resetUserPassword: (id: number, newPassword: string) => patch(`/users/${id}/password`, { newPassword }),

  topics: (params: Record<string, unknown>) => get<{ page: number; size: number; total: number; list: ManagementTopicRow[] }>("/forum/topics", params),
  updateTopic: (id: number, data: Record<string, unknown>) => patch(`/forum/topics/${id}`, data),
  updateReply: (id: number, data: Record<string, unknown>) => patch(`/forum/replies/${id}`, data),

  audit: (params: { page: number; size: number }) => get<{ page: number; size: number; total: number; list: ManagementAuditRow[] }>("/audit", params),
  marketReviews: (params: Record<string, unknown>) => get<{ page: number; size: number; total: number; list: ManagementMarketReviewRow[] }>("/market/reviews", params),
  decideMarketReview: (id: number, data: { decision: "approve" | "reject"; note: string }) => patch(`/market/reviews/${id}`, data),
  learningReviews: (status = "submitted") => get<ManagementLearningReviewRow[]>("/learning/reviews", { status }),
  decideLearningReview: (id: number, data: { action: "approve" | "reject"; reason: string; checklist: { rights: boolean; quality: boolean; fileSafety: boolean } }) => patch(`/learning/reviews/${id}`, data),
  overview: () => get<ManagementOverview>("/overview"),

  boards: () => get<ManagementBoard[]>("/boards"),
  createBoard: (data: Record<string, unknown>) => post<ManagementBoard>("/boards", data),
  updateBoard: (id: number, data: Record<string, unknown>) => patch<ManagementBoard>(`/boards/${id}`, data),
  deleteBoard: (id: number) => instance.delete<unknown, { ok: true; deletedBoardId: number }>(`/boards/${id}`),
  feeds: () => get<unknown[]>("/feeds"),
  announcements: () => get<unknown[]>("/announcements"),
  siteConfig: () => get<Record<string, unknown>>("/site-config"),
  updateSiteConfig: (data: Record<string, unknown>) => patch<Record<string, unknown>>("/site-config", data),
  features: () => get<Record<string, boolean>>("/features"),
  updateFeatures: (data: Record<string, boolean>) => patch<Record<string, boolean>>("/features", data),
  systemHealth: () => get<ManagementSystemHealth>("/system/health"),
};
