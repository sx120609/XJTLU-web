import { request, type RequestOptions } from "./request";
import type { EpaySubmit, PayType } from "./payments";

export type MarketCategory = string;
export type MarketCondition = "new" | "like_new" | "good" | "fair" | "wanted";
export type MarketTradeMode = "meetup" | "shipping" | "online" | "any";
export type MarketListingType = "sell" | "wanted";
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
}

export interface MarketUser {
  id: number;
  username?: string;
  nickname: string;
  avatar?: string | null;
  role: string;
  studentSso?: boolean;
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

export interface MerchantProfile {
  id: number;
  userId: number;
  slug: string;
  name: string;
  category: string;
  description: string;
  priceRange: string;
  serviceArea: string;
  studentDiscount: string;
  contactMethod: string;
  contactValueMasked: string;
  images: string[];
  status: "reviewing" | "approved" | "rejected" | "suspended";
  reviewNote?: string;
  reviewDueAt?: string | null;
  activeUntil?: string | null;
  viewCount: number;
  favoriteCount: number;
  inquiryCount: number;
  favorited: boolean;
  mine: boolean;
  user: MarketUser;
  promotion: { homepage: PromotionBadge | null; promoted: boolean };
  createdAt: string;
  updatedAt: string;
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
  contactVisibility: "after_accept";
  expiresAt?: string | null;
  renewedAt?: string | null;
  visibility: "public" | "targeted";
  status: string;
  viewCount: number;
  favoriteCount: number;
  offerCount: number;
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
  refunds?: any[];
  reviews?: any[];
  settlement?: any;
  conversation?: { id: number } | null;
  conversationId?: number | null;
}

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
  settlements: any[];
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
  payoutProfile?: any;
}

export interface MarketConversation {
  id: number;
  itemId: number;
  orderId?: number | null;
  buyerId: number;
  sellerId: number;
  item: MarketItem;
  buyer: MarketUser;
  seller: MarketUser;
  counterpart: MarketUser;
  order?: MarketOrder | null;
  lastMessage?: MarketMessage | null;
  lastMessageAt?: string | null;
}

export interface MarketMessage {
  id: number;
  conversationId: number;
  senderId: number;
  content: string;
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
  contactVisibility?: "after_accept";
  images?: string[];
  digitalDelivery?: string;
  draft?: boolean;
  status?: string;
}

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
  mine: boolean;
  topicId: number | null;
  topicUrl: string | null;
  author: MarketDisplayUser;
  responses?: WantedResponse[];
  promotion: { urgent: PromotionBadge | null; promoted: boolean };
  createdAt: string;
  updatedAt: string;
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

export interface WantedPostInput {
  title: string;
  category: string;
  budgetMin: string | number;
  budgetMax: string | number;
  brandModel?: string;
  condition?: string;
  expectedTradeTime?: string;
  campus?: string;
  location?: string;
  description: string;
  allowSellerOffers?: boolean;
  anonymous?: boolean;
  expiryDays?: number;
}

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
  userId: number;
  matchNotificationsEnabled: boolean;
  meetupRemindersEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MarketOperationsDashboard {
  generatedAt: string;
  window: { days: number; since: string; until: string };
  headline: { pendingTotal: number; overdueTotal: number; promotionRevenueCents: number; promotionRevenue: string; promotionNetContributionCents: number; promotionNetContribution: string; promotionManualCostCents: number; promotionManualCost: string; promotionRefundCents: number; promotionCompensationCents: number; promotionComplaintCount: number; promotionComplaintRate: number; averageManualReviewMinutes: number; merchantInquiryConversion: number; promotionCtr: number };
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
  handledNote?: string;
  createdAt: string;
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
  createdAt: string;
  appeals?: MarketAppeal[];
  user?: MarketUser;
}

export interface MarketTrustProfile {
  user: MarketUser;
  identity: { verified: boolean; label: string };
  score: number;
  code: "excellent" | "reliable" | "normal" | "caution";
  label: string;
  completedTradeCount: number;
  averageRating: number;
  reviewCount: number;
  positiveRate: number;
  noShowCount: number;
  cancelledByUserCount: number;
  activeViolationCount: number;
  restrictions?: MarketViolation[];
}

