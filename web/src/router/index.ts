import { createRouter, createWebHistory } from "vue-router";
import { ElMessage } from "element-plus";
import { useAuthStore } from "@/stores/auth";
import { useSiteStore } from "@/stores/site";
import type { FeatureKey } from "@/api/site";
import {
  productAnalyticsApi,
  type ProductSource,
  type ProductSurface,
} from "@/api/productAnalytics";

const MainLayout = () => import("@/layouts/MainLayout.vue");

/**
 * 受功能开关控制的路由名 → feature key。
 * 动态板块 / 帖子详情由服务端根据所属板块类型继续拦截，避免直接输入 URL 绕过。
 */
const FEATURE_GATED: Record<string, FeatureKey> = {
  square: "forum",
  forum: "forum",
  "forum-hot": "forum",
  "forum-latest": "forum",
  post: "forum",
  "publish-post": "forum",
  "edit-post": "forum",
  market: "market",
  "market-wanted": "market",
  "market-wanted-detail": "market",
  "market-wanted-edit": "market",
  "market-learning-materials": "market",
  "market-learning-materials-publish": "market",
  "market-learning-materials-edit": "market",
  "market-learning-material-item": "market",
  "market-learning-material-library": "market",
  "market-learning-material-support": "market",
  "market-learning-creator": "market",
  "market-learning-orders": "market",
  "market-learning-order-detail": "market",
  "market-item": "market",
  "market-publish": "market",
  "publish-listing": "market",
  "publish-wanted": "market",
  "market-edit": "market",
  "market-mine": "market",
  "market-seller": "market",
  "market-user-profile": "market",
  "market-messages": "market",
};

const COMMUNITY_ACCESS_GATED = new Set([
  "forum-hot",
  "forum-latest",
  "market",
  "market-learning-materials",
  "market-learning-materials-publish",
  "market-learning-materials-edit",
  "market-learning-material-item",
  "market-learning-material-library",
  "market-learning-material-support",
  "market-learning-creator",
  "market-learning-orders",
  "market-learning-order-detail",
  "market-item",
  "market-wanted",
  "market-wanted-detail",
  "market-wanted-edit",
  "market-publish",
  "publish-listing",
  "publish-wanted",
  "market-edit",
  "market-mine",
  "market-seller",
  "market-user-profile",
  "market-messages",
  "post",
  "edit-post",
]);

const LEGACY_FILE_COLLECTION_SUBMIT_PREFIX = "/services/tools/file-collections/";
const BlankRouteView = { render: () => null };

function firstRouteValue(value: unknown) {
  return Array.isArray(value) ? value[0] : value;
}

