import { request, type RequestOptions } from "./request";
import type { MarketItem, MarketOrder, MarketUser } from "./market";

export interface LearningMaterialOption {
  value: string;
  label: string;
}

export interface LearningMaterialType {
  id: number;
  name: string;
  normalizedName: string;
  source: "builtin" | "seller";
  status: "pending" | "approved" | "rejected" | "merged";
  enabled: boolean;
  sort: number;
  createdById?: number | null;
  mergedIntoId?: number | null;
  createdAt: string;
  updatedAt: string;
  createdBy?: MarketUser | null;
  mergedInto?: LearningMaterialType | null;
  _count?: { profiles: number };
}

export interface LearningMaterialAdminOverview {
  activeItems: number;
  draftItems: number;
  incompleteProfiles: number;
  activeVersions: number;
  files: number;
  pendingTypes: number;
  escalatedTickets: number;
}

export interface LearningMaterialFile {
  id: number;
  originalName: string;
  mimeType: string;
  fileSize: number;
  format: string;
  pageCount?: number | null;
  previewEnabled: boolean;
  previewPageStart?: number | null;
  previewPageEnd?: number | null;
  status: string;
  createdAt: string;
}

export interface LearningMaterialVersion {
  id: number;
  versionNumber: number;
  label: string;
  releaseNotes: string;
  status: string;
  publishedAt?: string | null;
  review?: LearningMaterialReview | null;
  files: LearningMaterialFile[];
}

export interface LearningMaterialReview {
  id: number;
  versionId?: number;
  submittedById?: number;
  reviewedById?: number | null;
  round: number;
  status: "submitted" | "reviewing" | "approved" | "rejected";
  reason: string;
  submittedAt?: string;
  reviewedAt?: string | null;
  submittedBy?: MarketUser;
  reviewedBy?: MarketUser | null;
  version?: LearningMaterialVersion & {
    profile: LearningMaterialProfile & { item: LearningMaterialItem };
  };
}

export interface LearningMaterialProfile {
  id: number;
  courseCode: string;
  college: string;
  major: string;
  typeId?: number | null;
  type?: LearningMaterialType | null;
  applicableSemester: string;
  fileFormats: string[];
  pageCount?: number | null;
  versionLabel: string;
  language: string;
  originalityKind: string;
  originalityStatement: string;
  rightsConfirmed: boolean;
  commerceMode: "legacy_free" | "paid";
  metadataComplete: boolean;
  activeVersion?: LearningMaterialVersion | null;
  draftVersion?: LearningMaterialVersion | null;
  createdAt: string;
  updatedAt: string;
}

export interface LearningMaterialItem extends MarketItem {
  seller: MarketUser & {
    publisherActive?: boolean;
    creatorCertified?: boolean;
    creatorCertifiedAt?: string | null;
    creatorLevel?: "certified" | "reliable" | "excellent";
    creatorQualityScore?: number;
    creatorCompletedOrderCount?: number;
    creatorRatingCount?: number;
    creatorAverageRating?: number;
    creatorRefundRate?: number;
    creatorDisputeRate?: number;
    creatorAverageConfirmMinutes?: number | null;
  };
  material?: LearningMaterialProfile | null;
}

export interface LearningMaterialMeta {
  category: {
    id: number;
    slug: string;
    name: string;
    icon: string;
    description: string;
    fulfillmentType: "digital";
    imageRequired: boolean;
    enabled: boolean;
    sort: number;
    itemCount: number;
  };
  semesters: LearningMaterialOption[];
  formats: LearningMaterialOption[];
  languages: LearningMaterialOption[];
  originalityOptions: LearningMaterialOption[];
  supportCategories: Array<LearningMaterialOption & { financial: boolean }>;
  types: LearningMaterialType[];
  contentRules?: Array<{ id: number; scope: string; category: string; action: "block" | "review"; note: string }>;
  legacyIncompleteCount: number;
  commerce?: LearningCommerceStatus;
}

export interface LearningCommerceStatus {
  paidEnabled: boolean;
  minPriceCents: number;
  maxPriceCents: number;
  minPrice: string;
  maxPrice: string;
  paymentMode: "seller_direct";
  platformFeeBps: 0;
  notice?: string;
}

