import { request, type RequestOptions } from "./request";

export interface EhallStatus {
  active: boolean;
  connecting?: boolean;
  username?: string;
  displayName?: string;
}

export interface EhallService {
  id: string;
  kind: "service";
  name: string;
  description: string;
  category: string;
  department: string;
  icon: string;
  favorite: boolean;
  permission: boolean;
  serviceStation: number;
  online: boolean;
  featuredRank: number | null;
}

export interface EhallNotice {
  id: string;
  title: string;
  publishedAt: string;
  author: string;
  category: string;
  url: string;
}

export const ehallApi = {
  status: (options?: RequestOptions) => request.get<EhallStatus>("/ehall/status", undefined, options),
  services: (options?: RequestOptions) => request.get<{ services: EhallService[] }>("/ehall/services", undefined, options),
  notices: (options?: RequestOptions) => request.get<{ active: boolean; notices: EhallNotice[] }>("/ehall/notices", undefined, options),
  sharedNotices: (options?: RequestOptions) => request.get<{ active: boolean; syncedAt?: string | null; notices: EhallNotice[] }>("/site/announcements", undefined, options),
  launch: (service: Pick<EhallService, "id" | "kind">, options?: RequestOptions) =>
    request.post<{ url: string }>("/ehall/launch", { serviceId: service.id, kind: service.kind }, options),
};
