import { request, type RequestOptions } from "./request";

export type PayType = "alipay" | "wxpay" | "qqpay" | "bank" | "jdpay";

export type SponsorOptions = {
  enabled: boolean;
  payTypes: PayType[];
  amounts: number[];
  minAmount: string;
  maxAmount: string;
  title: string;
  description: string;
  wallEnabled: boolean;
  allowMessage: boolean;
};

export type SponsorWallItem = {
  id: number;
  amount: string;
  message?: string;
  paidAt?: string;
  anonymous: boolean;
  user?: {
    id: number;
    nickname: string;
    avatar?: string | null;
  } | null;
};

export type EpaySubmit = {
  submitUrl: string;
  method: "POST";
  params: Record<string, string>;
};

export type SponsorOrderStatus = "pending" | "paid" | "closed";
export type SponsorDisplayMode = "public" | "anonymous" | "hidden";

export type SponsorOrder = {
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
};

export type SponsorOrderResult = {
  order: SponsorOrder;
  epay: EpaySubmit;
};

export const paymentsApi = {
  sponsorOptions: (options?: RequestOptions) => request.get<SponsorOptions>("/payments/sponsor/options", undefined, options),
  sponsorWall: (options?: RequestOptions) =>
    request.get<{ enabled: boolean; total: number; totalAmount: string; list: SponsorWallItem[] }>("/payments/sponsor/wall", undefined, options),
  sponsorOrders: (params?: { page?: number; size?: number; status?: "pending" | "paid" | "closed" }, options?: RequestOptions) =>
    request.get<{ page: number; size: number; total: number; list: SponsorOrder[] }>("/payments/sponsor/orders", params, options),
  createSponsorOrder: (payload: { amount: string | number; payType: PayType }) =>
    request.post<SponsorOrderResult>("/payments/sponsor/orders", payload),
  createSponsorOrderWithOptions: (payload: { amount: string | number; payType: PayType; message?: string; displayMode?: "public" | "anonymous" | "hidden" }) =>
    request.post<SponsorOrderResult>("/payments/sponsor/orders", payload),
  paySponsorOrder: (outTradeNo: string) =>
    request.post<SponsorOrderResult>(`/payments/sponsor/orders/${outTradeNo}/pay`),
  closeSponsorOrder: (outTradeNo: string) =>
    request.post<SponsorOrder>(`/payments/sponsor/orders/${outTradeNo}/close`),
  sponsorOrder: (outTradeNo: string, options?: RequestOptions) =>
    request.get<SponsorOrder>(`/payments/sponsor/orders/${outTradeNo}`, undefined, options),
};