export type LearningCollectionProvider = "wechat" | "alipay";

export interface LearningCollectionMethod {
  id: number;
  provider: LearningCollectionProvider;
  label: string;
  versionNumber: number;
  status: "active" | "disabled";
  assetId: number;
  qrImageUrl: string;
  createdAt: string;
  disabledAt?: string | null;
}

export interface LearningCreatorApplication {
  id: number;
  userId: number;
  status: "submitted" | "reviewing" | "approved" | "rejected" | "withdrawn";
  expertise: string;
  experience: string;
  sampleDescription: string;
  reviewReason: string;
  submittedAt: string;
  reviewedAt?: string | null;
  user?: MarketUser;
  reviewedBy?: MarketUser | null;
}

export interface LearningCreatorProfile {
  id: number;
  userId: number;
  status: "active" | "suspended" | "revoked";
  certifiedAt?: string | null;
  statusReason: string;
  level: "certified" | "reliable" | "excellent";
  qualityScore: number;
  completedOrderCount: number;
  ratingCount: number;
  averageRatingBps: number;
  refundRateBps: number;
  disputeRateBps: number;
  averageConfirmMinutes?: number | null;
  metricsUpdatedAt?: string | null;
  collectionMethods: LearningCollectionMethod[];
}

export interface LearningCreatorContext {
  publishingAllowed: boolean;
  publishingStatus: "active" | "suspended" | "revoked";
  profile: LearningCreatorProfile | null;
  application: LearningCreatorApplication | null;
}

export type LearningCommerceOrderStatus =
  | "pending_payment"
  | "awaiting_seller_confirmation"
  | "delivered"
  | "completed"
  | "refunded"
  | "cancelled"
  | "expired"
  | "disputed";

export interface LearningPaymentEvidence {
  id: number;
  attempt: number;
  status: "submitted" | "accepted" | "rejected" | "superseded";
  claimedPaidAt?: string | null;
  buyerNote: string;
  handledReason: string;
  handledAt?: string | null;
  createdAt: string;
  imageUrl?: string;
}

export interface LearningOrderEvent {
  id: number;
  sequence: number;
  type: string;
  actorId?: number | null;
  fromStatus?: LearningCommerceOrderStatus | null;
  toStatus?: LearningCommerceOrderStatus | null;
  createdAt: string;
}

export interface LearningOrderIssue {
  id: number;
  type: string;
  status: "open" | "waiting_buyer" | "waiting_seller" | "refund_requested" | "refund_recorded" | "resolved" | "closed";
  reason: string;
  detail: string;
  refundAmountCents?: number | null;
  resolution: string;
  responsibility: "unassigned" | "buyer" | "creator" | "platform" | "shared" | "no_fault";
  slaDueAt?: string | null;
  overdue?: boolean;
  assignedToId?: number | null;
  assignedTo?: MarketUser | null;
  assignedAt?: string | null;
  firstRespondedAt?: string | null;
  refundEvidenceUnavailable?: string;
  messages: LearningOrderIssueMessage[];
  createdAt: string;
  resolvedAt?: string | null;
}

export interface LearningOrderIssueMessage {
  id: number;
  issueId: number;
  senderId?: number | null;
  kind: "user" | "staff" | "system";
  content: string;
  createdAt: string;
  sender?: MarketUser | null;
  attachment?: {
    id: number;
    kind: "dispute_attachment" | "refund_evidence";
    originalName: string;
    mimeType: string;
    fileSize: number;
    imageUrl: string;
  } | null;
}

export interface LearningMaterialRating {
  id: number;
  commerceOrderId: number;
  itemId: number;
  buyerId: number;
  creatorId: number;
  accuracy: number;
  usefulness: number;
  descriptionMatch: number;
  fileQuality: number;
  overall: number;
  content: string;
  status: "published" | "hidden" | "excluded";
  createdAt: string;
  updatedAt: string;
  buyer?: MarketUser;
}

export interface LearningMaterialRatingResult {
  summary: {
    count: number;
    overall: number;
    accuracy: number;
    usefulness: number;
    descriptionMatch: number;
    fileQuality: number;
  };
  list: LearningMaterialRating[];
}

