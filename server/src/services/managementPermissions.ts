export const MANAGEMENT_PERMISSION_CATALOG = {
  "dashboard.read": { label: "查看后台概览", group: "dashboard" },
  "users.read": { label: "查看个人用户", group: "users" },
  "users.moderate": { label: "治理个人用户", group: "users" },
  "users.sensitive": { label: "修改敏感用户设置", group: "users" },
  "forum.review": { label: "帖子人工审核", group: "forum" },
  "forum.moderate": { label: "帖子内容管理", group: "forum" },
  "market.review": { label: "实物商品人工审核", group: "market" },
  "market.governance": { label: "市集举报、违规与申诉", group: "market" },
  "market.operations": { label: "市集运营管理", group: "market" },
  "learning.review": { label: "学习资料人工审核", group: "learning" },
  "learning.operations": { label: "学习资料运营与售后", group: "learning" },
  "content.manage": { label: "板块、公告与同步内容", group: "content" },
  "promotion.manage": { label: "推广与商户运营", group: "commercial" },
  "sponsor.manage": { label: "赞助管理", group: "commercial" },
  "payments.manage": { label: "支付配置与支付记录", group: "commercial" },
  "system.manage": { label: "站点、功能与 AI 设置", group: "system" },
  "storage.manage": { label: "媒体与文件存储", group: "system" },
  "backup.manage": { label: "数据库备份与恢复", group: "system" },
  "audit.read": { label: "查看管理审计日志", group: "system" },
} as const;

export type ManagementPermission = keyof typeof MANAGEMENT_PERMISSION_CATALOG;

export const MANAGEMENT_PERMISSION_CODES = Object.keys(
  MANAGEMENT_PERMISSION_CATALOG,
) as ManagementPermission[];

/** These permissions are intentionally not assignable to ordinary admins. */
export const BOSS_ONLY_PERMISSION_CODES = [
  "management.accounts",
  "management.permissions",
  "management.recovery",
] as const;

export type BossOnlyPermission = typeof BOSS_ONLY_PERMISSION_CODES[number];

export function isKnownManagementPermission(value: string): value is ManagementPermission {
  return Object.prototype.hasOwnProperty.call(MANAGEMENT_PERMISSION_CATALOG, value);
}

export function isBossOnlyPermission(value: string): value is BossOnlyPermission {
  return (BOSS_ONLY_PERMISSION_CODES as readonly string[]).includes(value);
}
