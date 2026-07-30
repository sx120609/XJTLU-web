import { request, type RequestOptions } from "./request";

export type AnnouncementSyncStatus = {
  enabled: boolean;
  authorized: boolean;
  sourceUserId?: number | null;
  sourceUsername: string;
  intervalMinutes: number;
  lastRunAt?: string | null;
  lastRunOk?: boolean | null;
  lastError?: string | null;
  count: number;
};

export type AnnouncementTargetClient =
  | "ios"
  | "android"
  | "harmony"
  | "web";

export type AnnouncementLevel = "strong" | "normal" | "weak";

export type AdminAnnouncement = {
  id: number;
  userId: null;
  category: "system";
  targetClient: string | null;
  level: AnnouncementLevel;
  title: string;
  content: string;
  payload: string;
  link: string | null;
  source: string | null;
  readAt: string | null;
  createdAt: string;
};

export type AdminAnnouncementCreate = {
  title: string;
  content: string;
  level?: AnnouncementLevel;
  link?: string;
  source?: string;
  targetClient?:
    | "all"
    | AnnouncementTargetClient
    | AnnouncementTargetClient[];
};

export type AdminAnnouncementPatch = {
  title?: string;
  content?: string;
  level?: AnnouncementLevel;
  link?: string | null;
  source?: string | null;
  targetClient?:
    | "all"
    | AnnouncementTargetClient
    | AnnouncementTargetClient[];
};

export type SiteConfig = {
  siteName: string;
  siteSubtitle: string;
  siteLogoUrl: string;
  siteOrigin: string;
  siteFilingNumber: string;
  aiReviewEnabled: boolean;
  aiReviewProvider: string;
  aiReviewApiUrl: string;
  aiReviewModel: string;
  aiReviewFallbackModels: string;
  aiReviewApiKey: string;
  hasAiReviewApiKey: boolean;
  aiReviewApiKeyMasked: string;
  imageReviewEnabled: boolean;
  imageReviewApiUrl: string;
  imageReviewModel: string;
  imageReviewFallbackModels: string;
  imageReviewApiKey: string;
  hasImageReviewApiKey: boolean;
  imageReviewApiKeyMasked: string;
  imageReviewSystemPrompt: string;
  imageReviewUserPrompt: string;
  imageReviewConcurrency: number;
  imageReviewRequestGroupSize: number;
  videoReviewEnabled: boolean;
  videoReviewApiUrl: string;
  videoReviewModel: string;
  videoReviewFallbackModels: string;
  videoReviewApiKey: string;
  hasVideoReviewApiKey: boolean;
  videoReviewApiKeyMasked: string;
  videoReviewSystemPrompt: string;
  videoReviewUserPrompt: string;
  videoReviewConcurrency: number;
  aiReviewThreshold: number;
  imageReviewThreshold: number;
  videoReviewThreshold: number;
  aiEditSimilarityThreshold: number;
  aiTopicReviewSystemPrompt: string;
  aiTopicReviewUserPrompt: string;
  aiReplyReviewSystemPrompt: string;
  aiReplyReviewUserPrompt: string;
  aiEditSimilaritySystemPrompt: string;
  aiEditSimilarityUserPrompt: string;
  anonymousMinReputation: number;
  accountAgeDaysPerStep: number;
  accountAgePointsPerStep: number;
  accountAgePointsCap: number;
  postPointsPerTopic: number;
  postPointsCap: number;
  replyPointsPerReply: number;
  replyPointsCap: number;
  forumEnabledBonus: number;
  anonymousTiers: Array<{ reputation: number; quota: number }>;
};

export type MediaStorageConfig = {
  mediaStorageProvider: "local" | "onedrive-cn";
  mediaStorageImageProvider: "local" | "onedrive-cn";
  mediaStorageVideoProvider: "local" | "onedrive-cn";
  mediaStorageRemotePrefixes: string[];
  oneDriveChinaClientId: string;
  oneDriveChinaClientSecretConfigured: boolean;
  oneDriveChinaSharepointUrl: string;
  oneDriveChinaSharepointHost: string;
  oneDriveChinaSharepointPath: string;
  oneDriveChinaSiteId: string;
  oneDriveChinaSiteName: string;
  oneDriveChinaDriveId: string;
  oneDriveChinaDriveName: string;
  oneDriveChinaRootPath: string;
  oneDriveChinaRefreshTokenConfigured: boolean;
  oneDriveChinaAuthorizedAt: string;
  oneDriveChinaLastError: string;
  remoteReady: boolean;
  oneDriveChinaCallbackUrl: string;
  oneDriveChinaCallbackError: string;
};

export type FilestoreStorageConfig = {
  enabled: boolean;
  minSizeMb: number;
  minSizeBytes: number;
  remoteReady: boolean;
  remoteConfigured: boolean;
  mediaStorageProvider: "local" | "onedrive-cn";
  imageProvider: "local" | "onedrive-cn";
  videoProvider: "local" | "onedrive-cn";
  remotePrefixes: string[];
  fileCollectPrefix: string;
  oneDriveChinaSiteName: string;
  oneDriveChinaDriveName: string;
  oneDriveChinaRootPath: string;
  oneDriveChinaAuthorizedAt: string;
  oneDriveChinaLastError: string;
};

export type OneDriveChinaDriveOption = {
  id: string;
  name: string;
  webUrl: string;
  driveType: string;
};