export interface LearningCreatorAppeal {
  id: number;
  violationId: number;
  userId: number;
  content: string;
  status: "pending" | "approved" | "rejected";
  handleNote: string;
  handledAt?: string | null;
  createdAt: string;
  user?: MarketUser;
  handledBy?: MarketUser | null;
}

export interface LearningCreatorViolation {
  id: number;
  creatorId: number;
  itemId?: number | null;
  commerceOrderId?: number | null;
  type: string;
  severity: "low" | "medium" | "high" | "critical";
  action: "warn" | "hide_material" | "suspend_7d" | "suspend_30d" | "revoke";
  reason: string;
  evidence: string;
  status: "active" | "revoked" | "expired";
  expiresAt?: string | null;
  createdAt: string;
  creator?: MarketUser;
  createdBy?: MarketUser;
  appeals: LearningCreatorAppeal[];
}

export interface LearningOperationsOverview {
  generatedAt: string;
  slaHours: { materialReview: number; issueFirstResponse: number };
  queues: Record<"materialReviews" | "orderIssues" | "sellerConfirmations", {
    pending: number;
    overdue: number;
  }>;
  funnel30d: {
    activeItems: number;
    samplePreviews: number;
    orders: number;
    awaitingSellerConfirmation: number;
    delivered: number;
    completed: number;
    refunded: number;
    onlinePreviews: number;
    downloads: number;
    ratings: number;
    completionRate: number;
    refundRate: number;
  };
}

export interface LearningCommerceOrder {
  id: number;
  orderId: number;
  mode: "paid" | "legacy_free";
  status: LearningCommerceOrderStatus;
  statusVersion: number;
  priceCents: number;
  amount: string;
  currency: "CNY";
  paymentDueAt?: string | null;
  sellerResponseDueAt?: string | null;
  deliveredAt?: string | null;
  completionDueAt?: string | null;
  completedAt?: string | null;
  refundedAt?: string | null;
  cancelledAt?: string | null;
  cancelReason: string;
  createdAt: string;
  updatedAt: string;
  order: {
    id: number;
    itemId: number;
    buyerId: number;
    sellerId: number;
    outTradeNo: string;
    amountCents: number;
    amount: string;
    platformFeeCents: number;
    status: string;
    buyer: MarketUser;
    seller: MarketUser;
    item: {
      id: number;
      title: string;
      description: string;
      priceCents: number;
      cover: string;
      courseCode: string;
    };
  };
  version: LearningMaterialVersion;
  collectionMethod: LearningCollectionMethod | null;
  paymentEvidence: LearningPaymentEvidence[];
  events: LearningOrderEvent[];
  issues: LearningOrderIssue[];
  rating?: LearningMaterialRating | null;
  mine: { buyer: boolean; seller: boolean; staff: boolean };
}

export interface LearningAdminOrderIssue extends LearningOrderIssue {
  commerceOrderId: number;
  requestedById: number;
  requestedBy: MarketUser;
  resolvedBy?: MarketUser | null;
  refundAmount?: string | null;
  updatedAt: string;
  order: LearningCommerceOrder;
}

export interface LearningMaterialProfileInput {
  courseCode: string;
  college?: string;
  major?: string;
  typeId?: number | null;
  applicableSemester?: string | null;
  fileFormats?: string[];
  pageCount?: number | null;
  versionLabel?: string;
  language?: string;
  originalityKind?: string;
  originalityStatement?: string;
  rightsConfirmed: boolean;
}

export interface LearningMaterialItemInput {
  title: string;
  description: string;
  price: number | string;
  originalPrice?: number | string | null;
  images?: string[];
  profile: LearningMaterialProfileInput;
  draft?: boolean;
  status?: string;
}

export interface LearningMaterialListParams {
  page?: number;
  size?: number;
  q?: string;
  courseCode?: string;
  semester?: string;
  college?: string;
  major?: string;
  typeId?: number | string;
  format?: string;
  sort?: "new" | "popular" | "price_asc" | "price_desc";
  status?: string;
}

