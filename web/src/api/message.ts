import { request, type RequestOptions } from "./request";

export type MessageNotificationPayload = Record<string, unknown> & {
  type?: string;
  topicId?: number | string;
  replyId?: number | string;
  title?: string;
  note?: string;
  reason?: string;
  riskScore?: number;
};

export type MessageNotification = {
  id: number;
  userId: number | null;
  category: string;
  targetClient: string | null;
  level: string;
  title: string;
  content: string;
  payload: MessageNotificationPayload;
  link: string | null;
  source: string | null;
  readAt: string | null;
  createdAt: string;
};

export const messageApi = {
  list: (category?: string, options?: RequestOptions) =>
    request.get<MessageNotification[]>(
      "/messages",
      category ? { category } : {},
      options,
    ),
  read: (id: number, options?: RequestOptions) =>
    request.post<MessageNotification>(`/messages/${id}/read`, undefined, options),
  readAll: (options?: RequestOptions) =>
    request.post<{ ok: true }>("/messages/read-all", undefined, options),
};
