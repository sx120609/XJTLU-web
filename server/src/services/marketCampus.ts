export const MARKET_CAMPUSES = ["SIP", "TC"] as const;

export type MarketCampus = typeof MARKET_CAMPUSES[number];

const CAMPUS_ALIASES: Record<MarketCampus, readonly string[]> = {
  SIP: ["SIP", "SIP CAMPUS", "SIP校区", "SIP 校区", "SUZHOU", "苏州", "苏州校区", "西浦"],
  TC: ["TC", "TC CAMPUS", "TC校区", "TC 校区", "TAICANG", "太仓", "太仓校区"],
};

export function normalizeMarketCampus(value: unknown): string {
  const input = String(value ?? "").trim();
  if (!input) return "";
  const upper = input.toUpperCase();
  for (const campus of MARKET_CAMPUSES) {
    if (CAMPUS_ALIASES[campus].some((alias) => alias.toUpperCase() === upper)) return campus;
  }
  return input;
}

export function isMarketCampus(value: string): value is MarketCampus {
  return (MARKET_CAMPUSES as readonly string[]).includes(value);
}

export function marketCampusStorageAliases(campus: MarketCampus): readonly string[] {
  return CAMPUS_ALIASES[campus];
}