export type MediaStorageAdminFileEntry = {
  relativePath: string;
  url: string;
  mediaKind: "image" | "video" | "unknown";
  configuredBackend: "local" | "onedrive-cn";
  inRemotePrefix: boolean;
  localExists: boolean;
  cacheExists: boolean;
  remoteExists: boolean;
  localSizeBytes: number | null;
  cacheSizeBytes: number | null;
  remoteSizeBytes: number | null;
  localUpdatedAt: string;
  cacheUpdatedAt: string;
  remoteUpdatedAt: string;
};

export type MediaStorageAdminInventory = {
  generatedAt: string;
  mediaStorageProvider: "local" | "onedrive-cn" | "mixed";
  mediaStorageImageProvider: "local" | "onedrive-cn";
  mediaStorageVideoProvider: "local" | "onedrive-cn";
  remotePrefixes: string[];
  remoteConfigured: boolean;
  remoteReachable: boolean;
  remoteError: string;
  summary: {
    total: number;
    localCount: number;
    cacheCount: number;
    remoteCount: number;
    eligibleMigrationCount: number;
    syncedCount: number;
    migratedCount: number;
    outOfScopeLocalCount: number;
  };
  list: MediaStorageAdminFileEntry[];
};

export type MediaStorageMigrationResult = {
  startedAt: string;
  finishedAt: string;
  mediaStorageProvider: "local" | "onedrive-cn" | "mixed";
  mediaStorageImageProvider: "local" | "onedrive-cn";
  mediaStorageVideoProvider: "local" | "onedrive-cn";
  remotePrefixes: string[];
  eligible: number;
  processed: number;
  remaining: number;
  batchLimit: number;
  migrated: number;
  failed: number;
  list: Array<{
    relativePath: string;
    status: "migrated" | "failed";
    message: string;
  }>;
};

export type MediaStorageCleanupResult = {
  startedAt: string;
  finishedAt: string;
  mediaStorageProvider: "local" | "onedrive-cn" | "mixed";
  mediaStorageImageProvider: "local" | "onedrive-cn";
  mediaStorageVideoProvider: "local" | "onedrive-cn";
  remotePrefixes: string[];
  eligible: number;
  removed: number;
  failed: number;
  list: Array<{
    relativePath: string;
    status: "removed" | "failed";
    message: string;
  }>;
};

export type SitePromptDefaults = Pick<
  SiteConfig,
  | "imageReviewSystemPrompt"
  | "imageReviewUserPrompt"
  | "videoReviewSystemPrompt"
  | "videoReviewUserPrompt"
  | "aiTopicReviewSystemPrompt"
  | "aiTopicReviewUserPrompt"
  | "aiReplyReviewSystemPrompt"
  | "aiReplyReviewUserPrompt"
  | "aiEditSimilaritySystemPrompt"
  | "aiEditSimilarityUserPrompt"
>;

export type AiReviewLogRow = {
  id: number;
  kind: string;
  targetId?: number | null;
  targetLabel?: string | null;
  targetUrl?: string | null;
  provider: string;
  model: string;
  endpoint?: string | null;
  status: string;
  requestSummary: string;
  responseSummary: string;
  errorMessage?: string | null;
  createdById?: number | null;
  startedAt: string;
  finishedAt?: string | null;
  durationMs?: number | null;
  createdBy?: { id: number; nickname: string; username?: string } | null;
};

export type ForumImageSweepResult = {
  reviewEnabled: boolean;
  scannedTopics: number;
  scannedReplies: number;
  imageReferences: number;
  uniqueImageUrls: number;
  createdAssets: number;
  requeuedAssets: number;
  alreadyTracked: number;
  skippedAssets: number;
  pendingAfterScan: number;
  moderationTriggered: boolean;
};

export type ForumVideoSweepResult = {
  reviewEnabled: boolean;
  scannedTopics: number;
  scannedReplies: number;
  videoReferences: number;
  uniqueVideoUrls: number;
  createdAssets: number;
  requeuedAssets: number;
  alreadyTracked: number;
  skippedAssets: number;
  pendingAfterScan: number;
  moderationTriggered: boolean;
};

export type ReviewTargetKind = "topic" | "reply";
export type AdminTopicReviewStatus =
  | "none"
  | "checking"
  | "auto_passed"
  | "blocked_ai"
  | "blocked_force"
  | "manual_requested"
  | "manual_reviewing"
  | "approved_manual"
  | "rejected_manual";

export type AdminTopicAuthor = {
  id: number | null;
  username?: string | null;
  nickname: string;
  role: string;
  anonymous?: boolean;
};

export type AdminTopicRow = {
  id: number;
  boardId: number;
  authorId: number | null;
  title: string;
  aiReviewStatus: AdminTopicReviewStatus;
  aiRiskScore: number | null;
  isAnonymous: boolean;
  pinned: boolean;
  globalPinned: boolean;
  locked: boolean;
  hidden: boolean;
  replyCount: number;
  likeCount: number;
  createdAt: string;
  board: {
    id: number;
    slug: string;
    name: string;
  };
  author: AdminTopicAuthor;
  realAuthor?: AdminTopicAuthor;
};

export type AdminTopicPatch = {
  hidden?: boolean;
  pinned?: boolean;
  globalPinned?: boolean;
  locked?: boolean;
  boardSlug?: string;
  aiReviewStatus?: "manual_reviewing" | "approved_manual" | "rejected_manual";
  manualReviewNote?: string;
};

export type AdminTopicUpdateResult = {
  id: number;
  hidden: boolean;
  pinned: boolean;
  globalPinned: boolean;
  locked: boolean;
  boardId: number;
  aiReviewStatus: AdminTopicReviewStatus;
};

