<template>
  <div class="home">
    <section class="home-hero">
      <div class="hero-copy">
        <span class="eyebrow">{{ greeting }} · {{ site.siteName }}</span>
        <h1>发现校内闲置，也让真实需求更快被看见</h1>
        <p>{{ site.siteSubtitle || "给 XJTLU 同学一个更顺手、更可信的校园互助入口。" }}</p>
      </div>
      <form class="hero-search" role="search" @submit.prevent="goSearch">
        <el-input v-model="query" size="large" clearable placeholder="搜索商品、求购或广场帖子">
          <template #prefix><el-icon><Search /></el-icon></template>
        </el-input>
        <el-button native-type="submit" type="primary" size="large">搜索</el-button>
      </form>
    </section>

    <section class="quick-actions" aria-label="常用发布入口">
      <router-link
        v-for="action in quickActions"
        :key="action.to"
        :to="action.to"
        class="quick-action cpu-card"
        :class="`quick-action--${action.tone}`"
      >
        <span :class="action.tone"><el-icon><component :is="action.icon" /></el-icon></span>
        <div><b>{{ action.title }}</b><small>{{ action.description }}</small></div>
        <el-icon class="quick-arrow"><Right /></el-icon>
      </router-link>
    </section>

    <section class="home-section market-section">
      <div class="section-head">
        <div><span>RECOMMENDED GOODS</span><h2>推荐好物</h2></div>
        <div class="section-links"><router-link to="/market">进入市集 <el-icon><Right /></el-icon></router-link></div>
      </div>
      <div v-if="marketLoading" class="market-grid"><MarketSkeleton v-for="i in 8" :key="i" /></div>
      <div v-else-if="recommendedItems.length" class="market-grid">
        <router-link
          v-for="item in recommendedItems"
          :key="item.id"
          :to="itemLink(item)"
          class="market-card"
          :class="{ 'market-card--promoted': item.promotions?.home || item.promotions?.pinned, 'market-card--learning': isLearningItem(item) }"
          @click="trackMarketItemClick(item)"
        >
          <div class="market-cover">
            <img v-if="item.cover" :src="item.cover" :alt="item.title" loading="lazy" />
            <span v-else>{{ categoryIcons[item.category] || '📦' }}</span>
          </div>
          <div class="market-copy">
            <div class="market-title-line">
              <em v-if="isLearningItem(item)" class="learning-label">学习资料</em>
              <PromotionLabel v-if="item.promotions?.home" label="推广" kind="home" />
              <PromotionLabel v-else-if="item.promotions?.pinned" label="置顶" kind="pin" />
              <em v-if="item.listingType === 'wanted'">求购</em>
              <h3>{{ item.title }}</h3>
            </div>
            <div class="market-price">
              <strong>{{ item.listingType === 'wanted' ? '预算 ' : '' }}¥{{ item.price }}</strong>
              <span v-if="item.negotiable">可议</span>
            </div>
            <div class="market-meta">
              <span>{{ isLearningItem(item) ? '学习资料专区' : (item.campus || '校内面交') }}</span>
              <time>{{ fmtRelative(item.createdAt) }}</time>
            </div>
          </div>
        </router-link>
      </div>
      <CompactEmpty v-else title="还没有推荐内容" description="实体商品和已审核学习资料会展示在这里" action="发布内容" to="/publish" />
    </section>

    <section class="home-section square-section">
      <div class="section-head">
        <div><span>SQUARE HOT &amp; WANTED</span><h2>热议与求购</h2></div>
        <router-link to="/square">进入广场 <el-icon><Right /></el-icon></router-link>
      </div>
      <div v-if="summaryLoading" class="topic-loading"><el-skeleton :rows="3" animated /></div>
      <div v-else-if="hotTopics.length" class="topic-list">
        <div v-for="topic in hotTopics" :key="topic.id" class="topic-entry">
          <PromotionLabel v-if="topic.promotion" label="加急" kind="urgent" class="topic-promotion" />
          <TopicListItem :topic="topic" />
        </div>
      </div>
      <CompactEmpty v-else title="广场还没有热议内容" description="热门讨论和求购需求都会展示在这里" action="发起讨论" to="/post" />
    </section>

    <el-alert v-if="marketError || summaryError" type="warning" :closable="false" show-icon :title="marketError || summaryError" />
  </div>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { ChatDotRound, Goods, Right, Search } from "@element-plus/icons-vue";
