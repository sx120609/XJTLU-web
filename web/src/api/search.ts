import { request, type RequestOptions } from "./request";
import type { PromotionBadge } from "./market";

export interface SearchResult {
  marketItems: Array<{
    id: number;
    listingType: "sell" | "wanted";
    title: string;
    category: string;
    price: string;
    priceCents: number;
    negotiable: boolean;
    campus: string;
    cover: string;
    createdAt: string;
    promotions: { pinned: PromotionBadge | null; home: PromotionBadge | null; promoted: boolean };
  }>;
  wantedPosts: Array<{
    id: number;
    title: string;
    category: string;
    budgetMin: string;
    budgetMax: string;
    campus: string;
    status: string;
    responseCount: number;
    createdAt: string;
    promotion: { urgent: PromotionBadge | null; promoted: boolean };
  }>;
  topics: any[];
  courses: any[];
  services: any[];
  merchants: Array<{
    id: number;
    slug: string;
    name: string;
    category: string;
    description: string;
    priceRange: string;
    serviceArea: string;
    cover: string;
    promotion: { homepage: PromotionBadge | null; promoted: boolean };
  }>;
}

export const searchApi = {
  search: (q: string, options?: RequestOptions) => request.get<SearchResult>("/search", { q }, options),
};
