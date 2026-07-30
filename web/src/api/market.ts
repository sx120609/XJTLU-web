import { request, type RequestOptions } from "./request";
import type { EpaySubmit, PayType } from "./payments";

export type MarketCategory = string;
export type MarketCondition = "new" | "like_new" | "good" | "fair" | "wanted";
export type MarketTradeMode = "meetup" | "shipping" | "online" | "any";
export type MarketListingType = "sell" | "wanted";
export type MarketItemStatus =
  | "draft"
  | "reviewing"
  | "active"
  | "negotiating"
  | "reserved"
  | "sold"
  | "withdrawn"
  | "expired"
  | "hidden"
  | "targeted";
export type MarketItemLifecycleAction = "renew" | "withdraw" | "mark_sold" | "relist";
export const MARKET_CAMPUSES = ["SIP", "TC"] as const;
export type MarketCampus = typeof MARKET_CAMPUSES[number];

export const MARKET_CONDITION_LABELS: Record<Exclude<MarketCondition, "wanted">, string> = {
  new: "全新",
  like_new: "近全新",
  good: "使用良好",
  fair: "有使用痕迹",
};

export const MARKET_TRADE_MODE_LABELS: Record<MarketTradeMode, string> = {
  meetup: "校园面交",
  shipping: "邮寄",
  online: "线上交付",
  any: "任意交付方式",
};

export function marketConditionLabel(value: string) {
  return value === "wanted" ? "求购" : MARKET_CONDITION_LABELS[value as Exclude<MarketCondition, "wanted">] || value;
}

export function marketTradeModeLabel(value: string) {
  return value === "both" ? MARKET_TRADE_MODE_LABELS.any : MARKET_TRADE_MODE_LABELS[value as MarketTradeMode] || value;
}

export function normalizeMarketCampus(value: unknown): MarketCampus | "" {
  const input = String(value ?? "").trim();
  if (!input) return "";
  const upper = input.toUpperCase();
  if (["SIP", "SIP CAMPUS", "SIP校区", "SIP 校区", "SUZHOU", "苏州", "苏州校区", "西浦"].some((alias) => alias.toUpperCase() === upper)) return "SIP";
  if (["TC", "TC CAMPUS", "TC校区", "TC 校区", "TAICANG", "太仓", "太仓校区"].some((alias) => alias.toUpperCase() === upper)) return "TC";
  return "";
}

export function isMarketCampus(value: string): value is MarketCampus {
  return (MARKET_CAMPUSES as readonly string[]).includes(value);
}

export interface MarketCategoryOption {
  id: number;
  slug: string;
  name: string;
  icon: string;
  description: string;
  fulfillmentType: "physical" | "digital";
  imageRequired: boolean;
  enabled: boolean;
  sort: number;
  itemCount?: number;
  special?: boolean;
}

export interface MarketMeta {
  categories: MarketCategoryOption[];
  wantedCategories: MarketCategoryOption[];
  campuses: MarketCampus[];
  featuredLearningMaterials: MarketCategoryOption | null;
  conditions: Array<Exclude<MarketCondition, "wanted">>;
  tradeModes: MarketTradeMode[];
  listingTypes: MarketListingType[];
  payTypes: PayType[];
  paymentEnabled: boolean;
  commissionBps: number;
  commissionRate: number;
  learningMaterialCommissionBps: number;
  learningMaterialCommissionRate: number;
  updatedAt: string;
}

export interface MarketUser {
  id: number;
  username?: string;
  nickname: string;
  avatar?: string | null;
  role: string;
  studentSso?: boolean;
  marketPositiveRate?: number;
  createdAt?: string;
}

export interface MarketDisplayUser extends Omit<MarketUser, "id"> {
  id: number | null;
  anonymous?: boolean;
}

export interface PromotionBadge {
  orderId: number;
  type: "listing_pin" | "wanted_urgent" | "home_featured" | "merchant_homepage";
  label: "置顶" | "加急" | "推广" | "合作商户";
  expiresAt: string;
}

export interface PromotionPlan {
  id: number;
  code: string;
  name: string;
  type: PromotionBadge["type"];
  targetType: "market_item" | "wanted_post" | "merchant_profile";
  placement: "market" | "wanted" | "home" | "merchant";
  description: string;
  price: string;
  priceCents: number;
  manualCost: string;
  manualCostCents: number;
  durationDays: number;
  maxActive: number;
  enabled: boolean;
  sort: number;
  typeLabel: string;
  badgeLabel: string;
}

export type PromotionScope = "content" | "merchant";

export interface PromotionAdjustment {
  id: number;
  orderId: number;
  type: "service_extension" | "refund_record" | "compensation_record" | "invoice_record" | "complaint_record";
  amount: string;
  amountCents: number;
  extensionDays: number;
  reference?: string;
  referenceMasked: string;
  note: string;
  actor?: { id: number; nickname: string } | null;
  createdAt: string;
}