export interface MarketContactCardResult {
  orderId: number;
  own: { user: MarketUser; contact: { method: string; value: string | null; valueMasked: string; updatedAt: string } | null };
  counterpart: { user: MarketUser; contact: { method: string; value: string | null; valueMasked: string; updatedAt: string } | null };
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

export const marketApi = {
  meta: (options?: RequestOptions) => request.get<{ categories: MarketCategoryOption[]; campuses: MarketCampus[]; featuredLearningMaterials: MarketCategoryOption | null; conditions: Array<Exclude<MarketCondition, "wanted">>; tradeModes: MarketTradeMode[]; listingTypes: string[]; payTypes: PayType[]; paymentEnabled: boolean; commissionBps: number; commissionRate: number; learningMaterialCommissionBps: number; learningMaterialCommissionRate: number }>("/market/meta", undefined, options),
  items: (params?: MarketListParams, options?: RequestOptions) => request.get<{ page: number; size: number; total: number; list: MarketItem[] }>("/market/items", params, options),
  item: (id: number, options?: RequestOptions) => request.get<MarketItem>(`/market/items/${id}`, undefined, options),
  itemMatches: (id: number, options?: RequestOptions) => request.get<MarketWantedMatch[]>(`/market/items/${id}/matches`, undefined, options),
  createItem: (payload: MarketItemInput) => request.post<MarketItem>("/market/items", payload),
  updateItem: (id: number, payload: Partial<MarketItemInput>) => request.patch<MarketItem>(`/market/items/${id}`, payload),
  removeItem: (id: number) => request.delete<{ ok: true }>(`/market/items/${id}`),
  updateItemLifecycle: (id: number, action: "renew" | "withdraw" | "mark_sold" | "relist") => request.post<MarketItem>(`/market/items/${id}/lifecycle`, { action }),
  favorite: (id: number) => request.post<{ favorited: boolean; favoriteCount: number }>(`/market/items/${id}/favorite`),
  createOffer: (id: number, payload: { price: string | number; message?: string }) => request.post<any>(`/market/items/${id}/offers`, payload),
  updateOffer: (id: number, action: "accept" | "reject" | "cancel") => request.patch<any>(`/market/offers/${id}`, { action }),
  createTradeIntent: (id: number, payload: { price: string | number; message?: string; availableTime: string }) => request.post<TradeIntent>(`/market/items/${id}/intents`, payload),
  updateTradeIntent: (id: number, action: "accept" | "reject" | "cancel") => request.patch<TradeIntent | MarketOrder>(`/market/trade-intents/${id}`, { action }),
  wanted: (params?: { page?: number; size?: number; q?: string; category?: string; campus?: string; status?: string }, options?: RequestOptions) => request.get<{ page: number; size: number; total: number; list: WantedPost[] }>("/market/wanted", params, options),
  wantedPost: (id: number, options?: RequestOptions) => request.get<WantedPost>(`/market/wanted/${id}`, undefined, options),
  wantedMatches: (id: number, options?: RequestOptions) => request.get<MarketItemMatch[]>(`/market/wanted/${id}/matches`, undefined, options),
  createWantedPost: (payload: WantedPostInput) => request.post<WantedPost>("/market/wanted", payload),
  updateWantedPost: (id: number, payload: Partial<WantedPostInput>) => request.patch<WantedPost>(`/market/wanted/${id}`, payload),
  updateWantedLifecycle: (id: number, action: "renew" | "cancel" | "complete") => request.post<WantedPost>(`/market/wanted/${id}/lifecycle`, { action }),
  respondToWanted: (id: number, payload: { itemId?: number; title?: string; price: string | number; description: string; images?: string[]; condition?: string; brand?: string; model?: string; availableTime: string }) => request.post<WantedResponse>(`/market/wanted/${id}/responses`, payload),
  updateWantedResponse: (id: number, action: "accept" | "reject" | "cancel") => request.patch<WantedResponse | MarketOrder>(`/market/wanted-responses/${id}`, { action }),
  payOrder: (id: number, payType: PayType) => request.post<{ order: MarketOrder; epay: EpaySubmit }>(`/market/orders/${id}/pay`, { payType }),
  updateOrder: (id: number, payload: { action: string; meetupTime?: string; meetupLocation?: string; note?: string; reason?: string }) => request.patch<any>(`/market/orders/${id}`, payload),
  reviewOrder: (id: number, payload: { rating: number; content?: string }) => request.post<any>(`/market/orders/${id}/reviews`, payload),
  createConversation: (itemId: number, message = "") => request.post<MarketConversation>(`/market/items/${itemId}/conversations`, { message }),
  conversations: (options?: RequestOptions) => request.get<MarketConversation[]>("/market/conversations", undefined, options),
  messages: (id: number, options?: RequestOptions) => request.get<MarketMessage[]>(`/market/conversations/${id}/messages`, undefined, options),
  sendMessage: (id: number, content: string) => request.post<MarketMessage>(`/market/conversations/${id}/messages`, { content }),
  mine: (options?: RequestOptions) => request.get<{ selling: MarketItem[]; favorites: MarketItem[]; offers: any[]; sellerOffers: any[]; orders: MarketOrder[]; wantedPosts: WantedPost[]; wantedResponses: WantedResponse[]; tradeIntents: TradeIntent[]; sellerTradeIntents: TradeIntent[]; conversationCount: number; payoutProfile?: any }>("/market/mine", undefined, options),
  sellerDashboard: (options?: RequestOptions) => request.get<MarketSellerDashboard>("/market/seller/dashboard", undefined, options),
  reviews: (userId: number, options?: RequestOptions) => request.get<{ list: any[]; average: number; total: number }>(`/market/users/${userId}/reviews`, undefined, options),
  userMarketProfile: (userId: number, options?: RequestOptions) => request.get<{ user: MarketUser; stats: { listingCount: number; completedTrades: number; rating: number; reviewCount: number; positiveRate: number; noShowCount: number }; recentItems: MarketItem[]; merchant?: { id: number; slug: string; name: string; category: string; activeUntil: string; promotion: { homepage: PromotionBadge | null; promoted: boolean } } | null }>(`/market/users/${userId}/profile`, undefined, options),
  userTrust: (userId: number, options?: RequestOptions) => request.get<MarketTrustProfile>(`/market/users/${userId}/trust`, undefined, options),
  myTrust: (options?: RequestOptions) => request.get<MarketTrustProfile>("/market/trust/me", undefined, options),
  preferences: (options?: RequestOptions) => request.get<MarketPreference>("/market/preferences", undefined, options),
  updatePreferences: (payload: Pick<MarketPreference, "matchNotificationsEnabled" | "meetupRemindersEnabled">) => request.patch<MarketPreference>("/market/preferences", payload),
  saveContactCard: (payload: { method: "wechat" | "qq" | "phone" | "email" | "other"; value: string }) => request.patch<{ method: string; valueMasked: string; updatedAt: string }>("/market/contact-card", payload),
  orderContactCards: (orderId: number, options?: RequestOptions) => request.get<MarketContactCardResult>(`/market/orders/${orderId}/contact-cards`, undefined, options),
  appealViolation: (violationId: number, content: string) => request.post<MarketAppeal>(`/market/violations/${violationId}/appeals`, { content }),
  report: (itemId: number, payload: { reason: string; detail?: string }) => request.post<any>(`/market/items/${itemId}/reports`, payload),
  reportWanted: (wantedPostId: number, payload: { reason: string; detail?: string }) => request.post<any>(`/market/wanted/${wantedPostId}/reports`, payload),
  reportUser: (userId: number, payload: { reason: string; detail?: string }) => request.post<any>(`/market/users/${userId}/reports`, payload),
  reportOrder: (orderId: number, payload: { reason: string; detail?: string }) => request.post<any>(`/market/orders/${orderId}/report`, payload),
  savePayoutProfile: (payload: { method: "alipay" | "wxpay" | "bank"; account: string; realName: string }) => request.patch<any>("/market/payout-profile", payload),
  adminOverview: (options?: RequestOptions) => request.get<any>("/market/admin/overview", undefined, options),
  adminConfig: (options?: RequestOptions) => request.get<{ commissionBps: number; commissionRate: number; learningMaterialCommissionBps: number; learningMaterialCommissionRate: number; updatedAt: string }>("/market/admin/config", undefined, options),
  adminUpdateConfig: (learningMaterialCommissionRate: number) => request.patch<{ commissionBps: number; commissionRate: number; learningMaterialCommissionBps: number; learningMaterialCommissionRate: number; updatedAt: string }>("/market/admin/config", { learningMaterialCommissionRate }),
  adminCategories: (options?: RequestOptions) => request.get<MarketCategoryOption[]>("/market/admin/categories", undefined, options),
  adminCreateCategory: (payload: Omit<MarketCategoryOption, "id" | "itemCount">) => request.post<MarketCategoryOption>("/market/admin/categories", payload),
  adminUpdateCategory: (id: number, payload: Partial<Omit<MarketCategoryOption, "id" | "slug" | "itemCount">>) => request.patch<MarketCategoryOption>(`/market/admin/categories/${id}`, payload),
  adminDeleteCategory: (id: number) => request.delete<{ ok: true }>(`/market/admin/categories/${id}`),
  adminUpdateItem: (id: number, payload: { status: string; note?: string }) => request.patch<any>(`/market/admin/items/${id}`, payload),
  adminUpdateWanted: (id: number, payload: { status: "reviewing" | "active" | "expired" | "removed"; note?: string }) => request.patch<any>(`/market/admin/wanted/${id}`, payload),
  adminHandleReport: (id: number, payload: { status: "resolved" | "rejected"; note?: string; hideItem?: boolean }) => request.patch<any>(`/market/admin/reports/${id}`, payload),
  adminCreateSafetyRule: (payload: Omit<MarketSafetyRule, "id" | "createdAt" | "updatedAt">) => request.post<MarketSafetyRule>("/market/admin/safety-rules", payload),
  adminUpdateSafetyRule: (id: number, payload: Partial<Omit<MarketSafetyRule, "id" | "createdAt" | "updatedAt">>) => request.patch<MarketSafetyRule>(`/market/admin/safety-rules/${id}`, payload),
  adminDeleteSafetyRule: (id: number) => request.delete<{ ok: true }>(`/market/admin/safety-rules/${id}`),
  adminCreateViolation: (payload: { userId: number; itemId?: number | null; wantedPostId?: number | null; orderId?: number | null; type: string; level: "warning" | "moderate" | "serious"; action: "warning" | "restrict_publish" | "restrict_trade"; reason: string; expiresAt?: string | null }) => request.post<MarketViolation>("/market/admin/violations", payload),
  adminRevokeViolation: (id: number, note = "") => request.patch<MarketViolation>(`/market/admin/violations/${id}`, { status: "revoked", note }),
  adminHandleAppeal: (id: number, payload: { status: "approved" | "rejected"; note: string }) => request.patch<MarketAppeal>(`/market/admin/appeals/${id}`, payload),
  adminActionLogs: (params?: { page?: number; size?: number }, options?: RequestOptions) => request.get<{ page: number; size: number; total: number; list: any[] }>("/market/admin/action-logs", params, options),
  adminHandleRefund: (id: number, payload: { status: "approved" | "completed" | "rejected" | "failed"; providerRefundNo?: string; note?: string }) => request.patch<any>(`/market/admin/refunds/${id}`, payload),
  adminHandleSettlement: (id: number, payload: { status: "available" | "held" | "settled"; reference?: string; note?: string }) => request.patch<any>(`/market/admin/settlements/${id}`, payload),
  adminPayoutProfile: (id: number) => request.get<any>(`/market/admin/settlements/${id}/payout-profile`),
  promotionPlans: (params?: { scope?: PromotionScope }, options?: RequestOptions) => request.get<PromotionPlan[]>("/market/promotions/plans", params, options),
  promotionOrders: (params?: { page?: number; size?: number; status?: PromotionOrder["status"]; scope?: PromotionScope }, options?: RequestOptions) => request.get<{ page: number; size: number; total: number; list: PromotionOrder[] }>("/market/promotions/orders", params, options),
  createPromotionOrder: (payload: { planCode: string; targetId: number; note?: string }, options?: RequestOptions) => request.post<PromotionOrder>("/market/promotions/orders", payload, options),
  submitPromotionPaymentClaim: (id: number, paymentCode: string) => request.post<PromotionOrder>(`/market/promotions/orders/${id}/payment-claim`, { paymentCode }),
  cancelPromotionOrder: (id: number) => request.post<PromotionOrder>(`/market/promotions/orders/${id}/cancel`, {}),
  recordPromotionEvent: (orderId: number, type: "impression" | "click", options?: RequestOptions) => request.post<{ id?: number; impressionCount?: number; clickCount?: number; ignored?: boolean }>(`/market/promotions/orders/${orderId}/events`, { type }, options),
  myMerchantProfile: (options?: RequestOptions) => request.get<MerchantProfile | null>("/market/merchant/me", undefined, options),
  saveMerchantProfile: (payload: { slug: string; name: string; category: string; description: string; priceRange: string; serviceArea: string; studentDiscount?: string; contactMethod: string; contactValue: string; images?: string[] }) => request.put<MerchantProfile>("/market/merchant/me", payload),
  merchants: (params?: { page?: number; size?: number; q?: string; category?: string }, options?: RequestOptions) => request.get<{ page: number; size: number; total: number; list: MerchantProfile[] }>("/market/merchants", params, options),
  merchant: (slug: string, options?: RequestOptions) => request.get<MerchantProfile>(`/market/merchants/${slug}`, undefined, options),
  favoriteMerchant: (slug: string) => request.post<{ favorited: boolean; favoriteCount: number }>(`/market/merchants/${slug}/favorite`, {}),
  inquireMerchant: (slug: string) => request.post<{ method: string; value: string; counted: boolean; inquiryCount: number }>(`/market/merchants/${slug}/inquiry`, {}),
  adminPromotionOverview: (options?: RequestOptions) => request.get<{ plans: PromotionPlan[]; counts: { pendingOrders: number; waitlistedOrders: number; confirmedOrders: number; merchantReviewing: number }; revenue: string; revenueCents: number; refundCents: number; compensationCents: number; manualCostCents: number; netContributionCents: number; netContribution: string; complaintCount: number; impressions: number; clicks: number }>("/market/admin/promotions/overview", undefined, options),
  adminOperations: (days = 30, options?: RequestOptions) => request.get<MarketOperationsDashboard>("/market/admin/operations", { days }, options),
  adminPromotionOrders: (params?: { page?: number; size?: number; q?: string; status?: string; type?: string }, options?: RequestOptions) => request.get<{ page: number; size: number; total: number; list: PromotionOrder[] }>("/market/admin/promotions/orders", params, options),
  adminUpdatePromotionOrder: (id: number, payload: { action: "confirm" | "reject"; note?: string; verificationMethod?: "alipay" | "wechat" | "bank" | "cash" | "other"; verificationReference?: string; verifiedAmount?: string | number; paymentCode?: string }) => request.patch<PromotionOrder>(`/market/admin/promotions/orders/${id}`, payload),
  adminCreatePromotionAdjustment: (id: number, payload: { type: PromotionAdjustment["type"]; amount?: string | number; extensionDays?: number; reference?: string; note: string }) => request.post<PromotionOrder>(`/market/admin/promotions/orders/${id}/adjustments`, payload),
  adminUpdatePromotionPlan: (id: number, payload: { name?: string; description?: string; price?: string | number; manualCost?: string | number; durationDays?: number; maxActive?: number; enabled?: boolean; sort?: number }) => request.patch<PromotionPlan>(`/market/admin/promotions/plans/${id}`, payload),
  adminMerchants: (params?: { status?: string }, options?: RequestOptions) => request.get<MerchantProfile[]>("/market/admin/merchants", params, options),
  adminReviewMerchant: (id: number, payload: { status: "approved" | "rejected" | "suspended"; note?: string }) => request.patch<MerchantProfile>(`/market/admin/merchants/${id}`, payload),
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
