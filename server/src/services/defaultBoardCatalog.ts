export type CommunityBoardType = "normal" | "question" | "market" | "coursereview";

export interface CommunityBoardDefinition {
  slug: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  type: CommunityBoardType;
  anonymousEnabled?: boolean;
}

export const COMMUNITY_BOARD_DEFS: readonly CommunityBoardDefinition[] = [
  { slug: "general", name: "校园广场", description: "校园见闻、日常交流和自由讨论", icon: "💬", color: "#168c78", type: "normal" },
  { slug: "study", name: "学习交流", description: "课程学习、作业思路、竞赛与升学交流", icon: "📚", color: "#2563eb", type: "normal" },
  { slug: "life", name: "校园生活", description: "食堂、校车、宿舍、快递和周边生活", icon: "🍜", color: "#f59e0b", type: "normal" },
  { slug: "clubs", name: "社团活动", description: "社团招新、校园活动、搭子和兴趣交流", icon: "🎯", color: "#ec4899", type: "normal" },
  { slug: "lost-found", name: "失物招领", description: "发布寻物和招领信息，请注意保护个人隐私", icon: "🔎", color: "#0ea5e9", type: "normal" },
  { slug: "freshman", name: "新生专区", description: "入学准备、选课答疑和校园生活攻略", icon: "🌱", color: "#84cc16", type: "normal" },
  { slug: "treehole", name: "树洞", description: "分享心情和烦恼，支持匿名发布", icon: "🕳️", color: "#6366f1", type: "normal", anonymousEnabled: true },
  { slug: "question", name: "问答互助", description: "遇到问题来这里提问，邀请同学一起解答", icon: "❓", color: "#3b82f6", type: "question" },
  { slug: "market", name: "商城", description: "实体商品 / 电子资料 / 校园好物", icon: "🛒", color: "#ef4444", type: "market" },
  { slug: "coursereview", name: "课程点评", description: "选课参考：难度·给分·收获·推荐度", icon: "📊", color: "#8b5cf6", type: "coursereview" },
];