export interface PromotionOrder {
  id: number;
  userId: number;
  planId: number;
  marketItemId?: number | null;
  wantedPostId?: number | null;
  merchantProfileId?: number | null;
  outTradeNo: string;
  planCode: string;
  planName: string;
  type: PromotionBadge["type"];
  targetType: PromotionPlan["targetType"];
  placement: PromotionPlan["placement"];
  amount: string;
  amountCents: number;
  manualCost: string;
  manualCostCents: number;
  durationDays: number;
  paymentMode: "manual";
  status: "waitlisted" | "pending" | "confirmed" | "rejected" | "cancelled" | "expired";
  paymentCode?: string;
  paymentQrUrl?: string;
  paymentSubmittedAt?: string | null;
  paymentExpiresAt?: string | null;
  reservesSlot: boolean;
  waitlistedAt?: string | null;
  slotNotifiedAt?: string | null;
  applicantNote: string;
  adminNote: string;
  verificationMethod: string;
  verificationReference?: string;
  verificationReferenceMasked: string;
  verifiedAmount?: string | null;
  verifiedAmountCents?: number | null;
  startsAt?: string | null;
  expiresAt?: string | null;
  impressionCount: number;
  clickCount: number;
  ctr: number;
  inquiriesAttributed: number;
  adjustments: PromotionAdjustment[];
  typeLabel: string;
  badgeLabel: string;
  marketItem?: { id: number; title: string; status: string } | null;
  wantedPost?: { id: number; title: string; status: string } | null;
  merchantProfile?: { id: number; slug: string; name: string; status: string } | null;
  user?: MarketUser;
  createdAt: string;
}