export const router = createRouter({
  history: createWebHistory(),
  scrollBehavior(to, from, savedPosition) {
    // 浏览器前进/后退：恢复历史滚动位置
    if (savedPosition) return savedPosition;
    // 锚点
    if (to.hash) return { el: to.hash, behavior: "smooth" };
    // 其他情况：回顶
    return { top: 0 };
  },
  routes: [
    { path: "/login", name: "login", component: () => import("@/views/Login.vue"), meta: { public: true, title: "登录" } },
    { path: "/register", name: "register", component: () => import("@/views/Register.vue"), meta: { public: true, title: "注册" } },
    {
      path: "/",
      component: MainLayout,
      redirect: "/home",
      children: [
        { path: "home", name: "home", component: () => import("@/views/Home.vue"), meta: { title: "首页", public: true } },
        { path: "square", name: "square", component: () => import("@/views/forum/Index.vue"), meta: { title: "广场", public: true } },
        { path: "forum", name: "forum", redirect: "/square" },
        { path: "forum/hot", name: "forum-hot", component: () => import("@/views/forum/Feed.vue"), meta: { title: "热榜", public: true } },
        { path: "forum/latest", name: "forum-latest", component: () => import("@/views/forum/Feed.vue"), meta: { title: "最新内容", public: true } },
        { path: "forum/b/:slug", name: "board", component: () => import("@/views/forum/Board.vue"), meta: { title: "板块", public: true } },
        { path: "forum/topic/:id", name: "topic", component: () => import("@/views/forum/Topic.vue"), meta: { title: "帖子", public: true } },
        { path: "post", name: "post", component: () => import("@/views/forum/Post.vue"), meta: { title: "发起讨论" } },
        { path: "post/:id/edit", name: "edit-post", component: () => import("@/views/forum/Post.vue"), meta: { title: "编辑帖子" } },
        { path: "market", name: "market", component: () => import("@/views/market/Index.vue"), meta: { title: "市集", public: true } },
        { path: "market/wanted", name: "market-wanted", component: () => import("@/views/market/WantedList.vue"), meta: { title: "求购", public: true } },
        { path: "market/wanted/:id", name: "market-wanted-detail", component: () => import("@/views/market/WantedDetail.vue"), meta: { title: "求购详情", public: true } },
        { path: "market/wanted/:id/edit", name: "market-wanted-edit", component: () => import("@/views/market/WantedPublish.vue"), meta: { title: "编辑求购" } },
        { path: "market/promotions", name: "market-promotions", component: () => import("@/views/market/PromotionCenter.vue"), meta: { title: "推广服务" } },
        { path: "market/merchants", name: "market-merchants", component: () => import("@/views/market/MerchantList.vue"), meta: { title: "合作商户", public: true } },
        { path: "market/merchant/apply", name: "market-merchant-apply", component: () => import("@/views/market/MerchantApply.vue"), meta: { title: "成为商户" } },
        { path: "market/merchant/:slug", name: "market-merchant-profile", component: () => import("@/views/market/MerchantProfile.vue"), meta: { title: "合作商户", public: true } },
        { path: "learning", name: "learning", component: () => import("@/views/learning/Hub.vue"), meta: { title: "学习中心", public: true } },
        { path: "learning/materials", name: "market-learning-materials", component: () => import("@/views/market/LearningMaterials.vue"), meta: { title: "付费学习资料", public: true } },
        { path: "learning/materials/publish", name: "market-learning-materials-publish", component: () => import("@/views/market/LearningMaterialPublish.vue"), meta: { title: "发布付费学习资料" } },
        { path: "learning/materials/item/:id/edit", name: "market-learning-materials-edit", component: () => import("@/views/market/LearningMaterialPublish.vue"), meta: { title: "编辑付费学习资料" } },
        { path: "learning/materials/item/:id", name: "market-learning-material-item", component: () => import("@/views/market/LearningMaterialDetail.vue"), meta: { title: "付费学习资料详情", public: true } },
        { path: "learning/creator", name: "market-learning-creator", component: () => import("@/views/market/LearningCreatorCenter.vue"), meta: { title: "学习资料创作者中心" } },
        { path: "learning/orders", name: "market-learning-orders", component: () => import("@/views/market/LearningOrders.vue"), meta: { title: "学习资料订单" } },
        { path: "learning/orders/:id", name: "market-learning-order-detail", component: () => import("@/views/market/LearningOrders.vue"), meta: { title: "学习资料订单详情" } },
        { path: "learning/library", name: "market-learning-material-library", component: () => import("@/views/market/LearningMaterialLibrary.vue"), meta: { title: "我的学习资料" } },
        { path: "learning/support", name: "market-learning-material-support", component: () => import("@/views/market/LearningMaterialSupport.vue"), meta: { title: "资料问题反馈" } },
        { path: "learning/free", redirect: "/learning/materials" },
        { path: "learning/free/publish", redirect: "/learning/materials/publish" },
        { path: "learning/free/item/:id/edit", redirect: (to) => ({ name: "market-learning-materials-edit", params: to.params }) },
        { path: "learning/free/item/:id", redirect: (to) => ({ name: "market-learning-material-item", params: to.params }) },
        { path: "market/learning-materials", redirect: "/learning/materials" },
        { path: "market/learning-materials/publish", redirect: "/learning/materials/publish" },
        { path: "market/learning-materials/item/:id/edit", redirect: (to) => ({ name: "market-learning-materials-edit", params: to.params }) },
        { path: "market/learning-materials/item/:id", redirect: (to) => ({ name: "market-learning-material-item", params: to.params }) },
        { path: "market/learning-materials/library", redirect: "/learning/library" },
        { path: "market/learning-materials/support", redirect: (to) => ({ name: "market-learning-material-support", query: to.query }) },
        { path: "market/item/:id", name: "market-item", component: () => import("@/views/market/Detail.vue"), meta: { title: "商品详情", public: true } },
        { path: "publish", name: "publish", redirect: "/home" },
        { path: "publish/listing", name: "publish-listing", component: () => import("@/views/market/Publish.vue"), meta: { title: "出售物品", publishType: "sell" } },
        { path: "publish/wanted", name: "publish-wanted", component: () => import("@/views/market/WantedPublish.vue"), meta: { title: "发布求购" } },
        { path: "publish/post", name: "publish-post", redirect: (to) => ({ path: "/post", query: to.query }) },
        { path: "market/publish", name: "market-publish", redirect: "/publish/listing" },
        { path: "market/item/:id/edit", name: "market-edit", component: () => import("@/views/market/Publish.vue"), meta: { title: "编辑商品" } },
        { path: "market/mine", name: "market-mine", component: () => import("@/views/market/Mine.vue"), meta: { title: "我的交易" } },
        { path: "market/seller", name: "market-seller", redirect: "/market/mine" },
        { path: "market/seller/:id", name: "market-user-profile", component: () => import("@/views/market/UserProfile.vue"), meta: { title: "卖家主页", public: true } },
        { path: "market/messages", name: "market-messages", component: () => import("@/views/market/Messages.vue"), meta: { title: "交易消息" } },
        { path: "coursereview", redirect: "/forum/b/coursereview" },
        { path: "coursereview/:id", redirect: "/forum/b/coursereview" },
        { path: "services", name: "services", component: () => import("@/views/services/Index.vue"), meta: { title: "工具", public: true } },
        { path: "services/resources", name: "campus-resources", component: () => import("@/views/services/CampusResources.vue"), meta: { title: "校园资源", public: true } },
        { path: "jwxt", redirect: "/academic" },
        { path: "schedule", redirect: "/academic" },
        { path: "academic", name: "academic", component: () => import("@/views/academic/Index.vue"), meta: { title: "我的教务" } },
        { path: "services/tools", name: "service-tools", component: () => import("@/views/services/Tools.vue"), meta: { title: "校园工具", public: true } },
        { path: "services/tools/manage", name: "service-tools-manage", component: () => import("@/views/services/ToolManage.vue"), meta: { title: "小工具管理" } },
        { path: "services/tools/qqbot-reminders", redirect: "/messages/qqbot-reminders" },
        { path: "services/tools/filestore", name: "service-filestore", component: () => import("@/views/services/FileStoreEmbed.vue"), meta: { title: "文件收集" } },
        { path: "services/tools/filestore-beta", name: "service-filestore-beta", component: () => import("@/views/services/FileStoreBeta.vue"), meta: { title: "文件收集 beta", fullWidthContent: true } },
        { path: "services/tools/filestore-beta/submit/:slug", name: "service-filestore-beta-submit", component: () => import("@/views/services/FileStoreBetaSubmit.vue"), meta: { title: "文件提交 beta", public: true, fullWidthContent: true } },
        { path: "services/tools/filestore-beta/status/:slug", name: "service-filestore-beta-status", component: () => import("@/views/services/FileStoreBetaStatus.vue"), meta: { title: "成功名单 beta", public: true, fullWidthContent: true } },
        { path: "services/tools/:slug", name: "service-tool-detail", component: () => import("@/views/services/ToolDetail.vue"), meta: { title: "校园工具", public: true } },
        { path: "services/tools/questionnaires/:slug", name: "questionnaire-fill", component: () => import("@/views/services/QuestionnaireFill.vue"), meta: { title: "填写问卷", public: true } },
        { path: "services/tools/grade-checks/:slug", name: "grade-check-lookup", component: () => import("@/views/services/GradeCheckLookup.vue"), meta: { title: "成绩核对" } },
        { path: "services/tools/file-collections/:slug", name: "file-collection-submit", component: BlankRouteView, meta: { title: "文件提交", public: true } },
        { path: "announcements", name: "announcements", component: () => import("@/views/announcements/Index.vue"), meta: { title: "校园公告", public: true } },
        { path: "search", name: "search", component: () => import("@/views/search/Result.vue"), meta: { title: "搜索结果", public: true } },
        { path: "messages", name: "messages", component: () => import("@/views/messages/Index.vue"), meta: { title: "消息中心" } },
        { path: "messages/qqbot-reminders", name: "message-qqbot-reminders", component: () => import("@/views/services/QqBotReminders.vue"), meta: { title: "小工具提醒规则" } },
        { path: "profile", name: "profile", component: () => import("@/views/profile/Index.vue"), meta: { title: "我的" } },
        { path: "sponsor-wall", name: "sponsor-wall", component: () => import("@/views/profile/SponsorWall.vue"), meta: { title: "鸣谢墙", public: true } },
        { path: "u/:id", name: "user", component: () => import("@/views/profile/User.vue"), meta: { title: "用户", public: true } },
        { path: "admin", name: "admin", component: () => import("@/views/admin/Index.vue"), meta: { title: "管理后台", requireMod: true } },
      ],
    },
    { path: "/:pathMatch(.*)*", component: () => import("@/views/NotFound.vue"), meta: { public: true } },
  ],
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  const site = useSiteStore();
  // HttpOnly Cookie 无法由前端直接读取；首次导航静默探测真实会话。
  if (!auth.ready) await auth.fetchMe({ probe: true });
  if (to.meta.title) document.title = `${to.meta.title} · ${site.siteName}`;

  const requestedManageTool = firstRouteValue(to.query.tool);
  if (to.name === "service-tools-manage" && requestedManageTool === "file_collect") {
    return { name: "service-filestore" };
  }

  if (to.name === "market" && firstRouteValue(to.query.listingType) === "wanted") {
    const { listingType: _legacyListingType, ...query } = to.query;
    return { name: "market-wanted", query };
  }

  if (to.fullPath.startsWith(LEGACY_FILE_COLLECTION_SUBMIT_PREFIX)) {
    const target = to.fullPath.slice(LEGACY_FILE_COLLECTION_SUBMIT_PREFIX.length);
    window.location.replace(`/filestore/submit/${target}`);
    return false;
  }

  // 功能开关 gate：admin / mod 不受限（便于在关闭期间巡查）
  const featureName = to.name ? FEATURE_GATED[String(to.name)] : undefined;
  if (featureName && !site.loaded) await site.fetch();
  if (featureName && !site.features[featureName]) {
    if (auth.token && !auth.user) await auth.fetchMe();
    const isStaff = auth.user?.role === "admin" || auth.user?.role === "mod";
    if (!isStaff) {
      ElMessage.info("该功能当前不可用");
      return { name: "home" };
    }
  }

  if (to.name && COMMUNITY_ACCESS_GATED.has(String(to.name))) {
    if (auth.token && !auth.user) await auth.fetchMe();
    if (!auth.canAccessForum) {
      return { name: "forum", query: { redirect: to.fullPath } };
    }
  }

  // 公开页：游客也能看
  if (to.meta.public) {
    if (auth.token && !auth.user) void auth.fetchMe();
    return true;
  }
  // 需登录
  if (!auth.token) {
    return { name: "login", query: { redirect: to.fullPath } };
  }
  if (!auth.user) {
    await auth.fetchMe();
    if (!auth.user) return { name: "login", query: { redirect: to.fullPath } };
  }
  // 管理后台：仅 mod / admin 可进
  if (to.meta.requireMod) {
    if (auth.user?.role !== "admin" && auth.user?.role !== "mod") {
      return { name: "home" };
    }
  }
  return true;
});

function routeSurface(routeName: unknown): ProductSurface | null {
  const name = String(routeName || "");
  if (name === "academic") return "schedule";
  if (name === "services" || name === "campus-resources" || name.startsWith("service-")) return "portal";
  if (
    name === "learning"
    || name.startsWith("market-learning-")
  ) return "learning";
  if (
    ["square", "forum", "forum-hot", "forum-latest", "board", "topic", "post", "publish-post", "edit-post"].includes(name)
  ) return "square";
  if (name === "market" || name.startsWith("market-") || ["publish-listing", "publish-wanted"].includes(name)) {
    return "market";
  }
  return null;
}

let lastActivityKey = "";
let lastActivityAt = 0;

router.afterEach((to, from) => {
  const auth = useAuthStore();
  const surface = routeSurface(to.name);
  if (!auth.user || !surface) return;
  const source = (routeSurface(from.name) || "direct") as ProductSource;
  const key = `${surface}:${source}:${to.fullPath}`;
  if (key === lastActivityKey && Date.now() - lastActivityAt < 30_000) return;
  lastActivityKey = key;
  lastActivityAt = Date.now();
  void productAnalyticsApi.record(surface, source).catch(() => undefined);
});
