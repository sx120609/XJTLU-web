import { request, type RequestOptions } from "./request";

export interface HomePromotion {
  id: number;
  sellerId: number;
  title: string;
  description: string;
  category: string;
  price: string;
  priceCents: number;
  campus: string;
  cover: string;
  listingType: "sell";
  negotiable: boolean;
  createdAt: string;
  seller: any;
  promotion: {
    orderId: number;
    type: "home_featured";
    label: "推广";
    expiresAt: string;
  };
}

export interface HomeSummary {
  identity: any;
  pinnedTopics: any[];
  hotTopics: any[];
  latestTopics: any[];
  announce: any[];
  services: any[];
  promotions: HomePromotion[];
}

export const homeApi = {
  summary: (options?: RequestOptions) => request.get<HomeSummary>("/home/summary", undefined, options),
  hotRanking: (options?: RequestOptions) => request.get<any[]>("/home/hot-ranking", undefined, options),
  latestFeed: (params?: { page?: number; size?: number }, options?: RequestOptions) =>
    request.get<{ page: number; size: number; total: number; pins: any[]; list: any[] }>("/home/latest-feed", params, options),
};
