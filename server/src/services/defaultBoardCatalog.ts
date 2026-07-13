export type CommunityBoardType = "normal" | "question" | "market" | "coursereview";
export type ForumBoardSection = "general" | "study" | "social";

export interface CommunityBoardDefinition {
  slug: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  order: number;
  type: CommunityBoardType;
  section?: ForumBoardSection;
  anonymousEnabled?: boolean;
}

export const FORUM_SECTION_ORDER: readonly ForumBoardSection[] = ["general", "study", "social"];

export const COMMUNITY_BOARD_DEFS: readonly CommunityBoardDefinition[] = [
  // 综合讨论
  { slug: "general", name: "校园广场", description: "校园见闻、日常交流和自由讨论", icon: "💬", color: "#6d5ce7", order: 10, type: "normal", section: "general" },
  { slug: "lost-found", name: "失物招领", description: "发布寻物与招领信息，请注意保护个人隐私", icon: "🔎", color: "#0ea5e9", order: 20, type: "normal", section: "general" },
  { slug: "freshman", name: "新生专区", description: "入学准备、选课答疑和校园生活攻略", icon: "🌱", color: "#84cc16", order: 30, type: "normal", section: "general" },
  { slug: "question", name: "问答互助", description: "遇到问题来这里提问，邀请同学一起解答", icon: "❓", color: "#3b82f6", order: 40, type: "question", section: "general" },

  // 学习交流
  { slug: "study", name: "课程学习", description: "课程学习、作业思路、考试复习与学术交流", icon: "📚", color: "#2563eb", order: 110, type: "normal", section: "study" },
  { slug: "ielts", name: "科研实习", description: "科研项目、实验室机会、实习招聘与经验交流", icon: "🔬", color: "#7c3aed", order: 120, type: "normal", section: "study" },
  { slug: "study-abroad", name: "雅思留学", description: "雅思备考、选校申请、文书签证与海外生活交流", icon: "🌍", color: "#0891b2", order: 130, type: "normal", section: "study" },
  { slug: "coursereview", name: "课程点评", description: "分享课程体验、选课建议与学习心得", icon: "📊", color: "#8b5cf6", order: 140, type: "normal", section: "study" },

  // 生活社交
  { slug: "life", name: "校园生活", description: "食堂、校车、宿舍、快递和校园周边生活", icon: "🍜", color: "#f59e0b", order: 210, type: "normal", section: "social" },
  { slug: "clubs", name: "社团活动", description: "社团招新、校园活动、兴趣组织与活动分享", icon: "🎯", color: "#ec4899", order: 220, type: "normal", section: "social" },
  { slug: "treehole", name: "树洞", description: "分享心情和烦恼，支持匿名发布与回复", icon: "🕳️", color: "#6366f1", order: 230, type: "normal", section: "social", anonymousEnabled: true },
  { slug: "friends", name: "交友扩列", description: "认识新朋友、寻找同好与校园搭子", icon: "🤝", color: "#f43f5e", order: 240, type: "normal", section: "social" },

  // 独立商城业务依赖该板块承载交易主题，但不在论坛首页分组展示。
  { slug: "market", name: "商城", description: "实体商品、电子资料与校园好物", icon: "🛒", color: "#ef4444", order: 900, type: "market" },
];

export const FORUM_BOARD_DEFS = COMMUNITY_BOARD_DEFS.filter((board) => board.section);