import { ElSkeleton, ElSkeletonItem } from "element-plus";
import TopicListItem from "@/components/forum/TopicListItem.vue";
import PromotionLabel from "@/components/market/PromotionLabel.vue";
import { homeApi, type HomeSummary } from "@/api/home";
import { marketApi, type MarketItem } from "@/api/market";
import { learningMaterialsApi } from "@/api/learningMaterials";
import { useAuthStore } from "@/stores/auth";
import { useSiteStore } from "@/stores/site";
import { fmtRelative } from "@/utils/format";

const auth = useAuthStore();
const site = useSiteStore();
const router = useRouter();
const query = ref("");
const summary = ref<HomeSummary | null>(null);
const naturalRecommendedItems = ref<MarketItem[]>([]);
const recommendedLearningItems = ref<MarketItem[]>([]);
const marketLoading = ref(false);
const summaryLoading = ref(false);
const marketError = ref("");
const summaryError = ref("");
let marketLoadSequence = 0;

const greeting = computed(() => auth.user?.nickname ? `${auth.user.nickname}，你好` : "你好，XJTLUer");
const canBrowseMarket = computed(() => site.features.market && auth.canAccessForum);
const hotTopics = computed(() => (summary.value?.hotTopics ?? []).slice(0, 8));
const recommendedItems = computed<MarketItem[]>(() => {
  if (!canBrowseMarket.value) return [];
  const promoted = (summary.value?.promotions ?? []).map((item) => ({
    ...item,
    listingType: "sell",
    promotions: { pinned: null, home: item.promotion, promoted: true },
  } as unknown as MarketItem));
  const seen = new Set(promoted.map((item) => item.id));
  const natural: MarketItem[] = [];
  const maxLength = Math.max(naturalRecommendedItems.value.length, recommendedLearningItems.value.length);
  for (let index = 0; index < maxLength; index += 1) {
    const physical = naturalRecommendedItems.value[index];
    const learning = recommendedLearningItems.value[index];
    if (physical && !seen.has(physical.id)) natural.push(physical);
    if (learning) natural.push(learning);
  }
  return [...promoted, ...natural].slice(0, 8);
});
const quickActions = [
  { title: "我要出售", description: "发布校内闲置物品", to: "/publish/listing", icon: Goods, tone: "teal" },
  { title: "我要求购", description: "发布到广场求购需求", to: "/publish/wanted", icon: Search, tone: "amber" },
  { title: "我要发帖", description: "发起校园讨论", to: "/post", icon: ChatDotRound, tone: "violet" },
] as const;

const categoryIcons: Record<string, string> = { digital: "💻", digital_goods: "📝", books: "📚", dorm: "🛏️", appliance: "🔌", fashion: "👕", sports: "🏸", tickets: "🎫", other: "📦" };

const MarketSkeleton = defineComponent({
  name: "MarketSkeleton",
  props: { compact: Boolean },
  setup(props) {
    return () => h("div", { class: ["market-card", "market-skeleton", props.compact && "market-card--compact"] }, [
      h(ElSkeleton, { animated: true }, { template: () => [
        h(ElSkeletonItem, { variant: "image", class: "skeleton-cover" }),
        h(ElSkeletonItem, { variant: "h3", style: "width:75%;margin:10px" }),
        h(ElSkeletonItem, { variant: "text", style: "width:45%;margin:0 10px 10px" }),
      ] }),
    ]);
  },
});

const CompactEmpty = defineComponent({
  name: "CompactEmpty",
  props: { title: { type: String, required: true }, description: { type: String, required: true }, action: String, to: String },
  setup(props) {
    return () => h("div", { class: "compact-empty" }, [
      h("span", "○"),
      h("div", [h("b", props.title), h("small", props.description)]),
      props.action && props.to ? h("button", { type: "button", onClick: () => void router.push(props.to!) }, props.action) : null,
    ]);
  },
});

onMounted(() => {
  auth.hydrate();
  void loadSummary();
  if (canBrowseMarket.value) void loadRecommendedItems();
});

watch(canBrowseMarket, (enabled) => {
  if (enabled) void loadRecommendedItems();
  else {
    naturalRecommendedItems.value = [];
    recommendedLearningItems.value = [];
  }
});