export interface LearningMaterialLibraryEntry {
  id: number;
  grantedAt: string;
  lastAccessedAt?: string | null;
  downloadCount: number;
  order: MarketOrder;
  learningCommerceOrder?: {
    id: number;
    status: LearningCommerceOrderStatus;
    priceCents: number;
  } | null;
  version: LearningMaterialVersion & { profile: LearningMaterialProfile & { item: LearningMaterialItem } };
}

export interface LearningMaterialSupportMessage {
  id: number;
  ticketId: number;
  senderId?: number | null;
  kind: "user" | "system";
  content: string;
  createdAt: string;
  sender?: MarketUser | null;
}

export interface LearningMaterialSupportTicket {
  id: number;
  orderId: number;
  buyerId: number;
  sellerId: number;
  category: string;
  status: string;
  responseDueAt?: string | null;
  resolvedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  order?: MarketOrder;
  buyer?: MarketUser;
  seller?: MarketUser;
  messages?: LearningMaterialSupportMessage[];
}

function idempotencyOptions(): RequestOptions {
  const key = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return { headers: { "Idempotency-Key": key } };
}

export const learningMaterialsApi = {
  meta: (options?: RequestOptions) => request.get<LearningMaterialMeta>("/market/materials/meta", undefined, options),
  types: (options?: RequestOptions) => request.get<LearningMaterialType[]>("/market/materials/types", undefined, options),
  createType: (name: string) => request.post<LearningMaterialType>("/market/materials/types", { name }),
  items: (params?: LearningMaterialListParams, options?: RequestOptions) => request.get<{ page: number; size: number; total: number; list: LearningMaterialItem[] }>("/market/materials/items", params as Record<string, unknown>, options),
  myItems: (options?: RequestOptions) => request.get<LearningMaterialItem[]>("/market/materials/my-items", undefined, options),
  item: (id: number, options?: RequestOptions) => request.get<LearningMaterialItem>(`/market/materials/items/${id}`, undefined, options),
  createItem: (payload: LearningMaterialItemInput) => request.post<LearningMaterialItem>("/market/materials/items", payload),
  updateItem: (id: number, payload: Partial<LearningMaterialItemInput>) => request.patch<LearningMaterialItem>(`/market/materials/items/${id}`, payload),
  purchase: (id: number) => request.post<LearningCommerceOrder>(`/market/materials/items/${id}/purchase`, undefined, idempotencyOptions()),
  uploadVersion: (
    id: number,
    files: File[],
    payload: {
      label?: string;
      releaseNotes?: string;
      previewRanges?: Array<{ start: number; end: number } | null>;
    },
    options?: RequestOptions,
  ) => {
    const data = new FormData();
    files.forEach((file) => data.append("files", file, file.name));
    data.append("label", payload.label || "");
    data.append("releaseNotes", payload.releaseNotes || "");
    data.append("previewRanges", JSON.stringify(payload.previewRanges || files.map(() => null)));
    return request.post<LearningMaterialVersion>(`/market/materials/items/${id}/versions`, data, options);
  },
  publishVersion: (itemId: number, versionId: number) => request.post<LearningMaterialReview>(`/market/materials/items/${itemId}/versions/${versionId}/publish`),
  submitVersionReview: (itemId: number, versionId: number) => request.post<LearningMaterialReview>(`/market/materials/commerce/items/${itemId}/versions/${versionId}/reviews`),
  library: (options?: RequestOptions) => request.get<LearningMaterialLibraryEntry[]>("/market/materials/library", undefined, options),
  downloadUrl: (fileId: number) => `/api/market/materials/files/${fileId}/download`,
  viewUrl: (fileId: number) => `/api/market/materials/files/${fileId}/view`,
  sampleUrl: (itemId: number, fileId: number) => `/api/market/materials/items/${itemId}/files/${fileId}/sample`,
  ratings: (itemId: number, options?: RequestOptions) =>
    request.get<LearningMaterialRatingResult>(`/market/materials/items/${itemId}/ratings`, undefined, options),
  supportTickets: (options?: RequestOptions) => request.get<LearningMaterialSupportTicket[]>("/market/materials/support", undefined, options),
  createSupport: (orderId: number, payload: { category: string; message: string }) => request.post<LearningMaterialSupportTicket>(`/market/materials/orders/${orderId}/support`, payload),
  support: (id: number, options?: RequestOptions) => request.get<LearningMaterialSupportTicket>(`/market/materials/support/${id}`, undefined, options),
  sendSupportMessage: (id: number, content: string) => request.post<LearningMaterialSupportMessage>(`/market/materials/support/${id}/messages`, { content }),
  updateSupport: (id: number, action: "resolve" | "reopen" | "escalate") => request.patch<LearningMaterialSupportTicket>(`/market/materials/support/${id}`, { action }),
  adminOverview: (options?: RequestOptions) => request.get<LearningMaterialAdminOverview>("/market/materials/admin/overview", undefined, options),
  adminTypes: (options?: RequestOptions) => request.get<LearningMaterialType[]>("/market/materials/admin/types", undefined, options),
  adminUpdateType: (id: number, payload: { action: "approve" | "reject" | "enable" | "disable" | "merge"; targetTypeId?: number }) => request.patch<LearningMaterialType>(`/market/materials/admin/types/${id}`, payload),
  commerceStatus: (options?: RequestOptions) => request.get<LearningCommerceStatus>("/market/materials/commerce/status", undefined, options),
  creatorContext: (options?: RequestOptions) => request.get<LearningCreatorContext>("/market/materials/commerce/creator/me", undefined, options),
  applyCreator: (payload: { expertise: string; experience: string; sampleDescription: string; rightsCommitted: true }) =>
    request.post<LearningCreatorApplication>("/market/materials/commerce/creator/applications", payload),
  createCollectionMethod: (provider: LearningCollectionProvider, label: string, image: File) => {
    const data = new FormData();
    data.append("provider", provider);
    data.append("label", label);
    data.append("image", image, image.name);
    return request.post<LearningCollectionMethod>("/market/materials/commerce/creator/collection-methods", data);
  },
  disableCollectionMethod: (id: number) => request.delete<LearningCollectionMethod>(`/market/materials/commerce/creator/collection-methods/${id}`),
  createOrder: (itemId: number, provider?: LearningCollectionProvider) =>
    request.post<LearningCommerceOrder>(`/market/materials/commerce/items/${itemId}/orders`, provider ? { provider } : {}, idempotencyOptions()),
  orders: (side: "buyer" | "seller" | "all" = "buyer", options?: RequestOptions) =>
    request.get<LearningCommerceOrder[]>("/market/materials/commerce/orders", { side }, options),
  order: (id: number, options?: RequestOptions) =>
    request.get<LearningCommerceOrder>(`/market/materials/commerce/orders/${id}`, undefined, options),
  submitPaymentEvidence: (id: number, image: File, payload: { claimedPaidAt?: string; buyerNote?: string }) => {
    const data = new FormData();
    data.append("image", image, image.name);
    if (payload.claimedPaidAt) data.append("claimedPaidAt", payload.claimedPaidAt);
    data.append("buyerNote", payload.buyerNote || "");
    return request.post<LearningCommerceOrder>(`/market/materials/commerce/orders/${id}/payment-evidence`, data, idempotencyOptions());
  },
  confirmPaymentEvidence: (orderId: number, evidenceId: number) =>
    request.post<LearningCommerceOrder>(`/market/materials/commerce/orders/${orderId}/payment-evidence/${evidenceId}/confirm`, undefined, idempotencyOptions()),
  rejectPaymentEvidence: (orderId: number, evidenceId: number, reason: string) =>
    request.post<LearningCommerceOrder>(`/market/materials/commerce/orders/${orderId}/payment-evidence/${evidenceId}/reject`, { reason }, idempotencyOptions()),
  completeOrder: (id: number) =>
    request.post<LearningCommerceOrder>(`/market/materials/commerce/orders/${id}/complete`, undefined, idempotencyOptions()),
  rateOrder: (
    id: number,
    payload: Pick<LearningMaterialRating, "accuracy" | "usefulness" | "descriptionMatch" | "fileQuality" | "content">,
  ) => request.put<LearningMaterialRating>(`/market/materials/commerce/orders/${id}/rating`, payload),
  cancelOrder: (id: number, reason: string) =>
    request.post<LearningCommerceOrder>(`/market/materials/commerce/orders/${id}/cancel`, { reason }, idempotencyOptions()),
  openOrderIssue: (id: number, payload: { type: string; reason: string; detail?: string }) =>
    request.post<LearningOrderIssue>(`/market/materials/commerce/orders/${id}/issues`, payload),
  sendOrderIssueMessage: (
    orderId: number,
    issueId: number,
    payload: { content: string; image?: File; attachmentKind?: "dispute_attachment" | "refund_evidence" },
  ) => {
    const data = new FormData();
    data.append("content", payload.content);
    data.append("attachmentKind", payload.attachmentKind || "dispute_attachment");
    if (payload.image) data.append("image", payload.image, payload.image.name);
    return request.post<LearningOrderIssueMessage>(
      `/market/materials/commerce/orders/${orderId}/issues/${issueId}/messages`,
      data,
    );
  },
  creatorViolations: (options?: RequestOptions) =>
    request.get<LearningCreatorViolation[]>("/market/materials/commerce/creator/violations", undefined, options),
  appealCreatorViolation: (id: number, content: string) =>
    request.post<LearningCreatorAppeal>(`/market/materials/commerce/creator/violations/${id}/appeal`, { content }),
  adminCreatorApplications: (status = "submitted", options?: RequestOptions) =>
    request.get<LearningCreatorApplication[]>("/market/materials/commerce/admin/creator-applications", { status }, options),
  adminReviewCreator: (id: number, payload: { action: "approve" | "reject"; reason: string }) =>
    request.patch<LearningCreatorApplication>(`/market/materials/commerce/admin/creator-applications/${id}`, payload),
  adminMaterialReviews: (status = "submitted", options?: RequestOptions) =>
    request.get<LearningMaterialReview[]>("/market/materials/commerce/admin/material-reviews", { status }, options),
  adminReviewMaterial: (id: number, payload: { action: "approve" | "reject"; reason: string; checklist: { rights: boolean; quality: boolean; fileSafety: boolean } }) =>
    request.patch<LearningMaterialReview & { itemId: number; versionId: number }>(`/market/materials/commerce/admin/material-reviews/${id}`, payload),
  adminOrderIssues: (status: "active" | "resolved" | "all" = "active", options?: RequestOptions) =>
    request.get<LearningAdminOrderIssue[]>("/market/materials/commerce/admin/issues", { status }, options),
  adminDecideOrderIssue: (
    orderId: number,
    issueId: number,
    payload: {
      action: "resolve" | "close" | "record_refund";
      resolution: string;
      refundAmountCents?: number;
      responsibility: "buyer" | "creator" | "platform" | "shared" | "no_fault";
      refundEvidenceUnavailable?: string;
    },
  ) => request.patch<LearningCommerceOrder>(`/market/materials/commerce/admin/orders/${orderId}/issues/${issueId}`, payload),
  adminClaimOrderIssue: (orderId: number, issueId: number) =>
    request.post<LearningCommerceOrder>(`/market/materials/commerce/admin/orders/${orderId}/issues/${issueId}/claim`),
  adminOperations: (options?: RequestOptions) =>
    request.get<LearningOperationsOverview>("/market/materials/commerce/admin/operations", undefined, options),
  adminCreatorViolations: (creatorId?: number, options?: RequestOptions) =>
    request.get<LearningCreatorViolation[]>("/market/materials/commerce/admin/creator-violations", { creatorId }, options),
  adminCreateCreatorViolation: (payload: {
    creatorId: number;
    itemId?: number;
    commerceOrderId?: number;
    type: string;
    severity: "low" | "medium" | "high" | "critical";
    action: "warn" | "hide_material" | "suspend_7d" | "suspend_30d" | "revoke";
    reason: string;
    evidence?: string;
  }) => request.post<LearningCreatorViolation>("/market/materials/commerce/admin/creator-violations", payload),
  adminDecideCreatorAppeal: (id: number, payload: { action: "approve" | "reject"; note: string }) =>
    request.patch<LearningCreatorAppeal>(`/market/materials/commerce/admin/creator-appeals/${id}`, payload),
};
