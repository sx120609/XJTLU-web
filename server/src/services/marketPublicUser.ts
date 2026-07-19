/**
 * 市集、学习资源和交易关系中允许返回的最小公开用户字段。
 * XJTLU 登录名可能等同学号或校内账号，禁止出现在这些关联对象里。
 */
export const MARKET_PUBLIC_USER_SELECT = {
  id: true,
  nickname: true,
  avatar: true,
  role: true,
  studentSso: true,
  createdAt: true,
} as const;