export interface MarketItem {
  id: number;
  topicId?: number | null;
  sellerId: number;
  listingType: MarketListingType;
  title: string;
  description: string;
  category: MarketCategory;
  deliveryType: "physical" | "digital";
  hasDigitalDelivery: boolean;
  price: string;
  priceCents: number;
  originalPrice?: string | null;
  originalPriceCents?: number | null;
  negotiable: boolean;
  condition: MarketCondition;
  tradeMode: MarketTradeMode;
  campus: string;
  location: string;
  brand: string;
  model: string;
  usageDuration: string;
  flaws: string;
  accessories: string;
  testAllowed: boolean;
  availableTime: string;
  expiresAt?: string | null;
  renewedAt?: string | null;
  visibility: "public" | "targeted";
  status: MarketItemStatus;
  viewCount: number;
  favoriteCount: number;
  offerCount: number;
  hotScore: number;
  hotReasons: string[];
  hotScoreUpdatedAt?: string | null;
  boostedUntil?: string | null;
  boostPointsSpent?: number;
  images: Array<{ id: number; url: string; sort: number }>;
  cover: string;
  seller: MarketUser;
  topic?: { id: number; replyCount: number; likeCount: number; hidden: boolean; aiReviewStatus: string } | null;
  favorited: boolean;
  mine: boolean;
  sellerRating?: number;
  sellerReviewCount?: number;
  promotions: { pinned: PromotionBadge | null; home: PromotionBadge | null; promoted: boolean };
  soldAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MarketRefund {
  id: number;
  orderId: number;
  requestedById: number;
  amountCents: number;
  reason: string;
  status: "pending" | "approved" | "completed" | "rejected" | "failed";
  providerRefundNo?: string | null;
  handledById?: number | null;
  handledNote?: string;
  handledAt?: string | null;
  createdAt: string;
}

export interface MarketSettlement {
  id: number;
  orderId: number;
  sellerId: number;
  amountCents: number;
  amount: string;
  status: "pending" | "available" | "held" | "settled";
  availableAt?: string | null;
  settledAt?: string | null;
  reference: string;
  note: string;
  createdAt: string;
  updatedAt: string;
  order?: MarketOrder;
}

export interface MarketPayoutProfile {
  method: "alipay" | "wxpay" | "bank";
  accountMasked: string;
  realNameMasked: string;
  verified: boolean;
  updatedAt: string;
}

export type MarketOrderAction =
  | "buyer_confirm"
  | "seller_confirm"
  | "cancel"
  | "request_refund"
  | "dispute";

export interface MarketOrderUpdateInput {
  action: MarketOrderAction;
  note?: string;
  reason?: string;
}

export interface MarketOrder {
  id: number;
  itemId: number;
  offerId: number | null;
  tradeIntentId?: number | null;
  wantedPostId?: number | null;
  wantedResponseId?: number | null;
  buyerId: number;
  sellerId: number;
  outTradeNo: string;
  payType: string;
  amount: string;
  amountCents: number;
  platformFee: string;
  sellerAmount: string;
  status: string;
  expiresAt?: string | null;
  paidAt?: string | null;
  completedAt?: string | null;
  refundedAt?: string | null;
  createdAt: string;
  updatedAt?: string;
  meetupTime?: string | null;
  meetupLocation?: string;
  cancelReason?: string;
  cancelledById?: number | null;
  noShowParty?: "buyer" | "seller" | "";
  buyerConfirmedAt?: string | null;
  sellerConfirmedAt?: string | null;
  deliveryType: "physical" | "digital";
  digitalDelivery?: string | null;
  digitalDeliveredAt?: string | null;
  item?: MarketItem;
  buyer?: MarketUser;
  seller?: MarketUser;
  refunds?: MarketRefund[];
  reviews?: MarketReview[];
  settlement?: MarketSettlement | null;
  conversation?: { id: number } | null;
  conversationId?: number | null;
}

export const MARKET_PRIVATE_TRADE_STATUSES = [
  "negotiating",
  "reserved",
  "paid",
  "delivering",
  "completed",
  "cancelled",
  "disputed",
  "no_show",
] as const;

export type MarketOrderActionResult =
  | MarketOrder
  | MarketRefund
  | { refund: MarketRefund; order: MarketOrder };

export interface MarketSellerDashboard {
  config: { commissionBps: number; commissionRate: number; learningMaterialCommissionBps: number; learningMaterialCommissionRate: number; updatedAt: string };
  stats: {
    activeListings: number;
    reservedListings: number;
    soldListings: number;
    pendingDeliveryOrders: number;
    pendingSettlementOrders: number;
  };
  balance: {
    grossCents: number;
    commissionCents: number;
    pendingCents: number;
    frozenCents: number;
    availableCents: number;
    settledCents: number;
  };
  items: MarketItem[];
  orders: MarketOrder[];
  settlements: MarketSettlement[];
  timeline: Array<{
    key: string;
    orderId: number;
    type: "payment" | "settlement" | "refunded";
    title: string;
    amount: string;
    amountCents: number;
    platformFee: string;
    platformFeeCents: number;
    status: string;
    occurredAt: string;
    reference?: string;
  }>;
  payoutProfile: MarketPayoutProfile | null;
}

export interface MarketConversationItem {
  id: number;
  sellerId: number;
  listingType: MarketListingType;
  title: string;
  category: MarketCategory;
  deliveryType: "physical";
  price: string;
  priceCents: number;
  status: MarketItemStatus;
  images: Array<{ id: number; url: string; sort: number }>;
  cover: string;
  createdAt: string;
  updatedAt: string;
}

export interface MarketConversation {
  id: number;
  itemId: number;
  orderId?: number | null;
  buyerId: number;
  sellerId: number;
  item: MarketConversationItem;
  buyer: MarketUser;
  seller: MarketUser;
  counterpart: MarketUser;
  order?: MarketOrder | null;
  lastMessage?: MarketMessage | null;
  lastMessageAt?: string | null;
  unreadCount: number;
  blockedByMe: boolean;
  blockedByCounterpart: boolean;
}

export type MarketConversationFilter =
  | "all"
  | "unread"
  | "pending_confirmation"
  | "completed";

export interface MarketConversationUnreadSummary {
  unreadCount: number;
  conversationCount: number;
}

export interface MarketConversationCompletionResult {
  conversationId: number;
  status: string;
  buyerConfirmedAt?: string | null;
  sellerConfirmedAt?: string | null;
  completed: boolean;
  pointsIssued: boolean;
  rewards: {
    buyer: number;
    seller: number;
  };
  order: MarketOrder;
}

export interface MarketMessage {
  id: number;
  conversationId: number;
  senderId: number;
  content: string;
  kind: "text" | "image" | "system";
  clientMessageId?: string | null;
  attachments: Array<{
    id: number;
    url: string;
    mimeType: string;
    sort: number;
  }>;
  readAt?: string | null;
  createdAt: string;
  sender?: MarketUser;
}

export interface MarketItemInput {
  catalog?: "market" | "learning_materials";
  listingType: MarketListingType;
  title: string;
  description: string;
  category: MarketCategory;
  price: string | number;
  originalPrice?: string | number | null;
  negotiable?: boolean;
  condition: MarketCondition;
  tradeMode: MarketTradeMode;
  campus?: string;
  location?: string;
  brand?: string;
  model?: string;
  usageDuration?: string;
  flaws?: string;
  accessories?: string;
  testAllowed?: boolean;
  availableTime?: string;
  images?: string[];
  digitalDelivery?: string;
  draft?: boolean;
}

export type MarketItemPatchInput = Partial<MarketItemInput> & {
  status?: MarketItemStatus;
};

export type MarketListParams = {
  page?: number;
  size?: number;
  q?: string;
  category?: string;
  listingType?: string;
  condition?: string;
  tradeMode?: string;
  campus?: string;
  minPrice?: number | string;
  maxPrice?: number | string;
  sort?: "new" | "price_asc" | "price_desc" | "popular";
  status?: string;
};

export interface TradeIntent {
  id: number;
  itemId: number;
  buyerId: number;
  proposedPriceCents: number;
  price: string;
  message: string;
  availableTime: string;
  status: "pending" | "accepted" | "rejected" | "cancelled" | "expired";
  expiresAt: string;
  acceptedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  buyer?: MarketUser;
  item?: MarketItem;
  reservation?: MarketOrder | null;
  conversationId?: number | null;
}

export interface MarketOffer {
  id: number;
  itemId: number;
  buyerId: number;
  priceCents: number;
  price: string;
  message: string;
  status: "pending" | "accepted" | "rejected" | "cancelled" | "expired";
  item?: MarketItem;
  buyer?: MarketUser;
  order?: MarketOrder | null;
  conversationId?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface MarketTradeIntentInput {
  price: string | number;
  message?: string;
  availableTime: string;
}

export interface MarketOfferInput {
  price: string | number;
  message?: string;
}

export type MarketTradeAction = "accept" | "reject" | "cancel";

export interface WantedPost {
  id: number;
  authorId: number | null;
  title: string;
  category: string;
  budgetMinCents: number;
  budgetMaxCents: number;
  budgetMin: string;
  budgetMax: string;
  brandModel: string;
  condition: string;
  expectedTradeTime: string;
  campus: string;
  location: string;
  description: string;
  allowSellerOffers: boolean;
  isAnonymous: boolean;
  anonymousAlias: string | null;
  status: "reviewing" | "active" | "responded" | "matched" | "completed" | "cancelled" | "expired" | "removed";
  expiresAt: string;
  responseCount: number;
  viewCount: number;
  hotScore: number;
  hotReasons: string[];
  hotScoreUpdatedAt?: string | null;
  boostedUntil?: string | null;
  boostPointsSpent?: number;
  mine: boolean;
  topicId: number | null;
  topicUrl: string | null;
  author: MarketDisplayUser;
  responses?: WantedResponse[];
  promotion: { urgent: PromotionBadge | null; promoted: boolean };
  createdAt: string;
  updatedAt: string;
}

export interface WantedListParams extends Record<string, unknown> {
  page?: number;
  size?: number;
  q?: string;
  category?: string;
  campus?: MarketCampus | "";
  status?: Extract<WantedPost["status"], "active" | "responded">;
  sort?: "new" | "popular";
}

export interface WantedResponse {
  id: number;
  wantedPostId: number;
  sellerId: number;
  itemId: number;
  priceCents: number;
  price: string;
  description: string;
  availableTime: string;
  status: "pending" | "accepted" | "rejected" | "cancelled" | "expired";
  seller?: MarketUser;
  item: MarketItem;
  wantedPost?: WantedPost;
  reservation?: MarketOrder | null;
  createdAt: string;
  updatedAt: string;
}

export interface WantedResponseInput {
  itemId?: number;
  title?: string;
  price: string | number;
  description: string;
  images?: string[];
  condition?: MarketCondition;
  brand?: string;
  model?: string;
  availableTime: string;
}

export type WantedResponseAction = "reject" | "cancel";
export type WantedResponseActionResult = WantedResponse;

export interface WantedPostInput {
  title: string;
  category: string;
  budgetMin: string | number;
  budgetMax: string | number;
  brandModel?: string;
  condition?: string;
  expectedTradeTime: string;
  campus: MarketCampus;
  location: string;
  description: string;
  allowSellerOffers?: boolean;
  anonymous?: boolean;
  expiryDays?: number;
}

export type WantedPostPatch = Partial<Omit<WantedPostInput, "anonymous">>;

export interface MarketMatchReason {
  key: "category" | "budget" | "campus" | "keyword" | "condition";
  label: string;
  points: number;
}

export interface MarketItemMatch {
  item: MarketItem;
  score: number;
  reasons: MarketMatchReason[];
}

export interface MarketWantedMatch {
  wantedPost: WantedPost;
  score: number;
  reasons: MarketMatchReason[];
}

export interface MarketPreference {
  matchNotificationsEnabled: boolean;
  updatedAt: string;
}

export interface MarketMineWorkspace {
  selling: MarketItem[];
  orders: MarketOrder[];
  wantedPosts: WantedPost[];
  wantedResponses: WantedResponse[];
  conversationCount: number;
  payoutProfile: MarketPayoutProfile | null;
}

export interface MarketPublicUserProfile {
  user: MarketUser;
  stats: {
    listingCount: number;
    completedTrades: number;
    rating: number;
    reviewCount: number;
    positiveRate: number;
    noShowCount: number;
  };
  recentItems: MarketItem[];
}

export interface MarketOperationsDashboard {
  generatedAt: string;
  window: { days: number; since: string; until: string };
  headline: { pendingTotal: number; overdueTotal: number; promotionRevenueCents: number; promotionRevenue: string; promotionNetContributionCents: number; promotionNetContribution: string; promotionManualCostCents: number; promotionManualCost: string; promotionRefundCents: number; promotionCompensationCents: number; promotionComplaintCount: number; promotionComplaintRate: number; averageManualReviewMinutes: number; promotionCtr: number; verifiedCampusUsers: number; dau: number; wau: number; sevenDayReturnRate: number; coreEntryUsers: number };
  product: {
    today: string;
    dau: number;
    wau: number;
    previousWeekUsers: number;
    returningUsers: number;
    sevenDayReturnRate: number;
    surfaceActiveUsers: Array<{ surface: string; users: number; visits: number }>;
    coreEntryUsers: number;
  };
  readiness: {
    ready: boolean;
    passed: number;
    total: number;
    checks: Array<{ key: string; label: string; current: number; target: number; passed: boolean }>;
    failedRuntimeJobs: Array<{ key: string; label: string; error: string | null }>;
    note: string;
  };
  funnels: Array<{ key: string; label: string; note: string; stages: Array<{ label: string; value: number }> }>;
  queues: Array<{ key: string; label: string; count: number; overdue: number; route: string }>;
  timeline: Array<{ id: string; kind: "action" | "report" | "appeal" | "violation"; title: string; status: string; actor: string; target: string; createdAt: string }>;
}

export interface MarketAppeal {
  id: number;
  violationId: number;
  userId: number;
  content: string;
  status: "pending" | "approved" | "rejected";
  handledById?: number | null;
  handledNote?: string;
  handledAt?: string | null;
  createdAt: string;
  updatedAt?: string;
  user?: MarketUser;
  violation?: MarketViolation;
  handledBy?: MarketUser | null;
}

export interface MarketViolation {
  id: number;
  userId?: number;
  type: string;
  level: "warning" | "moderate" | "serious";
  action: "warning" | "restrict_publish" | "restrict_trade";
  reason: string;
  status: "active" | "revoked" | "expired";
  expiresAt?: string | null;
  revokedAt?: string | null;
  createdAt: string;
  updatedAt?: string;
  appeals?: MarketAppeal[];
  user?: MarketUser;
}

export interface MarketReview {
  id: number;
  orderId: number;
  authorId: number;
  targetUserId: number;
  rating: number;
  content: string;
  createdAt: string;
  author?: MarketUser;
  order?: { id: number; item: { id: number; title: string } };
}

export interface MarketReviewInput {
  rating: number;
  content?: string;
}

export interface MarketReportInput {
  reason: string;
  detail?: string;
}

export interface MarketReport {
  id: number;
  itemId?: number | null;
  wantedPostId?: number | null;
  orderId?: number | null;
  reportedUserId?: number | null;
  reporterId: number;
  type: "listing" | "wanted" | "user" | "trade";
  reason: string;
  detail: string;
  status: "pending" | "resolved" | "rejected";
  handledById?: number | null;
  handledNote: string;
  handledAt?: string | null;
  createdAt: string;
  item?: { id: number; title: string; status: string } | null;
  wantedPost?: { id: number; title: string; status: string } | null;
  order?: { id: number; outTradeNo: string; status: string } | null;
  reportedUser?: MarketUser | null;
  reporter?: MarketUser;
}

export interface MarketViolationCreateInput {
  userId: number;
  itemId?: number | null;
  wantedPostId?: number | null;
  orderId?: number | null;
  type: string;
  level: MarketViolation["level"];
  action: MarketViolation["action"];
  reason: string;
  expiresAt?: string | null;
}

export interface MarketAdminActionLog {
  id: number;
  actorId?: number | null;
  action: string;
  targetType: string;
  targetId: string;
  summary: string;
  detail: string;
  ip: string;
  createdAt: string;
  actor?: MarketUser | null;
}

export interface MarketAdminConfig {
  commissionBps: number;
  commissionRate: number;
  learningMaterialCommissionBps: number;
  learningMaterialCommissionRate: number;
  updatedAt: string;
}

export interface MarketAdminRefund extends MarketRefund {
  amount: string;
  order: MarketOrder;
  requestedBy?: MarketUser;
}

export interface MarketAdminPayoutProfile {
  method: "alipay" | "wxpay" | "bank";
  account: string;
  realName: string;
  verified: boolean;
}

export interface MarketAdminOverview {
  counts: Partial<Record<MarketItemStatus, number>>;
  reports: MarketReport[];
  refunds: MarketAdminRefund[];
  settlements: MarketSettlement[];
  orders: MarketOrder[];
  reviewItems: MarketItem[];
  expiredItems: MarketItem[];
  wantedModeration: WantedPost[];
  safetyRules: MarketSafetyRule[];
  violations: MarketViolation[];
  appeals: MarketAppeal[];
  actionLogs: MarketAdminActionLog[];
}

export interface MarketTrustProfile {
  user: MarketUser;
  identity: { verified: boolean; label: string };
  score: number;
  code: "excellent" | "reliable" | "normal" | "caution";
  label: string;
  isNew: boolean;
  historyLabel: string;
  completedTradeCount: number;
  physicalCompletedTradeCount: number;
  physicalClosedTradeCount: number;
  physicalSellingItemCount: number;
  physicalSoldItemCount: number;
  completionRate: number;
  learningCompletedTradeCount: number;
  averageRating: number;
  reviewCount: number;
  positiveRate: number;
  noShowCount: number;
  cancelledByUserCount: number;
  activeViolationCount: number;
  transactionPoints: {
    points: number;
    code: string;
    label: string;
    currentFloor: number;
    nextLevelAt: number | null;
    nextLevelLabel: string | null;
    pointsToNextLevel: number;
    progress: number;
    recentEntries?: Array<{
      id: number;
      delta: number;
      event: string;
      sourceType: string;
      sourceId: string;
      reason: string;
      createdAt: string;
    }>;
  };
  points: MarketTrustProfile["transactionPoints"];
  creator?: {
    status: string;
    level: string;
    qualityScore: number;
    completedOrderCount: number;
    averageRatingBps: number;
    refundRateBps: number;
    disputeRateBps: number;
  } | null;
  restrictions?: MarketViolation[];
  learningRestrictions?: Array<{
    id: number;
    severity: string;
    action: string;
    reason: string;
    status: string;
    expiresAt?: string | null;
    createdAt: string;
  }>;
}

export interface MarketSafetyRule {
  id: number;
  keyword: string;
  scope: "market" | "forum" | "learning" | "all";
  category: string;
  action: "block" | "review";
  enabled: boolean;
  note: string;
  createdAt: string;
  updatedAt: string;
}

export type PointPromotionTargetType = "topic" | "market_item" | "wanted_post";

export interface PointPromotionConfig {
  enabled: boolean;
  status: "designing";
  ruleVersion: string;
  displayName: "积分推流";
  supportedTargetTypes: PointPromotionTargetType[];
  mechanisms: Array<{
    code: string;
    name: string;
    points: number;
    durationMinutes: number;
  }>;
  message: string;
}

export interface PointPromotionContext {
  config: PointPromotionConfig;
  target: {
    id: number;
    type: PointPromotionTargetType;
    title: string;
    status: string;
    eligible: boolean;
    href: string;
  };
  pointBalance: number;
}

export function createMarketClientMessageId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `message-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export const marketApi = {
  meta: (options?: RequestOptions) => request.get<MarketMeta>("/market/meta", undefined, options),
  items: (params?: MarketListParams, options?: RequestOptions) => request.get<{ page: number; size: number; total: number; list: MarketItem[] }>("/market/items", params, options),
  item: (id: number, options?: RequestOptions) => request.get<MarketItem>(`/market/items/${id}`, undefined, options),
  itemMatches: (id: number, options?: RequestOptions) => request.get<MarketWantedMatch[]>(`/market/items/${id}/matches`, undefined, options),
  createItem: (payload: MarketItemInput) => request.post<MarketItem>("/market/items", payload),
  updateItem: (id: number, payload: MarketItemPatchInput) => request.patch<MarketItem>(`/market/items/${id}`, payload),
  removeItem: (id: number) => request.delete<{ ok: true }>(`/market/items/${id}`),
  updateItemLifecycle: (id: number, action: MarketItemLifecycleAction) => request.post<MarketItem>(`/market/items/${id}/lifecycle`, { action }),
  favorite: (id: number) => request.post<{ favorited: boolean; favoriteCount: number }>(`/market/items/${id}/favorite`),
  wanted: (params?: WantedListParams, options?: RequestOptions) => request.get<{ page: number; size: number; total: number; list: WantedPost[] }>("/market/wanted", params, options),
  wantedPost: (id: number, options?: RequestOptions) => request.get<WantedPost>(`/market/wanted/${id}`, undefined, options),
  wantedMatches: (id: number, options?: RequestOptions) => request.get<MarketItemMatch[]>(`/market/wanted/${id}/matches`, undefined, options),
  createWantedPost: (payload: WantedPostInput) => request.post<WantedPost>("/market/wanted", payload),
  updateWantedPost: (id: number, payload: WantedPostPatch) => request.patch<WantedPost>(`/market/wanted/${id}`, payload),
  updateWantedLifecycle: (id: number, action: "cancel" | "complete") => request.post<WantedPost>(`/market/wanted/${id}/lifecycle`, { action }),
  respondToWanted: (id: number, payload: WantedResponseInput) => request.post<WantedResponse>(`/market/wanted/${id}/responses`, payload),
  updateWantedResponse: (id: number, action: WantedResponseAction) => request.patch<WantedResponseActionResult>(`/market/wanted-responses/${id}`, { action }),
  payOrder: (id: number, payType: PayType) => request.post<{ order: MarketOrder; epay: EpaySubmit }>(`/market/orders/${id}/pay`, { payType }),
  updateOrder: (id: number, payload: MarketOrderUpdateInput) => request.patch<MarketOrderActionResult>(`/market/orders/${id}`, payload),
  reviewOrder: (id: number, payload: MarketReviewInput) => request.post<MarketReview>(`/market/orders/${id}/reviews`, payload),
  createConversation: (itemId: number, message = "", wantedResponseId?: number) => request.post<Pick<MarketConversation, "id" | "itemId" | "orderId" | "buyerId" | "sellerId" | "lastMessageAt">>(`/market/items/${itemId}/conversations`, { message, wantedResponseId, clientMessageId: message ? createMarketClientMessageId() : undefined }),
  conversations: (params?: { q?: string; filter?: MarketConversationFilter }, options?: RequestOptions) => request.get<MarketConversation[]>("/market/conversations", params, options),
  conversationUnreadSummary: (options?: RequestOptions) => request.get<MarketConversationUnreadSummary>("/market/conversations/unread-count", undefined, options),
  confirmConversationCompletion: (id: number) => request.post<MarketConversationCompletionResult>(`/market/conversations/${id}/confirm-completion`, {}),
  messages: (id: number, params?: { before?: number; limit?: number }, options?: RequestOptions) => request.get<{ list: MarketMessage[]; nextCursor: number | null }>(`/market/conversations/${id}/messages`, params, options),
  sendMessage: (id: number, payload: { content?: string; clientMessageId: string; attachments?: Array<{ url: string; mimeType: "image/jpeg" | "image/png" | "image/webp" | "image/gif" }> }) => request.post<MarketMessage>(`/market/conversations/${id}/messages`, payload),
  markConversationRead: (id: number) => request.post<{ readAt: string }>(`/market/conversations/${id}/read`, {}),
  toggleConversationBlock: (id: number) => request.post<{ blocked: boolean }>(`/market/conversations/${id}/block`, {}),
  reportMessage: (conversationId: number, messageId: number, payload: MarketReportInput) => request.post<MarketReport>(`/market/conversations/${conversationId}/messages/${messageId}/report`, payload),
  pointSummary: (options?: RequestOptions) => request.get<MarketTrustProfile["points"]>("/market/points", undefined, options),
  pointPromotionConfig: (options?: RequestOptions) => request.get<PointPromotionConfig>("/market/points/promotion/config", undefined, options),
  pointPromotionContext: (targetType: PointPromotionTargetType, targetId: number, options?: RequestOptions) => request.get<PointPromotionContext>("/market/points/promotion/context", { targetType, targetId }, options),
  mine: (options?: RequestOptions) => request.get<MarketMineWorkspace>("/market/mine", undefined, options),
  sellerDashboard: (options?: RequestOptions) => request.get<MarketSellerDashboard>("/market/seller/dashboard", undefined, options),
  reviews: (userId: number, options?: RequestOptions) => request.get<{ list: MarketReview[]; average: number; total: number }>(`/market/users/${userId}/reviews`, undefined, options),
  userMarketProfile: (userId: number, options?: RequestOptions) => request.get<MarketPublicUserProfile>(`/market/users/${userId}/profile`, undefined, options),
  userTrust: (userId: number, options?: RequestOptions) => request.get<MarketTrustProfile>(`/market/users/${userId}/trust`, undefined, options),
  myTrust: (options?: RequestOptions) => request.get<MarketTrustProfile>("/market/trust/me", undefined, options),
  preferences: (options?: RequestOptions) => request.get<MarketPreference>("/market/preferences", undefined, options),
  updatePreferences: (payload: Pick<MarketPreference, "matchNotificationsEnabled">) => request.patch<MarketPreference>("/market/preferences", payload),
  appealViolation: (violationId: number, content: string) => request.post<MarketAppeal>(`/market/violations/${violationId}/appeals`, { content }),
  report: (itemId: number, payload: MarketReportInput) => request.post<MarketReport>(`/market/items/${itemId}/reports`, payload),
  reportWanted: (wantedPostId: number, payload: MarketReportInput) => request.post<MarketReport>(`/market/wanted/${wantedPostId}/reports`, payload),
  reportUser: (userId: number, payload: MarketReportInput) => request.post<MarketReport>(`/market/users/${userId}/reports`, payload),
  reportOrder: (orderId: number, payload: MarketReportInput) => request.post<MarketReport>(`/market/orders/${orderId}/report`, payload),
  savePayoutProfile: (payload: { method: "alipay" | "wxpay" | "bank"; account: string; realName: string }) => request.patch<MarketPayoutProfile>("/market/payout-profile", payload),
  adminOverview: (options?: RequestOptions) => request.get<MarketAdminOverview>("/market/admin/overview", undefined, options),
  adminConfig: (options?: RequestOptions) => request.get<MarketAdminConfig>("/market/admin/config", undefined, options),
  adminUpdateConfig: (learningMaterialCommissionRate: number) => request.patch<MarketAdminConfig>("/market/admin/config", { learningMaterialCommissionRate }),
  adminCategories: (options?: RequestOptions) => request.get<MarketCategoryOption[]>("/market/admin/categories", undefined, options),
  adminCreateCategory: (payload: Omit<MarketCategoryOption, "id" | "itemCount">) => request.post<MarketCategoryOption>("/market/admin/categories", payload),
  adminUpdateCategory: (id: number, payload: Partial<Omit<MarketCategoryOption, "id" | "slug" | "itemCount">>) => request.patch<MarketCategoryOption>(`/market/admin/categories/${id}`, payload),
  adminDeleteCategory: (id: number) => request.delete<{ ok: true }>(`/market/admin/categories/${id}`),
  adminUpdateItem: (id: number, payload: { status: MarketItemStatus; note?: string }) => request.patch<MarketItem>(`/market/admin/items/${id}`, payload),
  adminUpdateWanted: (id: number, payload: { status: "reviewing" | "active" | "expired" | "removed"; note?: string }) => request.patch<WantedPost>(`/market/admin/wanted/${id}`, payload),
  adminHandleReport: (id: number, payload: { status: "resolved" | "rejected"; note?: string; hideItem?: boolean }) => request.patch<MarketReport>(`/market/admin/reports/${id}`, payload),
  adminAdjustPositiveRate: (userId: number, payload: { positiveRate: number; reason: string; reportId: number }) =>
    request.patch<MarketUser & { marketPositiveRate: number; marketPositiveRateReason: string; marketPositiveRateUpdatedAt: string }>(
      `/market/admin/users/${userId}/positive-rate`,
      payload,
    ),
  adminCreateSafetyRule: (payload: Omit<MarketSafetyRule, "id" | "createdAt" | "updatedAt">) => request.post<MarketSafetyRule>("/market/admin/safety-rules", payload),
  adminUpdateSafetyRule: (id: number, payload: Partial<Omit<MarketSafetyRule, "id" | "createdAt" | "updatedAt">>) => request.patch<MarketSafetyRule>(`/market/admin/safety-rules/${id}`, payload),
  adminDeleteSafetyRule: (id: number) => request.delete<{ ok: true }>(`/market/admin/safety-rules/${id}`),
  adminCreateViolation: (payload: MarketViolationCreateInput) => request.post<MarketViolation>("/market/admin/violations", payload),
  adminRevokeViolation: (id: number, note = "") => request.patch<MarketViolation>(`/market/admin/violations/${id}`, { status: "revoked", note }),
  adminHandleAppeal: (id: number, payload: { status: "approved" | "rejected"; note: string }) => request.patch<MarketAppeal>(`/market/admin/appeals/${id}`, payload),
  adminActionLogs: (params?: { page?: number; size?: number }, options?: RequestOptions) => request.get<{ page: number; size: number; total: number; list: MarketAdminActionLog[] }>("/market/admin/action-logs", params, options),
  adminHandleRefund: (id: number, payload: { status: "approved" | "completed" | "rejected" | "failed"; providerRefundNo?: string; note?: string }) => request.patch<MarketRefund>(`/market/admin/refunds/${id}`, payload),
  adminHandleSettlement: (id: number, payload: { status: "available" | "held" | "settled"; reference?: string; note?: string }) => request.patch<MarketSettlement>(`/market/admin/settlements/${id}`, payload),
  adminPayoutProfile: (id: number) => request.get<MarketAdminPayoutProfile>(`/market/admin/settlements/${id}/payout-profile`),
  promotionPlans: (params?: { scope?: PromotionScope }, options?: RequestOptions) => request.get<PromotionPlan[]>("/market/promotions/plans", params, options),
  promotionOrders: (params?: { page?: number; size?: number; status?: PromotionOrder["status"]; scope?: PromotionScope }, options?: RequestOptions) => request.get<{ page: number; size: number; total: number; list: PromotionOrder[] }>("/market/promotions/orders", params, options),
  createPromotionOrder: (payload: { planCode: string; targetId: number; note?: string }, options?: RequestOptions) => request.post<PromotionOrder>("/market/promotions/orders", payload, options),
  submitPromotionPaymentClaim: (id: number, paymentCode: string) => request.post<PromotionOrder>(`/market/promotions/orders/${id}/payment-claim`, { paymentCode }),
  cancelPromotionOrder: (id: number) => request.post<PromotionOrder>(`/market/promotions/orders/${id}/cancel`, {}),
  recordPromotionEvent: (orderId: number, type: "impression" | "click", options?: RequestOptions) => request.post<{ id?: number; impressionCount?: number; clickCount?: number; ignored?: boolean }>(`/market/promotions/orders/${orderId}/events`, { type }, options),
  adminPromotionOverview: (options?: RequestOptions) => request.get<{ plans: PromotionPlan[]; counts: { pendingOrders: number; waitlistedOrders: number; confirmedOrders: number }; revenue: string; revenueCents: number; refundCents: number; compensationCents: number; manualCostCents: number; netContributionCents: number; netContribution: string; complaintCount: number; impressions: number; clicks: number }>("/market/admin/promotions/overview", undefined, options),
  adminOperations: (days = 30, options?: RequestOptions) => request.get<MarketOperationsDashboard>("/market/admin/operations", { days }, options),
  adminPromotionOrders: (params?: { page?: number; size?: number; q?: string; status?: string; type?: string }, options?: RequestOptions) => request.get<{ page: number; size: number; total: number; list: PromotionOrder[] }>("/market/admin/promotions/orders", params, options),
  adminUpdatePromotionOrder: (id: number, payload: { action: "confirm" | "reject"; note?: string; verificationMethod?: "alipay" | "wechat" | "bank" | "cash" | "other"; verificationReference?: string; verifiedAmount?: string | number; paymentCode?: string }) => request.patch<PromotionOrder>(`/market/admin/promotions/orders/${id}`, payload),
  adminCreatePromotionAdjustment: (id: number, payload: { type: PromotionAdjustment["type"]; amount?: string | number; extensionDays?: number; reference?: string; note: string }) => request.post<PromotionOrder>(`/market/admin/promotions/orders/${id}/adjustments`, payload),
  adminUpdatePromotionPlan: (id: number, payload: { name?: string; description?: string; price?: string | number; manualCost?: string | number; durationDays?: number; maxActive?: number; enabled?: boolean; sort?: number }) => request.patch<PromotionPlan>(`/market/admin/promotions/plans/${id}`, payload),
};

export function submitMarketEpay(result: { epay: EpaySubmit }) {
  const form = document.createElement("form");
  form.method = result.epay.method;
  form.action = result.epay.submitUrl;
  form.style.display = "none";
  for (const [key, value] of Object.entries(result.epay.params)) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = key;
    input.value = value;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
}
