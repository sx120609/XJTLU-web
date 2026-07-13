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
  files: LearningMaterialFile[];
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
  metadataComplete: boolean;
  activeVersion?: LearningMaterialVersion | null;
  createdAt: string;
  updatedAt: string;
}

export interface LearningMaterialItem extends MarketItem {
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
  legacyIncompleteCount: number;
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

export const learningMaterialsApi = {
  meta: (options?: RequestOptions) => request.get<LearningMaterialMeta>("/market/materials/meta", undefined, options),
  types: (options?: RequestOptions) => request.get<LearningMaterialType[]>("/market/materials/types", undefined, options),
  createType: (name: string) => request.post<LearningMaterialType>("/market/materials/types", { name }),
  items: (params?: LearningMaterialListParams, options?: RequestOptions) => request.get<{ page: number; size: number; total: number; list: LearningMaterialItem[] }>("/market/materials/items", params as Record<string, unknown>, options),
  item: (id: number, options?: RequestOptions) => request.get<LearningMaterialItem>(`/market/materials/items/${id}`, undefined, options),
  createItem: (payload: LearningMaterialItemInput) => request.post<LearningMaterialItem>("/market/materials/items", payload),
  updateItem: (id: number, payload: Partial<LearningMaterialItemInput>) => request.patch<LearningMaterialItem>(`/market/materials/items/${id}`, payload),
  purchase: (id: number) => request.post<MarketOrder & { free?: boolean; reused?: boolean }>(`/market/materials/items/${id}/purchase`),
  uploadVersion: (id: number, files: File[], payload: { label?: string; releaseNotes?: string }, options?: RequestOptions) => {
    const data = new FormData();
    files.forEach((file) => data.append("files", file, file.name));
    data.append("label", payload.label || "");
    data.append("releaseNotes", payload.releaseNotes || "");
    return request.post<LearningMaterialVersion>(`/market/materials/items/${id}/versions`, data, options);
  },
  publishVersion: (itemId: number, versionId: number) => request.post<LearningMaterialVersion>(`/market/materials/items/${itemId}/versions/${versionId}/publish`),
  library: (options?: RequestOptions) => request.get<LearningMaterialLibraryEntry[]>("/market/materials/library", undefined, options),
  downloadUrl: (fileId: number) => `/api/market/materials/files/${fileId}/download`,
  supportTickets: (options?: RequestOptions) => request.get<LearningMaterialSupportTicket[]>("/market/materials/support", undefined, options),
  createSupport: (orderId: number, payload: { category: string; message: string }) => request.post<LearningMaterialSupportTicket>(`/market/materials/orders/${orderId}/support`, payload),
  support: (id: number, options?: RequestOptions) => request.get<LearningMaterialSupportTicket>(`/market/materials/support/${id}`, undefined, options),
  sendSupportMessage: (id: number, content: string) => request.post<LearningMaterialSupportMessage>(`/market/materials/support/${id}/messages`, { content }),
  updateSupport: (id: number, action: "resolve" | "reopen" | "escalate") => request.patch<LearningMaterialSupportTicket>(`/market/materials/support/${id}`, { action }),
  adminOverview: (options?: RequestOptions) => request.get<LearningMaterialAdminOverview>("/market/materials/admin/overview", undefined, options),
  adminTypes: (options?: RequestOptions) => request.get<LearningMaterialType[]>("/market/materials/admin/types", undefined, options),
  adminUpdateType: (id: number, payload: { action: "approve" | "reject" | "enable" | "disable" | "merge"; targetTypeId?: number }) => request.patch<LearningMaterialType>(`/market/materials/admin/types/${id}`, payload),
};