export type AdminReplyUpdateResult = {
  id: number;
  topicId: number;
  hidden: boolean;
  floor: number;
  aiReviewStatus: AdminTopicReviewStatus;
  manualReviewedById: number | null;
  manualReviewedAt: string | null;
  manualReviewNote: string | null;
};

export type AdminTopicDeleteResult = {
  ok: true;
  hard: boolean;
  deletedReplies: number;
  deletedRatings: number;
};

export type AdminReviewTarget = {
  kind: ReviewTargetKind;
  id: number;
  title: string;
  aiReviewStatus: AdminTopicReviewStatus;
  hidden: boolean;
  topicId?: number;
  reviewable: boolean;
};

export type AdminBoardType = "normal" | "question" | "market" | "coursereview";
export type AdminBoardSection = "general" | "study" | "social";

export type AdminBoard = {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  order: number;
  type: AdminBoardType;
  section: AdminBoardSection | null;
  readOnly: boolean;
  anonymousEnabled: boolean;
  topicCount: number;
  feedSourceId: number | null;
  feedSource: { id: number; name: string } | null;
  systemManaged: boolean;
};

export type AdminBoardWriteInput = {
  slug: string;
  name: string;
  description?: string | null;
  icon?: string | null;
  color?: string | null;
  order?: number;
  type: AdminBoardType;
  section?: AdminBoardSection | null;
  anonymousEnabled?: boolean;
};

export type AdminBoardPatchInput = Partial<AdminBoardWriteInput>;

export type AdminFeedSource = {
  id: number;
  slug: string;
  name: string;
  homepage: string;
  listUrl: string;
  pageSize: number;
  maxPages: number;
  parser: string;
  cronMinutes: number;
  enabled: boolean;
  botUserId: number;
  lastRunAt: string | null;
  lastRunOk: boolean | null;
  lastError: string | null;
  board: {
    id: number;
    slug: string;
    name: string;
    topicCount: number;
  } | null;
};

export type AdminFeedRunResult = {
  ok: boolean;
  newCount: number;
  error: string | null;
};

export type AdminFeedRunListItem = AdminFeedRunResult & {
  slug: string;
};

export type ForumImageReviewAsset = {
  id: number;
  url: string;
  status: string;
  reason?: string | null;
  detail?: string | null;
  reviewModel?: string | null;
  reviewEndpoint?: string | null;
  reviewedAt?: string | null;
  lastError?: string | null;
  manualReviewedAt?: string | null;
  manualReviewNote?: string | null;
  manualReviewedBy?: { id: number; nickname: string; username?: string } | null;
};

export type ForumVideoReviewAsset = {
  id: number;
  url: string;
  status: string;
  reason?: string | null;
  detail?: string | null;
  reviewModel?: string | null;
  reviewEndpoint?: string | null;
  reviewedAt?: string | null;
  lastError?: string | null;
  durationMs?: number | null;
  width?: number | null;
  height?: number | null;
  hasAudio?: boolean;
  transcriptStatus?: string | null;
  manualReviewedAt?: string | null;
  manualReviewNote?: string | null;
  manualReviewedBy?: { id: number; nickname: string; username?: string } | null;
};

export type ForumVideoQueueRow = {
  id: number;
  url: string;
  status: string;
  reason?: string | null;
  detail?: string | null;
  reviewedAt?: string | null;
  lastError?: string | null;
  durationMs?: number | null;
  width?: number | null;
  height?: number | null;
  hasAudio?: boolean;
  transcriptStatus?: string | null;
  createdAt: string;
  targetKind: "topic" | "reply" | "unknown";
  targetId?: number | null;
  targetLabel: string;
  targetUrl: string;
};

export type AdminOverview = {
  users: number;
  banned: number;
  todayLogins: number;
  topics: number;
  todayTopics: number;
  hiddenTopics: number;
  replies: number;
  iosClients: number;
  androidClients: number;
  harmonyClients: number;
  feeds: number;
  boards: number;
  forumEligibleUsers: number;
  forumEnabledUsers: number;
  forumPendingUsers: number;
  forumEnabledToday: number;
  dailyActiveSeries: Array<{
    date: string;
    count: number;
  }>;
};

export type AdminUserRole = "user" | "mod" | "admin" | "bot";
export type AdminUserStatus = "active" | "banned" | "muted";
export type AdminLoginClient = "ios" | "android" | "harmony" | "web" | "unknown";

export type AdminUserAnonymousState = {
  eligible: boolean;
  minReputation: number;
  weeklyQuota: number;
  availableCredits: number;
  storedCredits: number;
  frozen: boolean;
  weekKey: string;
  staleWeek: boolean;
  nextResetAt: string;
  nextTier: null | {
    reputation: number;
    weeklyQuota: number;
    need: number;
  };
};