function trackMarketItemClick(item: MarketItem) {
  const promotion = item.promotions?.home || item.promotions?.pinned;
  if (promotion) void marketApi.recordPromotionEvent(promotion.orderId, "click", { suppressErrorMessage: true });
}

const trackedImpressions = new Set<number>();
function recordVisiblePromotionImpressions() {
  for (const item of recommendedItems.value) {
    const promotion = item.promotions?.home || item.promotions?.pinned;
    if (!promotion || trackedImpressions.has(promotion.orderId)) continue;
    trackedImpressions.add(promotion.orderId);
    void marketApi.recordPromotionEvent(promotion.orderId, "impression", { suppressErrorMessage: true });
  }
  for (const topic of hotTopics.value) {
    if (!topic.promotion?.orderId || trackedImpressions.has(topic.promotion.orderId)) continue;
    trackedImpressions.add(topic.promotion.orderId);
    void marketApi.recordPromotionEvent(topic.promotion.orderId, "impression", { suppressErrorMessage: true });
  }
}

async function loadRecommendedItems() {
  const sequence = ++marketLoadSequence;
  marketLoading.value = true;
  marketError.value = "";
  const options = { suppressErrorMessage: true, suppressAuthMessage: true, suppressAuthRedirect: true };
  try {
    const [physicalResult, learningResult] = await Promise.allSettled([
      marketApi.items({ page: 1, size: 12, listingType: "sell", sort: "popular" }, options),
      learningMaterialsApi.items({ page: 1, size: 12, sort: "popular" }, options),
    ]);
    if (sequence !== marketLoadSequence) return;
    naturalRecommendedItems.value = physicalResult.status === "fulfilled" ? physicalResult.value.list : [];
    recommendedLearningItems.value = learningResult.status === "fulfilled" ? learningResult.value.list : [];
    if (physicalResult.status === "rejected" && learningResult.status === "rejected") throw new Error("recommendations unavailable");
    recordVisiblePromotionImpressions();
  } catch {
    if (sequence !== marketLoadSequence) return;
    naturalRecommendedItems.value = [];
    recommendedLearningItems.value = [];
    marketError.value = "市集内容暂时加载失败，请稍后重试";
  } finally {
    if (sequence === marketLoadSequence) marketLoading.value = false;
  }
}

function isLearningItem(item: MarketItem) {
  return item.deliveryType === "digital" || item.category === "digital_goods";
}

function itemLink(item: MarketItem) {
  return isLearningItem(item) ? `/learning/materials/item/${item.id}` : `/market/item/${item.id}`;
}

async function loadSummary() {
  summaryLoading.value = true;
  summaryError.value = "";
  try {
    summary.value = await homeApi.summary({ suppressErrorMessage: true });
    recordVisiblePromotionImpressions();
  } catch {
    summary.value = { identity: null, pinnedTopics: [], hotTopics: [], latestTopics: [], announce: [], services: [], promotions: [] };
    summaryError.value = "广场内容暂时加载失败，请稍后重试";
  } finally {
    summaryLoading.value = false;
  }
}

function goSearch() {
  const value = query.value.trim();
  if (value) void router.push({ name: "search", query: { q: value } });
}

</script>

