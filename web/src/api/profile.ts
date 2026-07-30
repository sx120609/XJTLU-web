import { request, type RequestOptions } from "./request";
import type { MarketTrustProfile } from "./market";

export type ProfileFavoriteType = "all" | "topic" | "market_item" | "learning_material";

export interface ProfileFavorite {
  id: number;
  type: Exclude<ProfileFavoriteType, "all">;
  savedAt: string;
  title: string;
  description: string;
  cover: string;
  href: string;
  meta: string;
  target: unknown;
}

export interface ProfileFavoriteResult {
  list: ProfileFavorite[];
  nextCursor: string | null;
  counts: Record<ProfileFavoriteType, number>;
}

export const profileApi = {
  trust: (options?: RequestOptions) => request.get<MarketTrustProfile>("/user/me/trust", undefined, options),
  favorites: (
    params?: { type?: ProfileFavoriteType; cursor?: string; size?: number },
    options?: RequestOptions,
  ) => request.get<ProfileFavoriteResult>("/user/me/favorites", params, options),
};
