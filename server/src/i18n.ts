import type { Request } from "express";

export const SUPPORTED_LOCALES = ["en-US", "zh-CN"] as const;
export type AppLocale = (typeof SUPPORTED_LOCALES)[number];

const exactEnglishMessages: Record<string, string> = {
  "请求失败": "Request failed",
  "参数错误": "Invalid request parameters",
  "请求参数格式不正确": "The request parameters are not in the correct format",
  "接口不存在": "API endpoint not found",
  "资源不存在或已被移除": "This resource does not exist or has been removed",
  "数据已发生变化，请刷新后重试": "The data has changed. Refresh the page and try again",
  "服务器内部错误，请稍后再试": "Internal server error. Please try again later",
  "上传内容过大，请压缩图片或更换更小的文件后重试": "The upload is too large. Compress it or choose a smaller file",
  "用户不存在": "User not found",
  "课程不存在": "Course not found",
  "板块不存在": "Board not found",
  "用户名或密码错误": "Incorrect username or password",
  "账号已被封禁": "This account has been suspended",
  "原密码错误": "The current password is incorrect",
  "新密码不能与原密码相同": "The new password must be different from the current password",
  "该账号通过学校认证登录，无需设置站内密码": "This account uses XJTLU authentication and does not need a site password",
  "该功能当前不可用": "This feature is currently unavailable",
  "无权限": "You do not have permission to perform this action",
  "未登录": "Please sign in to continue",
  "会话已关闭，无法继续发送消息": "This conversation is closed and no longer accepts messages",
  "交易会话不存在": "Trade conversation not found",
  "不能和自己发起交易私聊": "You cannot start a trade conversation with yourself",
  "双方均确认后才会发放积分": "Points are granted only after both parties confirm completion",
};

const notificationEnglish: Record<string, string> = {
  "交易完成": "Trade completed",
  "交易确认": "Trade confirmation",
  "交易消息": "Trade message",
  "新的交易消息": "New trade message",
  "学习资料售后需要平台介入": "Learning material support requires platform review",
  "推广服务即将到期": "Promotion service expiring soon",
  "站务组": "Site team",
  "靠浦市集": "Kaopu Market",
  "靠浦推广服务": "Kaopu Promotion Services",
  "靠浦特色学习资料": "Kaopu Learning Materials",
};

const boardEnglish: Record<string, { name: string; description: string }> = {
  general: { name: "Campus Square", description: "Campus news, everyday conversation, and open discussion" },
  "wanted-demand": { name: "Wanted Requests", description: "Share the item you need, your budget, and campus meetup preferences" },
  freshman: { name: "New Students", description: "Arrival preparation, module selection, and campus life guides" },
  question: { name: "Questions & Help", description: "Get help with modules, campus services, and everyday questions" },
  study: { name: "Course Study", description: "Modules, assignments, exam preparation, and academic discussion" },
  ielts: { name: "2+2 Zone", description: "A dedicated space for XJTLU 2+2 students" },
  "study-abroad": { name: "IELTS & Study Abroad", description: "IELTS, university applications, visas, and overseas life" },
  coursereview: { name: "Course Reviews", description: "Course experiences, module choices, and study advice" },
  life: { name: "Campus Life", description: "Dining, buses, accommodation, events, and life around campus" },
  clubs: { name: "Clubs & Events", description: "Club recruitment, campus events, and interest groups" },
  treehole: { name: "Tree Hole", description: "Share feelings and concerns with optional anonymity" },
  friends: { name: "Meet People", description: "Make friends and find people with shared interests" },
  market: { name: "Market", description: "Physical items, wanted requests, and in-person campus trades" },
};

export function normalizeLocale(value: unknown): AppLocale {
  const first = String(value || "").split(",")[0]?.trim().toLowerCase();
  return first?.startsWith("en") ? "en-US" : "zh-CN";
}

export function requestLocale(req: Pick<Request, "headers">): AppLocale {
  return normalizeLocale(req.headers["accept-language"]);
}

function hasHan(value: string) {
  return /[\u3400-\u9fff]/u.test(value);
}

export function localizeApiMessage(message: string, locale: AppLocale) {
  if (locale === "zh-CN" || !message) return message;
  if (exactEnglishMessages[message]) return exactEnglishMessages[message];
  if (/^参数错误[：:]/u.test(message)) return "Invalid request parameters";
  if (/不存在|已被移除/u.test(message)) return "The requested resource does not exist or has been removed";
  if (/无权|无权限|禁止|不可见/u.test(message)) return "You do not have permission to perform this action";
  if (/登录.*过期|会话.*过期/u.test(message)) return "Your session has expired. Please sign in again";
  if (/已关闭.*消息|无法继续发送/u.test(message)) return "This conversation is closed and no longer accepts messages";
  if (/积分/u.test(message) && /双方|买家|卖家/u.test(message)) {
    return "Points are granted only after both buyer and seller confirm completion";
  }
  if (/上传/u.test(message) && /失败|错误/u.test(message)) return "Upload failed. Please try again";
  return hasHan(message)
    ? "The request could not be completed. Review your input and try again."
    : message;
}

function localizeNotificationText(value: string | null | undefined, locale: AppLocale) {
  if (!value || locale === "zh-CN") return value;
  if (notificationEnglish[value]) return notificationEnglish[value];
  const orderDispute = value.match(/^订单\s+(.+?)\s+已升级为争议$/u);
  if (orderDispute) return `Order ${orderDispute[1]} has been escalated as a dispute`;
  const pointsGranted = value.match(/双方已确认.*?(\d+)\s*积分/u);
  if (pointsGranted) return `Both parties confirmed completion. ${pointsGranted[1]} points have been granted.`;
  return value;
}

export function localizeNotification<T extends {
  title?: string | null;
  content?: string | null;
  source?: string | null;
}>(notification: T, locale: AppLocale): T {
  return {
    ...notification,
    title: localizeNotificationText(notification.title, locale),
    content: localizeNotificationText(notification.content, locale),
    source: localizeNotificationText(notification.source, locale),
  };
}

export function localizeBoard<T extends { slug: string; name?: string; description?: string | null }>(
  board: T,
  locale: AppLocale,
): T {
  const translation = locale === "en-US" ? boardEnglish[board.slug] : undefined;
  return translation ? { ...board, ...translation } : board;
}
