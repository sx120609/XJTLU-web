import { request } from "./request";

export type ProductSurface = "schedule" | "portal" | "square" | "market" | "learning";
export type ProductSource = ProductSurface | "direct";

export const productAnalyticsApi = {
  record: (surface: ProductSurface, source: ProductSource) => request.post<{
    dateKey: string;
    surface: ProductSurface;
    source: ProductSource;
    visitCount: number;
  }>("/product/activity", { surface, source }, {
    suppressAuthRedirect: true,
    suppressAuthMessage: true,
    suppressErrorMessage: true,
  }),
};