<style scoped lang="scss">
.home{display:flex;flex-direction:column;gap:22px}.home-hero{position:relative;overflow:hidden;display:grid;grid-template-columns:minmax(0,1.05fr) minmax(360px,.95fr);align-items:center;gap:28px;padding:24px 30px;border-radius:18px;color:#fff;background:linear-gradient(135deg,#5747c8 0%,#6d5ce7 58%,#8b7cf6 100%)}.home-hero:after{content:"";position:absolute;right:-70px;top:-130px;width:300px;height:300px;border-radius:50%;background:radial-gradient(circle at 40% 40%,rgba(232,163,23,.38),transparent 62%);pointer-events:none}.hero-copy,.hero-search{position:relative;z-index:1}.eyebrow{font-size:10px;font-weight:700;letter-spacing:.14em;opacity:.82}.home-hero h1{max-width:650px;margin:6px 0 4px;font-size:25px;line-height:1.25}.home-hero p{margin:0;font-size:12px;opacity:.82}.hero-search{display:flex;gap:8px;padding:8px;border-radius:13px;background:rgba(255,255,255,.16);backdrop-filter:blur(8px)}.hero-search .el-input{flex:1}.quick-actions{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));grid-auto-rows:112px;align-items:stretch;gap:14px}.quick-action{box-sizing:border-box;display:flex;height:112px;min-width:0;min-height:112px;max-height:112px;align-items:center;align-self:stretch;gap:15px;margin:0;padding:22px;color:#1e293b;text-decoration:none;transition:.18s}.quick-action--teal{border-color:#86cfc2;background:linear-gradient(135deg,#bcebdc 0%,#c9d7ff 100%)}.quick-action--amber{border-color:#edbd88;background:linear-gradient(135deg,#ffd79d 0%,#f5c3d2 100%)}.quick-action--violet{border-color:#b6a3ef;background:linear-gradient(135deg,#d4c1ff 0%,#bcd6ff 100%)}.quick-action:hover{transform:translateY(-2px);border-color:color-mix(in srgb,var(--cpu-primary) 58%,var(--cpu-border-soft));box-shadow:0 12px 28px rgba(73,58,154,.15)}.quick-action>span{display:grid;place-items:center;flex:0 0 54px;width:54px;height:54px;border-radius:16px;font-size:26px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.62);background:rgba(255,255,255,.66)}.quick-action>span.teal{color:#0f766e}.quick-action>span.amber{color:#b45309}.quick-action>span.violet{color:#6d28d9}.quick-action>div{display:flex;min-width:0;flex:1;flex-direction:column;gap:5px}.quick-action b{font-size:17px}.quick-action small{overflow:hidden;color:#52647e;font-size:12px;text-overflow:ellipsis;white-space:nowrap}.quick-arrow{color:#64748b;font-size:17px}.home-section{padding:20px;border:1px solid var(--cpu-border-soft);border-radius:16px;background:var(--cpu-card);box-shadow:0 3px 15px rgba(15,23,42,.035)}.section-head{display:flex;align-items:flex-end;justify-content:space-between;gap:18px;margin-bottom:14px}.section-head>div>span{color:var(--cpu-primary);font-size:9px;font-weight:700;letter-spacing:.14em}.section-head h2{margin:3px 0 0;font-size:20px}.section-head>a{display:inline-flex;align-items:center;gap:3px;color:var(--cpu-primary);font-size:12px;text-decoration:none}.market-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));align-items:start;gap:13px}.market-card{display:flex;min-width:0;overflow:hidden;flex-direction:column;border:1px solid var(--cpu-border-soft);border-radius:13px;color:var(--cpu-text);background:var(--cpu-card);text-decoration:none;transition:.18s}.market-card:hover{transform:translateY(-3px);border-color:color-mix(in srgb,var(--cpu-primary) 36%,var(--cpu-border-soft));box-shadow:0 11px 24px rgba(15,23,42,.08)}.market-card--promoted{border-color:color-mix(in srgb,#7e22ce 32%,var(--cpu-border-soft))}.market-cover{position:relative;display:block;width:100%;height:0;min-width:0;flex:0 0 auto;padding-top:68.9655%;overflow:hidden;background:var(--cpu-surface-soft);font-size:38px}.market-cover img{position:absolute;inset:0;display:block;width:100%;height:100%;max-width:none;object-fit:cover}.market-cover>span{position:absolute;inset:0;display:grid;place-items:center}.market-copy{padding:11px}.market-title-line,.promotion-title-line{display:flex;align-items:flex-start;gap:6px}.market-title-line h3,.promotion-title-line h3{display:-webkit-box;min-width:0;height:38px;margin:0;overflow:hidden;-webkit-box-orient:vertical;-webkit-line-clamp:2;font-size:13px;line-height:19px}.market-title-line em{flex:0 0 auto;padding:2px 5px;border-radius:4px;color:#b45309;background:#fef3c7;font-size:9px;font-style:normal;font-weight:700}.promotion-disclosure{margin:-5px 0 13px;color:var(--cpu-text-secondary);font-size:10px}.market-price{display:flex;align-items:center;gap:6px;margin:7px 0}.market-price strong{color:#ef4444;font-size:17px}.market-price span{padding:2px 4px;border-radius:4px;color:var(--cpu-primary);background:var(--cpu-primary-soft);font-size:9px}.market-meta{display:flex;align-items:center;justify-content:space-between;gap:7px;color:var(--cpu-text-secondary);font-size:9px}.market-meta span,.market-meta time{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.market-skeleton{pointer-events:none}.skeleton-cover{width:100%;height:110px}.compact-empty{display:flex;align-items:center;gap:12px;min-height:78px;padding:14px 16px;border:1px dashed var(--cpu-border);border-radius:12px;color:var(--cpu-text-secondary);background:var(--cpu-surface-soft)}.compact-empty>span{font-size:25px;opacity:.55}.compact-empty>div{display:flex;min-width:0;flex:1;flex-direction:column;gap:3px}.compact-empty b{color:var(--cpu-text);font-size:13px}.compact-empty small{font-size:11px}.compact-empty button{border:0;color:var(--cpu-primary);background:transparent;font-size:11px;font-weight:700;cursor:pointer}.topic-list{display:flex;flex-direction:column}.topic-loading{padding:6px}:global(html[data-theme="dark"]) .home-section,:global(html[data-theme="dark"]) .quick-action{box-shadow:none}:global(html[data-theme="dark"]) .quick-action{color:var(--cpu-text)}:global(html[data-theme="dark"]) .quick-action small{color:var(--cpu-text-secondary)}:global(html[data-theme="dark"]) .quick-action--teal{border-color:rgba(45,212,191,.34);background:linear-gradient(135deg,rgba(13,148,136,.34),rgba(79,70,229,.28))}:global(html[data-theme="dark"]) .quick-action--amber{border-color:rgba(251,191,36,.34);background:linear-gradient(135deg,rgba(217,119,6,.34),rgba(190,24,93,.26))}:global(html[data-theme="dark"]) .quick-action--violet{border-color:rgba(167,139,250,.4);background:linear-gradient(135deg,rgba(124,58,237,.36),rgba(37,99,235,.28))}:global(html[data-theme="dark"]) .quick-action>span{background:rgba(15,23,42,.35)}:global(html[data-theme="dark"]) .quick-action>span.amber,:global(html[data-theme="dark"]) .market-title-line em{color:#fbbf24;background:rgba(245,158,11,.16)}
.market-grid{align-items:stretch}.market-card{height:100%}.topic-entry{position:relative;border-bottom:1px solid var(--cpu-border-soft)}.topic-entry:last-child{border-bottom:0}.topic-promotion{position:absolute;z-index:1;right:13px;top:12px}.topic-entry :deep(.topic-row){padding-right:72px}
.section-links{display:flex;gap:12px}.section-links a{display:inline-flex;align-items:center;gap:3px;color:var(--cpu-primary);font-size:12px;text-decoration:none}.market-card--learning{border-color:#d8b4fe;background:linear-gradient(160deg,var(--cpu-card),color-mix(in srgb,#a855f7 7%,var(--cpu-card)))}.market-card--learning .market-cover{background:#f3e8ff}.market-title-line .learning-label{color:#7e22ce;background:#f3e8ff}
@media(max-width:1000px){.home-hero{grid-template-columns:1fr}.market-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:620px){.home{gap:14px}.home-hero{gap:16px;padding:20px 17px;border-radius:14px}.home-hero h1{font-size:21px}.hero-search{padding:6px}.hero-search>.el-button{display:none}.quick-actions{display:flex;gap:10px;overflow-x:auto;padding-bottom:3px;scroll-snap-type:x mandatory}.quick-action{flex:0 0 min(82vw,280px);height:96px;min-height:96px;max-height:96px;scroll-snap-align:start;gap:12px;padding:16px}.quick-action>span{flex-basis:44px;width:44px;height:44px;border-radius:13px;font-size:22px}.quick-action b{font-size:15px}.quick-action small{font-size:10px}.quick-arrow{display:none}.home-section{padding:15px 12px;border-radius:13px}.section-head{align-items:center;margin-bottom:11px}.section-head h2{font-size:17px}.section-head>a{font-size:10px}.market-grid{gap:8px}.market-cover{font-size:30px}.market-copy{padding:8px}.market-title-line h3{height:36px;font-size:12px;line-height:18px}.market-price strong{font-size:15px}.compact-empty{align-items:flex-start;min-height:0;padding:12px}.compact-empty button{align-self:center}}
</style>