export type AdminUser = {
  id: number;
  username: string;
  nickname: string;
  email: string | null;
  avatar: string | null;
  college: string | null;
  enrollYear: number | null;
  role: AdminUserRole;
  studentSso: boolean;
  status: AdminUserStatus;
  mutedUntil: string | null;
  postCount: number;
  replyCount: number;
  reputation: number;
  reputationBreakdown: {
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
  forumEnabled: boolean;
  forumEnabledAt: string | null;
  anonymousCredits: number;
  transactionPoints?: number;
  anonymousWeekKey: string | null;
  anonymousCreditsFrozen: boolean;
  anonymousState: AdminUserAnonymousState;
  aiReviewWhitelisted: boolean;
  lastSeenAt: string;
  lastLoginAt: string | null;
  lastLoginClient: AdminLoginClient | null;
  usedIosClient: boolean;
  usedAndroidClient: boolean;
  usedHarmonyClient: boolean;
  createdAt: string;
};

export type AdminUserPatch = {
  status?: AdminUserStatus;
  role?: AdminUserRole;
  nickname?: string;
  aiReviewWhitelisted?: boolean;
  mutedUntil?: string | null;
  anonymousCredits?: number;
  anonymousCreditsFrozen?: boolean;
};

export type AdminUserPatchResult = Pick<
  AdminUser,
  | "id"
  | "role"
  | "status"
  | "mutedUntil"
  | "nickname"
  | "aiReviewWhitelisted"
  | "anonymousCredits"
  | "anonymousCreditsFrozen"
  | "anonymousState"
  | "reputation"
>;

export type AdminUserCreateInput = {
  username: string;
  password: string;
  nickname: string;
  role?: AdminUserRole;
  college?: string;
  enrollYear?: number;
};

export type AdminUserCreateResult = Pick<
  AdminUser,
  "id" | "username" | "nickname" | "role" | "college" | "enrollYear" | "createdAt"
>;

export type AdminUserListParams = {
  q?: string;
  role?: AdminUserRole;
  status?: AdminUserStatus;
  forumEnabled?: "0" | "1";
  loginClient?: "all" | "none" | AdminLoginClient;
  usedClient?: "ios" | "android" | "harmony";
  usedIosClient?: "0" | "1";
  usedAndroidClient?: "0" | "1";
  usedHarmonyClient?: "0" | "1";
  loginFrom?: string;
  loginTo?: string;
  sort?: "login-desc" | "id-desc" | "id-asc";
  page?: number;
  size?: number;
};

export type WeiwallSyncConfig = {
  id: number;
  enabled: boolean;
  baseUrl: string;
  schoolEn: string;
  tenantId: number;
  tokenPresent: boolean;
  tokenPreview: string;
  tokenExpiresAt: string | null;
  tokenExpiresKnown: boolean;
  tokenExpired: boolean;
  intervalSeconds: number;
  topicPages: number;
  commentPageSize: number;
  maxCommentPages: number;
  maxReplyPages: number;
  board: null | {
    id: number;
    slug: string;
    name: string;
    readOnly: boolean;
    topicCount: number;
  };
  lastRunAt: string | null;
  lastRunOk: boolean | null;
  lastError: string | null;
  lastSyncedAt: string | null;
};

export type WeiwallSyncRunResult = {
  ok: boolean;
  boardSlug: string;
  sourceName: string;
  pagesScanned: number;
  topicsScanned: number;
  topicsCreated: number;
  topicsUpdated: number;
  repliesCreated: number;
  repliesUpdated: number;
  authorsCreated: number;
  authorsUpdated: number;
  commentsFetched: number;
  latestExternalTopicId: string | null;
  topicTraces: Array<{
    phase: "latest" | "backfill";
    action: "fetched" | "probed" | "skipped";
    externalTopicId: string;
    localTopicId: number | null;
    title: string;
    remoteCommentCount: number | null;
    localReplyCountBefore: number | null;
    visibleReplyCountAfter: number | null;
    commentsFetched: number;
    repliesCreated: number;
    repliesUpdated: number;
    note: string | null;
  }>;
  error?: string | null;
};

export type WeiwallTokenAuthSession = {
  flowId: string;
  authorizeUrl: string;
  qrDataUrl: string;
  callbackUrl: string;
  expiresAt: string;
};

export type WeiwallTokenAuthStatus = {
  flowId: string;
  status: "pending" | "success" | "error" | "expired";
  expiresAt: string | null;
  completedAt: string | null;
  error: string | null;
};

export type DatabaseBackupStatus = {
  supported: boolean;
  provider: "postgresql" | "unsupported";
  backupMethod: "pg-dump" | null;
  restoreSupported: boolean;
  restoreMethod: "pg-restore" | null;
  exists: boolean;
  maintenanceActive: boolean;
  maintenanceMessage: string;
  databasePathLabel: string | null;
  sizeBytes: number | null;
  updatedAt: string | null;
  downloadFileName: string | null;
  reason: string | null;
  restoreReason: string | null;
  maxRestoreUploadBytes: number | null;
  restoreUploadAccept: string;
};

export type DatabaseRestoreResult = {
  restoredAt: string;
  durationMs: number;
  fileName: string;
  fileSizeBytes: number;
  provider: "postgresql";
};

export type SystemHealthSnapshot = {
  generatedAt: string;
  database: { ok: boolean; latencyMs: number; error: string | null };
  process: {
    startedAt: string;
    uptimeMs: number;
    nodeVersion: string;
    memory: { rssBytes: number; heapUsedBytes: number; heapTotalBytes: number };
  };
  cache: {
    sharedHits: number;
    localHits: number;
    misses: number;
    coalescedLoads: number;
    writes: number;
    localFallbackWrites: number;
    hits: number;
    lookups: number;
    hitRate: number;
    localEntries: number;
    inflightLoads: number;
  };
  http: {
    retainedRouteCount: number;
    sampleLimitPerRoute: number;
    slowestRoutes: Array<{ route: string; requests: number; errors: number; samples: number; p50Ms: number; p95Ms: number; maxMs: number; updatedAt: string }>;
  };
  jobs: Array<{
    key: string;
    label: string;
    intervalMs: number | null;
    status: "waiting" | "running" | "healthy" | "failed";
    registeredAt: string;
    lastStartedAt: string | null;
    lastSucceededAt: string | null;
    lastFailedAt: string | null;
    lastDurationMs: number | null;
    lastError: string | null;
    runs: number;
    failures: number;
    skippedOverlaps: number;
  }>;
};

export type EpayConfig = {
  id: number;
  enabled: boolean;
  gatewayUrl: string;
  submitUrl: string;
  pid: string;
  hasMerchantKey: boolean;
  merchantKeyMasked: string;
  signType: "MD5";
  defaultType: "alipay" | "wxpay" | "qqpay" | "bank" | "jdpay";
  enabledTypes: Array<"alipay" | "wxpay" | "qqpay" | "bank" | "jdpay">;
  notifyUrl: string;
  returnUrl: string;
  siteOrigin: string;
  createdAt: string;
  updatedAt: string;
};

export type EpayPreview = {
  submitUrl: string;
  method: "POST";
  params: Record<string, string>;
};

export type SponsorConfig = {
  title: string;
  description: string;
  presetAmounts: number[];
  minAmount: string;
  maxAmount: string;
  wallEnabled: boolean;
  allowMessage: boolean;
};

export type SponsorOrderStatus = "pending" | "paid" | "closed";
export type SponsorDisplayMode = "public" | "anonymous" | "hidden";

export type AdminSponsorOrder = {
  id: number;
  outTradeNo: string;
  tradeNo: string | null;
  payType: string;
  amount: string;
  amountCents: number;
  message: string;
  displayMode: SponsorDisplayMode;
  status: SponsorOrderStatus;
  expiresAt: string | null;
  paidAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  user?: {
    id: number;
    username?: string;
    nickname: string;
    avatar: string | null;
  };
};

export type SponsorOverview = {
  totalAmount: string;
  totalPaidOrders: number;
  todayAmount: string;
  todayPaidOrders: number;
  monthAmount: string;
  monthPaidOrders: number;
  pendingOrders: number;
  closedOrders: number;
  sponsorCount: number;
  payTypes: Array<{
    payType: string;
    count: number;
    amount: string;
  }>;
};

export type SponsorPaymentLog = {
  id: number;
  orderId: number | null;
  outTradeNo: string | null;
  provider: string;
  event: string;
  rawPayload: string;
  signOk: boolean;
  handled: boolean;
  result: string | null;
  createdAt: string;
  order?: {
    id: number;
    amountCents: number;
    status: SponsorOrderStatus;
  } | null;
};

export type SponsorOrderPatch = {
  status?: "paid" | "closed";
  message?: string;
  displayMode?: SponsorDisplayMode;
  adminNote?: string;
};

export type JwxtAgentConnection = {
  configured: boolean;
  online: boolean;
  ready: boolean;
  inFlight: number;
  maxConcurrent: number;
  connectedAt: number | null;
  lastPongAt: number | null;
  jwxtEnabled: boolean;
  crawlEnabled: boolean;
};

export type JwxtQueryPoolNode = {
  id: string;
  name: string;
  kind: "local" | "agent";
  weight: number;
  inFlight: number;
  cooldownRemainingMs: number;
  consecutiveFailures: number;
  connection: Omit<JwxtAgentConnection, "maxConcurrent"> & {
    maxConcurrent: number | null;
  };
};

export type JwxtAgentAdminItem = {
  id: string;
  name: string;
  enabled: boolean;
  jwxtEnabled: boolean;
  crawlEnabled: boolean;
  weight: number;
  maxConcurrent: number;
  tokenConfigured: boolean;
  connection: JwxtAgentConnection;
  pool: JwxtQueryPoolNode | null;
  loginPool: JwxtLoginPoolNode | null;
};

export type JwxtLoginPoolNode = {
  id: string;
  name: string;
  kind: "local" | "remote" | "agent";
  enabled: boolean;
  weight: number;
  inFlight: number;
  available: boolean;
  consecutiveFailures: number;
  lastError: string;
};

export type JwxtAgentsAdminConfig = {
  source: "environment" | "database";
  agentPath: string;
  localJwxtEnabled: boolean;
  localJwxtWeight: number;
  crawlAgentId: string;
  local: JwxtQueryPoolNode | null;
  localLoginPool: JwxtLoginPoolNode | null;
  loginPool: {
    dedicated: boolean;
    queryTransport: "local" | "remote" | "agent";
  };
  agents: JwxtAgentAdminItem[];
};

export type JwxtAgentsAdminPatch = {
  localJwxtEnabled: boolean;
  localJwxtWeight: number;
  crawlAgentId: string;
  agents: Array<{
    id: string;
    name: string;
    token?: string;
    enabled: boolean;
    jwxtEnabled: boolean;
    crawlEnabled: boolean;
    weight: number;
    maxConcurrent: number;
  }>;
};

export const adminApi = {
  // 概览
  overview: (options?: RequestOptions) => request.get<AdminOverview>("/admin/overview", undefined, options),
  systemHealth: (options?: RequestOptions) => request.get<SystemHealthSnapshot>("/admin/system/health", undefined, options),
  jwxtAgents: (options?: RequestOptions) =>
    request.get<JwxtAgentsAdminConfig>("/admin/jwxt-agents", undefined, options),
  updateJwxtAgents: (payload: JwxtAgentsAdminPatch) =>
    request.patch<JwxtAgentsAdminConfig>("/admin/jwxt-agents", payload),
  generateJwxtAgentToken: () =>
    request.post<{ token: string }>("/admin/jwxt-agents/generate-token", {}),
  // 数据库备份
  databaseStatus: (options?: RequestOptions) => request.get<DatabaseBackupStatus>("/admin/database/status", undefined, options),
  downloadDatabaseBackup: () =>
    request.get<Blob>("/admin/database/backup", undefined, {
      responseType: "blob",
      timeout: 120000,
      suppressErrorMessage: true,
    }),
  restoreDatabaseBackup: (formData: FormData, options?: RequestOptions) =>
    request.post<DatabaseRestoreResult>("/admin/database/restore", formData, options),
  // 用户
  users: (
    params: AdminUserListParams,
    options?: RequestOptions,
  ) =>
    request.get<{ page: number; size: number; total: number; list: AdminUser[] }>("/admin/users", params, options),
  updateUser: (id: number, patch: AdminUserPatch) =>
    request.patch<AdminUserPatchResult>(`/admin/users/${id}`, patch),
  createUser: (data: AdminUserCreateInput) =>
    request.post<AdminUserCreateResult>("/admin/users", data),
  resetUserPassword: (id: number, newPassword: string) =>
    request.patch<{ ok: true }>(`/admin/users/${id}/password`, { newPassword }),
  deleteUser: (id: number) =>
    request.delete<{ deletedUserId: number; deletedTopics: number; deletedReplies: number }>(`/admin/users/${id}`),
  // 站点功能开关
  siteConfig: (options?: RequestOptions) => request.get<SiteConfig>("/admin/site-config", undefined, options),
  sitePromptDefaults: (options?: RequestOptions) => request.get<SitePromptDefaults>("/admin/site-config/prompt-defaults", undefined, options),
  filestoreStorageConfig: (options?: RequestOptions) => request.get<FilestoreStorageConfig>("/admin/filestore-settings", undefined, options),
  updateFilestoreStorageConfig: (patch: { enabled?: boolean; minSizeMb?: number }) =>
    request.patch<FilestoreStorageConfig>("/admin/filestore-settings", patch),
  mediaStorageConfig: (options?: RequestOptions) => request.get<MediaStorageConfig>("/admin/media-storage", undefined, options),
  updateMediaStorageConfig: (patch: {
    mediaStorageProvider?: "local" | "onedrive-cn";
    mediaStorageImageProvider?: "local" | "onedrive-cn";
    mediaStorageVideoProvider?: "local" | "onedrive-cn";
    mediaStorageRemotePrefixes?: string[] | string;
    oneDriveChinaClientId?: string;
    oneDriveChinaClientSecret?: string;
    clearOneDriveChinaClientSecret?: boolean;
    oneDriveChinaSharepointUrl?: string;
    oneDriveChinaRootPath?: string;
  }) => request.patch<MediaStorageConfig>("/admin/media-storage", patch),
  beginOneDriveChinaAuth: () =>
    request.post<{ callbackUrl: string; authorizeUrl: string }>("/admin/media-storage/onedrive-cn/authorize", {}),
  validateOneDriveChinaClient: () =>
    request.post<{ ok: true; message: string; detail?: string }>("/admin/media-storage/onedrive-cn/validate-client", {}),
  oneDriveChinaDrives: (options?: RequestOptions) =>
    request.get<{
      siteId: string;
      siteName: string;
      sharepointUrl: string;
      sharepointHost: string;
      sharepointPath: string;
      selectedDriveId: string;
      selectedDriveName: string;
      list: OneDriveChinaDriveOption[];
    }>("/admin/media-storage/onedrive-cn/drives", undefined, options),
  saveOneDriveChinaDrive: (driveId: string) =>
    request.patch<{ driveId: string; driveName: string }>("/admin/media-storage/onedrive-cn/drive", { driveId }),
  clearOneDriveChinaAuthorization: () =>
    request.delete<{ ok: true }>("/admin/media-storage/onedrive-cn/authorization"),
  mediaStorageFiles: (options?: RequestOptions) =>
    request.get<MediaStorageAdminInventory>("/admin/media-storage/files", undefined, { timeout: 120000, ...options }),
  migrateMediaStorageFiles: (payload?: { limit?: number; excludePaths?: string[] }) =>
    request.post<MediaStorageMigrationResult>("/admin/media-storage/migrate", payload ?? {}, { timeout: 10 * 60 * 1000 }),
  previewMediaStorageLocalCleanup: () =>
    request.post<{
      eligible: number;
      confirmationToken: string;
      expiresAt: string;
    }>("/admin/media-storage/cleanup-local/preview", {}),
  cleanupMediaStorageLocalFiles: (confirmationToken: string) =>
    request.post<MediaStorageCleanupResult>(
      "/admin/media-storage/cleanup-local",
      { confirmationToken },
      { timeout: 10 * 60 * 1000 },
    ),
  updateSiteConfig: (patch: {
    siteName?: string;
    siteSubtitle?: string;
    siteLogoUrl?: string;
    siteOrigin?: string;
    siteFilingNumber?: string;
    aiReviewEnabled?: boolean;
    aiReviewProvider?: string;
    aiReviewApiUrl?: string;
    aiReviewModel?: string;
    aiReviewFallbackModels?: string;
    aiReviewApiKey?: string;
    clearAiReviewApiKey?: boolean;
    imageReviewEnabled?: boolean;
    imageReviewApiUrl?: string;
    imageReviewModel?: string;
    imageReviewFallbackModels?: string;
    imageReviewApiKey?: string;
    clearImageReviewApiKey?: boolean;
    imageReviewSystemPrompt?: string;
    imageReviewUserPrompt?: string;
    imageReviewConcurrency?: number;
    imageReviewRequestGroupSize?: number;
    videoReviewEnabled?: boolean;
    videoReviewApiUrl?: string;
    videoReviewModel?: string;
    videoReviewFallbackModels?: string;
    videoReviewApiKey?: string;
    clearVideoReviewApiKey?: boolean;
    videoReviewSystemPrompt?: string;
    videoReviewUserPrompt?: string;
    videoReviewConcurrency?: number;
    aiReviewThreshold?: number;
    imageReviewThreshold?: number;
    videoReviewThreshold?: number;
    aiEditSimilarityThreshold?: number;
    aiTopicReviewSystemPrompt?: string;
    aiTopicReviewUserPrompt?: string;
    aiReplyReviewSystemPrompt?: string;
    aiReplyReviewUserPrompt?: string;
    aiEditSimilaritySystemPrompt?: string;
    aiEditSimilarityUserPrompt?: string;
    anonymousMinReputation?: number;
    accountAgeDaysPerStep?: number;
    accountAgePointsPerStep?: number;
    accountAgePointsCap?: number;
    postPointsPerTopic?: number;
    postPointsCap?: number;
    replyPointsPerReply?: number;
    replyPointsCap?: number;
    forumEnabledBonus?: number;
    anonymousTiers?: Array<{ reputation: number; quota: number }>;
  }) =>
    request.patch<SiteConfig>("/admin/site-config", patch),
  aiReviewLogs: (params: { kind?: string; status?: string; page?: number; size?: number }, options?: RequestOptions) =>
    request.get<{ page: number; size: number; total: number; list: AiReviewLogRow[] }>("/admin/ai-review/logs", params, options),
  sweepForumImages: () =>
    request.post<ForumImageSweepResult>("/admin/ai-review/images/sweep", {}, { timeout: 120000 }),
  sweepForumVideos: () =>
    request.post<ForumVideoSweepResult>("/admin/ai-review/videos/sweep", {}, { timeout: 120000 }),
  features: (options?: RequestOptions) =>
    request.get<{ forum: boolean; market: boolean; coursereview: boolean; electric: boolean; sponsor: boolean; promotion: boolean }>("/admin/features", undefined, options),
  updateFeatures: (patch: { forum?: boolean; market?: boolean; coursereview?: boolean; electric?: boolean; sponsor?: boolean; promotion?: boolean }) =>
    request.patch<{ forum: boolean; market: boolean; coursereview: boolean; electric: boolean; sponsor: boolean; promotion: boolean }>("/admin/features", patch),
  // 易支付
  epayConfig: (options?: RequestOptions) => request.get<EpayConfig>("/admin/epay-config", undefined, options),
  updateEpayConfig: (patch: Partial<{
    enabled: boolean;
    gatewayUrl: string;
    pid: string;
    merchantKey: string;
    clearMerchantKey: boolean;
    signType: "MD5";
    defaultType: "alipay" | "wxpay" | "qqpay" | "bank" | "jdpay";
    enabledTypes: Array<"alipay" | "wxpay" | "qqpay" | "bank" | "jdpay">;
  }>) => request.patch<EpayConfig>("/admin/epay-config", patch),
  previewEpayPayment: (payload: {
    outTradeNo: string;
    name: string;
    money: string | number;
    type?: "alipay" | "wxpay" | "qqpay" | "bank" | "jdpay";
    clientIp?: string;
    device?: string;
    param?: string;
  }) => request.post<EpayPreview>("/admin/epay-config/preview", payload),
  sponsorConfig: () => request.get<SponsorConfig>("/admin/sponsor-config"),
  updateSponsorConfig: (payload: Partial<SponsorConfig>) =>
    request.patch<SponsorConfig>("/admin/sponsor-config", payload),
  sponsorOverview: () => request.get<SponsorOverview>("/admin/sponsor-overview"),
  sponsorOrders: (params: { q?: string; status?: "all" | SponsorOrderStatus; page?: number; size?: number }) =>
    request.get<{ page: number; size: number; total: number; list: AdminSponsorOrder[] }>("/admin/sponsor-orders", params),
  updateSponsorOrder: (id: number, payload: SponsorOrderPatch) =>
    request.patch<AdminSponsorOrder>(`/admin/sponsor-orders/${id}`, payload),
  sponsorLogs: (params: { q?: string; signOk?: "0" | "1"; page?: number; size?: number }) =>
    request.get<{ page: number; size: number; total: number; list: SponsorPaymentLog[] }>("/admin/sponsor-logs", params),
  // 帖子
  topics: (
    params: {
      q?: string;
      board?: string;
      hidden?: "0" | "1";
      reviewStatus?: AdminTopicReviewStatus | "";
      page?: number;
      size?: number;
    },
    options?: RequestOptions,
  ) =>
    request.get<{ page: number; size: number; total: number; list: AdminTopicRow[] }>("/admin/topics", params, options),
  updateTopic: (id: number, patch: AdminTopicPatch) =>
    request.patch<AdminTopicUpdateResult>(`/admin/topics/${id}`, patch),
  updateReply: (id: number, patch: {
    aiReviewStatus: "manual_reviewing" | "approved_manual" | "rejected_manual";
    manualReviewNote?: string;
  }) =>
    request.patch<AdminReplyUpdateResult>(`/admin/replies/${id}`, patch),
  reviewTarget: (kind: ReviewTargetKind, id: number) =>
    request.get<AdminReviewTarget>(`/admin/review-targets/${kind}/${id}`),
  reviewTargetImages: (kind: ReviewTargetKind, id: number) =>
    request.get<{ kind: ReviewTargetKind; id: number; topicId?: number; list: ForumImageReviewAsset[] }>(`/admin/review-targets/${kind}/${id}/images`),
  reviewTargetVideos: (kind: ReviewTargetKind, id: number) =>
    request.get<{ kind: ReviewTargetKind; id: number; topicId?: number; list: ForumVideoReviewAsset[] }>(`/admin/review-targets/${kind}/${id}/videos`),
  updateForumImage: (id: number, patch: {
    status: "approved" | "rejected";
    manualReviewNote?: string;
  }) =>
    request.patch<ForumImageReviewAsset>(`/admin/forum-images/${id}`, patch),
  forumVideos: (
    params?: {
      status?: "pending" | "manual_review" | "rejected" | "approved" | "error";
      page?: number;
      size?: number;
    },
    options?: RequestOptions,
  ) =>
    request.get<{ page: number; size: number; total: number; list: ForumVideoQueueRow[] }>("/admin/forum-videos", params, options),
  updateForumVideo: (id: number, patch: {
    status: "approved" | "rejected";
    manualReviewNote?: string;
  }) =>
    request.patch<ForumVideoReviewAsset>(`/admin/forum-videos/${id}`, patch),
  deleteTopic: (id: number) => request.delete<AdminTopicDeleteResult>(`/admin/topics/${id}`),
  destroyTopic: (id: number) => request.delete<AdminTopicDeleteResult>(`/admin/topics/${id}?hard=1`),
  // 板块
  boards: (options?: RequestOptions) => request.get<AdminBoard[]>("/admin/boards", undefined, options),
  createBoard: (payload: AdminBoardWriteInput) =>
    request.post<AdminBoard>("/admin/boards", payload),
  updateBoard: (id: number, payload: AdminBoardPatchInput) =>
    request.patch<AdminBoard>(`/admin/boards/${id}`, payload),
  deleteBoard: (id: number) =>
    request.delete<{ ok: true; deletedBoardId: number }>(`/admin/boards/${id}`),
  // 爬虫
  feeds: (options?: RequestOptions) => request.get<AdminFeedSource[]>("/admin/feeds", undefined, options),
  updateFeed: (id: number, patch: { enabled?: boolean; cronMinutes?: number; maxPages?: number }) =>
    request.patch<AdminFeedSource>(`/admin/feeds/${id}`, patch),
  runFeed: (id: number) => request.post<AdminFeedRunResult>(`/admin/feeds/${id}/run`),
  resetRunFeed: (id: number) => request.post<AdminFeedRunResult>(`/admin/feeds/${id}/reset-run`),
  runAllFeeds: () => request.post<AdminFeedRunListItem[]>("/admin/feeds/run-all"),
  // 逛逛同步
  weiwallSync: () => request.get<WeiwallSyncConfig>("/admin/weiwall-sync"),
  updateWeiwallSync: (patch: Partial<{
    enabled: boolean;
    baseUrl: string;
    schoolEn: string;
    tenantId: number;
    token: string;
    clearToken: boolean;
    intervalSeconds: number;
    topicPages: number;
    commentPageSize: number;
    maxCommentPages: number;
    maxReplyPages: number;
  }>) => request.patch<WeiwallSyncConfig>("/admin/weiwall-sync", patch),
  runWeiwallSync: () => request.post<WeiwallSyncRunResult>("/admin/weiwall-sync/run", {}),
  createWeiwallAuthLink: (origin?: string) => request.post<WeiwallTokenAuthSession>("/admin/weiwall-sync/auth-link", origin ? { origin } : {}),
  getWeiwallAuthStatus: (flowId: string) => request.get<WeiwallTokenAuthStatus>(`/admin/weiwall-sync/auth-status/${flowId}`),
  // 公告
  announcementSync: (options?: RequestOptions) => request.get<AnnouncementSyncStatus>("/admin/announcement-sync", undefined, options),
  authorizeAnnouncementSync: () => request.post<AnnouncementSyncStatus>("/admin/announcement-sync/authorize", {}, {
    suppressAuthRedirect: true,
    suppressAuthMessage: true,
    suppressErrorMessage: true,
  }),
  updateAnnouncementSync: (patch: { enabled?: boolean; intervalMinutes?: number }) => request.patch<AnnouncementSyncStatus>("/admin/announcement-sync", patch),
  runAnnouncementSync: () => request.post<{ synced: number; skipped: boolean; status: AnnouncementSyncStatus }>("/admin/announcement-sync/run", {}, {
    suppressAuthRedirect: true,
    suppressAuthMessage: true,
    suppressErrorMessage: true,
  }),
  clearAnnouncementSyncAuthorization: () => request.delete<AnnouncementSyncStatus>("/admin/announcement-sync/authorization"),
  announcements: (options?: RequestOptions) =>
    request.get<AdminAnnouncement[]>("/admin/announcements", undefined, options),
  createAnnouncement: (payload: AdminAnnouncementCreate) =>
    request.post<AdminAnnouncement>("/admin/announcements", payload),
  updateAnnouncement: (id: number, payload: AdminAnnouncementPatch) =>
    request.patch<AdminAnnouncement>(`/admin/announcements/${id}`, payload),
  deleteAnnouncement: (id: number) =>
    request.delete<{ ok: true }>(`/admin/announcements/${id}`),
};
