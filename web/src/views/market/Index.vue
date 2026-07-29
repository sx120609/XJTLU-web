<template>
  <div class="market-page">
    <section class="market-hero">
      <div>
        <span class="eyebrow">{{ site.siteName }} · MARKET</span>
        <h1>{{ site.siteName }}校园市集</h1>
        <p>只面向 XJTLUer 的校内闲置空间：提交意向、校内预约、当面验货、双方直接付款。</p>
      </div>
      <div class="hero-actions">
        <el-button @click="$router.push('/market/merchant/apply')">成为商户</el-button>
        <el-button v-if="auth.isLoggedIn" @click="$router.push({ name: 'market-mine' })">我的交易</el-button>
        <el-button v-if="auth.isLoggedIn" @click="$router.push('/market/promotions')">推广服务</el-button>
        <el-button v-if="auth.isLoggedIn" type="primary" @click="$router.push({ name: 'publish-listing' })">
          <el-icon><Plus /></el-icon> 发布商品
        </el-button>
        <el-button v-else type="primary" @click="$router.push({ name: 'login', query: { redirect: '/market' } })">登录后交易</el-button>
      </div>
    </section>

    <section
      class="materials-feature"
      role="link"
      tabindex="0"
      aria-label="进入靠浦特色学习资料商城"
      @click="router.push({ name: 'market-learning-materials' })"
      @keydown.enter="router.push({ name: 'market-learning-materials' })"
    >
      <div class="materials-mark"><img src="/brand/kaopu-cloud.svg" alt="" /></div>
      <div class="materials-copy">
        <span>KAOPU FEATURED · 独立学习资料馆</span>
        <h2>靠浦特色学习资料商城</h2>
        <p>课程笔记、备考资料与原创学习工具，经创作者认证和人工审核后在独立专区付费交付。</p>
      </div>
      <div class="materials-meta"><strong>付费</strong><span>审核交付</span></div>
      <div class="materials-enter">进入专区 <b>→</b></div>
    </section>

    <section class="search-bar cpu-card">
      <el-input v-model="filters.q" clearable size="large" placeholder="搜索商品、教材或交易地点" @keyup.enter="search">
        <template #prefix><el-icon><Search /></el-icon></template>
      </el-input>
      <el-button type="primary" size="large" @click="search">搜索</el-button>
    </section>

    <section class="category-strip" aria-label="商品分类">
      <button
        v-for="category in categories"
        :key="category.slug"
        type="button"
        :class="{ active: filters.category === category.slug }"
        @click="selectCategory(category.slug)"
      >
        <span>{{ category.icon }}</span>
        <b>{{ category.name }}</b>
      </button>
    </section>

    <section class="market-body">
      <aside class="filter-panel cpu-card" :class="{ 'is-mobile-open': mobileFiltersOpen }">
        <div class="filter-title"><strong>筛选商品</strong><button type="button" @click="resetFilters">重置</button></div>
        <div class="channel-tip"><b>当前频道：闲置出售</b><router-link to="/market/wanted">去求购频道</router-link></div>
        <label>价格区间</label>
        <div class="price-range">
          <el-input-number v-model="filters.minPrice" :min="0" :controls="false" placeholder="最低" />
          <span>—</span>
          <el-input-number v-model="filters.maxPrice" :min="0" :controls="false" placeholder="最高" />
        </div>
        <label>成色</label>
        <el-select v-model="filters.condition" clearable placeholder="全部成色">
          <el-option v-for="item in conditionOptions" :key="item.value" :label="item.label" :value="item.value" />
        </el-select>
        <label>交付方式</label>
        <el-select v-model="filters.tradeMode" placeholder="任意交付方式">
          <el-option v-for="mode in tradeModes" :key="mode" :label="marketTradeModeLabel(mode)" :value="mode" />
        </el-select>
        <label>校区</label>
        <el-select v-model="filters.campus" clearable placeholder="全部校区">
          <el-option v-for="campus in MARKET_CAMPUSES" :key="campus" :label="campus" :value="campus" />
        </el-select>
        <el-button type="primary" plain @click="search">应用筛选</el-button>
        <div class="trust-note">
          <b>校内交易提示</b>
          <span>XJTLU 身份认证 · 公共区域见面 · 当面验货 · 商品款直接支付给卖家 · 支持举报</span>
        </div>
      </aside>

      <main class="goods-area">
        <div class="goods-toolbar">
          <div>
            <h2>{{ activeCategoryLabel }}</h2>
            <span>{{ total }} 件商品</span>
          </div>
          <div class="toolbar-actions">
            <el-button class="mobile-filter-btn" plain @click="mobileFiltersOpen=!mobileFiltersOpen"><el-icon><Filter /></el-icon>筛选</el-button>
            <el-select v-model="filters.sort" class="sort-select" @change="search">
              <el-option label="最新发布" value="new" />
              <el-option label="人气优先" value="popular" />
              <el-option label="价格从低到高" value="price_asc" />
              <el-option label="价格从高到低" value="price_desc" />
            </el-select>
          </div>
        </div>

        <div v-if="loading" class="goods-grid">
          <article v-for="i in 8" :key="i" class="goods-card skeleton-card"><el-skeleton animated><template #template><el-skeleton-item variant="image" class="skeleton-image" /><el-skeleton-item variant="h3" /><el-skeleton-item variant="text" /></template></el-skeleton></article>
        </div>
        <el-alert v-else-if="error" type="error" :closable="false" show-icon :title="error"><template #default><el-button size="small" @click="load">重试</el-button></template></el-alert>
        <div v-else-if="items.length" class="goods-grid">
          <article v-for="item in items" :key="item.id" class="goods-card" :class="{ promoted: item.promotions.pinned }" @click="openItem(item)">
            <div class="cover-wrap">
              <img v-if="item.cover" :src="item.cover" :alt="item.title" loading="lazy" />
              <div v-else class="cover-empty">{{ categoryIcon(item.category) }}</div>
              <PromotionLabel v-if="item.promotions.pinned" label="置顶" kind="pin" />
              <span v-if="item.status === 'reserved'" class="status-badge">已预订</span>
              <button v-if="auth.isLoggedIn" type="button" class="favorite-btn" :class="{ active: item.favorited }" @click.stop="toggleFavorite(item)">
                <el-icon><StarFilled v-if="item.favorited" /><Star v-else /></el-icon>
              </button>
            </div>
            <div class="goods-copy">
              <h3>{{ item.title }}</h3>
              <div class="price-line">
                <strong><small>¥</small>{{ item.price }}</strong>
                <del v-if="item.originalPrice">¥{{ item.originalPrice }}</del>
                <em v-if="item.negotiable">可议价</em>
              </div>
              <div class="item-tags">
                <span>{{ conditionLabel(item.condition) }}</span>
                <span>{{ tradeModeLabel(item.tradeMode) }}</span>
                <span v-if="item.campus">{{ item.campus }}</span>
              </div>
              <div class="seller-line">
                <UserAvatar :size="25" :src="item.seller?.avatar" :name="item.seller?.nickname" />
                <span>{{ item.seller?.nickname || "校园用户" }}</span>
                <i>已认证</i>
                <time>{{ fmtRelative(item.createdAt) }}</time>
              </div>
            </div>
          </article>
        </div>
        <el-empty v-else description="没有找到符合条件的商品"><el-button type="primary" plain @click="resetFilters">清空筛选</el-button></el-empty>

        <el-pagination v-if="total > pageSize" v-model:current-page="page" :page-size="pageSize" :total="total" layout="prev, pager, next" background @current-change="load" />
      </main>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { Filter, Plus, Search, Star, StarFilled } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import { MARKET_CAMPUSES, MARKET_CONDITION_LABELS, MARKET_TRADE_MODE_LABELS, marketApi, marketConditionLabel, marketTradeModeLabel, normalizeMarketCampus, type MarketCategoryOption, type MarketCondition, type MarketItem, type MarketTradeMode } from "@/api/market";
import { useAuthStore } from "@/stores/auth";
import { useSiteStore } from "@/stores/site";
import { fmtRelative } from "@/utils/format";
import UserAvatar from "@/components/common/UserAvatar.vue";
import PromotionLabel from "@/components/market/PromotionLabel.vue";

const auth = useAuthStore();
const site = useSiteStore();
const route = useRoute();
const router = useRouter();
const items = ref<MarketItem[]>([]);
const loading = ref(false);
const error = ref("");
const total = ref(0);
const page = ref(1);
const pageSize = 24;
const mobileFiltersOpen = ref(false);
let requestSeq = 0;

const categories = ref<Array<MarketCategoryOption & { slug: string }>>([{ id: 0, slug: "", name: "全部商品", icon: "🛍️", description: "", fulfillmentType: "physical", imageRequired: false, enabled: true, sort: 0 }]);
const conditionOptions = ref<Array<{ label: string; value: Exclude<MarketCondition, "wanted"> }>>(Object.entries(MARKET_CONDITION_LABELS).map(([value, label]) => ({ label, value: value as Exclude<MarketCondition, "wanted"> })));
const tradeModes = ref<MarketTradeMode[]>(Object.keys(MARKET_TRADE_MODE_LABELS) as MarketTradeMode[]);
const filters = reactive({ q: "", category: "", listingType: "sell", condition: "", tradeMode: "any" as MarketTradeMode, campus: "", minPrice: undefined as number | undefined, maxPrice: undefined as number | undefined, sort: "new" as "new" | "popular" | "price_asc" | "price_desc" });
const activeCategoryLabel = computed(() => categories.value.find((item) => item.slug === filters.category)?.name || "全部商品");

onMounted(async () => {
  hydrateFiltersFromRoute();
  try {
    const meta = await marketApi.meta({ suppressErrorMessage: true });
    categories.value = [categories.value[0], ...meta.categories];
    conditionOptions.value = meta.conditions.map((value) => ({ value, label: MARKET_CONDITION_LABELS[value] }));
    tradeModes.value = meta.tradeModes;
  } catch { /* 商品列表仍可独立加载 */ }
  await load();
});

async function load() {
  const seq = ++requestSeq;
  loading.value = true;
  error.value = "";
  try {
    const result = await marketApi.items({ page: page.value, size: pageSize, ...filters }, { suppressErrorMessage: true });
    if (seq !== requestSeq) return;
    items.value = result.list;
    total.value = result.total;
    for (const item of result.list) if (item.promotions.pinned?.orderId) void marketApi.recordPromotionEvent(item.promotions.pinned.orderId, "impression", { suppressErrorMessage: true });
  } catch (reason) {
    if (seq !== requestSeq) return;
    items.value = [];
    error.value = reason instanceof Error ? reason.message : "商品加载失败";
  } finally {
    if (seq === requestSeq) loading.value = false;
  }
}

function search() {
  mobileFiltersOpen.value = false;
  page.value = 1;
  void router.replace({
    query: Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== "" && value !== undefined && value !== null)),
  });
  void load();
}
function selectCategory(value: string) { filters.category = value; search(); }
function openItem(item: MarketItem) { if (item.promotions.pinned?.orderId) void marketApi.recordPromotionEvent(item.promotions.pinned.orderId, "click", { suppressErrorMessage: true }); void router.push({ name: "market-item", params: { id: item.id } }); }
function resetFilters() { Object.assign(filters, { q: "", category: "", listingType: "sell", condition: "", tradeMode: "any", campus: "", minPrice: undefined, maxPrice: undefined, sort: "new" }); search(); }
async function toggleFavorite(item: MarketItem) {
  try {
    const result = await marketApi.favorite(item.id);
    item.favorited = result.favorited;
    item.favoriteCount = result.favoriteCount;
  } catch { ElMessage.error("收藏操作失败"); }
}
const conditionLabel = marketConditionLabel;
const tradeModeLabel = marketTradeModeLabel;
function categoryIcon(value: string) { return categories.value.find((item) => item.slug === value)?.icon || "📦"; }
function hydrateFiltersFromRoute() {
  const first = (value: unknown) => Array.isArray(value) ? value[0] : value;
  const sort = String(first(route.query.sort) || "new");
  filters.q = String(first(route.query.q) || "");
  filters.category = String(first(route.query.category) || "");
  filters.listingType = "sell";
  filters.condition = String(first(route.query.condition) || "");
  const tradeMode = String(first(route.query.tradeMode) || "any");
  filters.tradeMode = tradeMode === "both" ? "any" : (tradeMode in MARKET_TRADE_MODE_LABELS ? tradeMode as MarketTradeMode : "any");
  filters.campus = normalizeMarketCampus(first(route.query.campus));
  filters.sort = (["new", "popular", "price_asc", "price_desc"] as const).includes(sort as any) ? sort as typeof filters.sort : "new";
  const minPrice = Number(first(route.query.minPrice));
  const maxPrice = Number(first(route.query.maxPrice));
  filters.minPrice = Number.isFinite(minPrice) && minPrice >= 0 ? minPrice : undefined;
  filters.maxPrice = Number.isFinite(maxPrice) && maxPrice >= 0 ? maxPrice : undefined;
}
</script>

<style scoped>
.market-page{display:flex;flex-direction:column;gap:18px}.market-hero{position:relative;overflow:hidden;display:flex;align-items:center;justify-content:space-between;gap:24px;padding:30px 34px;border-radius:18px;color:#fff;background:linear-gradient(125deg,#0f766e,#16977f 55%,#2563eb)}.market-hero:after{content:"";position:absolute;right:-70px;top:-110px;width:300px;height:300px;border-radius:50%;background:rgba(255,255,255,.11)}.market-hero>div{position:relative;z-index:1}.eyebrow{font-size:11px;letter-spacing:.16em;opacity:.8}.market-hero h1{margin:7px 0;font-size:30px}.market-hero p{margin:0;opacity:.88}.hero-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px}.search-bar{display:flex;gap:10px;padding:14px}.search-bar .el-input{flex:1}.category-strip{display:grid;grid-template-columns:repeat(9,1fr);gap:9px}.category-strip button{display:flex;align-items:center;justify-content:center;gap:7px;min-width:0;padding:12px 7px;border:1px solid var(--cpu-border-soft);border-radius:12px;color:var(--cpu-text);background:var(--cpu-card);cursor:pointer}.category-strip button:hover,.category-strip button.active{color:var(--cpu-primary);border-color:var(--cpu-primary);background:var(--cpu-primary-soft)}.category-strip span{font-size:19px}.category-strip b{font-size:12px;white-space:nowrap}.market-body{display:grid;grid-template-columns:230px minmax(0,1fr);gap:18px}.filter-panel{align-self:start;position:sticky;top:82px;display:flex;flex-direction:column;gap:10px;padding:17px}.filter-title{display:flex;justify-content:space-between;margin-bottom:4px}.filter-title button{border:0;color:var(--cpu-primary);background:none;cursor:pointer}.filter-panel label{margin-top:5px;color:var(--cpu-text-secondary);font-size:12px}.price-range{display:flex;align-items:center;gap:5px}.price-range .el-input-number{width:86px}.trust-note{display:flex;flex-direction:column;gap:5px;margin-top:8px;padding:11px;border-radius:10px;color:#0f766e;background:#ecfdf5}.trust-note b{font-size:12px}.trust-note span{font-size:10px;line-height:1.5}.goods-area{min-width:0}.goods-toolbar{display:flex;align-items:center;justify-content:space-between;margin-bottom:13px}.goods-toolbar h2{display:inline;margin:0 9px 0 0;font-size:20px}.goods-toolbar span{color:var(--cpu-text-secondary);font-size:12px}.sort-select{width:150px}.goods-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}.goods-card{overflow:hidden;border:1px solid var(--cpu-border-soft);border-radius:14px;background:var(--cpu-card);cursor:pointer;transition:.18s}.goods-card.promoted{border-color:#fdba74}.goods-card:hover{transform:translateY(-3px);border-color:rgba(22,135,118,.45);box-shadow:0 12px 28px rgba(15,23,42,.09)}.cover-wrap{position:relative;aspect-ratio:1.18/1;overflow:hidden;background:var(--cpu-surface-soft)}.cover-wrap img{width:100%;height:100%;object-fit:cover;transition:transform .25s}.cover-wrap :deep(.promotion-label){position:absolute;left:9px;top:9px}.goods-card:hover img{transform:scale(1.035)}.cover-empty{height:100%;display:grid;place-items:center;font-size:54px}.wanted-badge,.status-badge{position:absolute;left:9px;top:9px;padding:4px 8px;border-radius:7px;color:#fff;background:#f59e0b;font-size:10px;font-weight:700}.cover-wrap :deep(.promotion-label)+.status-badge{top:38px}.status-badge{background:#64748b}.wanted-badge+.status-badge{top:38px}.favorite-btn{position:absolute;right:9px;top:9px;width:32px;height:32px;border:0;border-radius:50%;color:#64748b;background:rgba(255,255,255,.88);cursor:pointer}.favorite-btn.active{color:#ef4444}.goods-copy{padding:12px}.goods-copy h3{height:40px;margin:0;font-size:14px;line-height:20px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.price-line{display:flex;align-items:baseline;gap:7px;margin:8px 0}.price-line strong{color:#ef4444;font-size:23px}.price-line small{font-size:12px}.price-line del{color:#94a3b8;font-size:11px}.price-line em{padding:2px 5px;border-radius:4px;color:#b45309;background:#fef3c7;font-size:9px;font-style:normal}.item-tags{display:flex;gap:5px;overflow:hidden}.item-tags span{flex:0 0 auto;padding:3px 6px;border-radius:5px;color:var(--cpu-text-secondary);background:var(--cpu-surface-soft);font-size:9px}.seller-line{display:flex;align-items:center;gap:6px;margin-top:11px;color:var(--cpu-text-secondary);font-size:10px}.seller-line i{padding:1px 4px;border-radius:4px;color:#0f766e;background:#ecfdf5;font-style:normal}.seller-line time{margin-left:auto}.skeleton-card{padding-bottom:12px}.skeleton-image{width:100%;height:180px;margin-bottom:12px}.el-pagination{justify-content:center;margin-top:22px}
.materials-feature{position:relative;overflow:hidden;display:grid;grid-template-columns:auto minmax(0,1fr) auto auto;align-items:center;gap:20px;padding:22px 26px;border:1px solid rgba(190,24,93,.13);border-radius:17px;color:#4c1633;background:linear-gradient(112deg,#fff1f2 0%,#fce7f3 52%,#f3e8ff 100%);cursor:pointer;box-shadow:0 9px 26px rgba(136,19,55,.07);transition:.2s}.materials-feature:after{content:"";position:absolute;right:13%;top:-80px;width:190px;height:190px;border:42px solid rgba(255,255,255,.38);border-radius:50%}.materials-feature:hover{transform:translateY(-2px);border-color:rgba(190,24,93,.28);box-shadow:0 15px 34px rgba(136,19,55,.12)}.materials-mark{position:relative;z-index:1;display:grid;place-items:center;width:58px;height:58px;border-radius:17px;background:linear-gradient(145deg,#be185d,#7c3aed);box-shadow:0 10px 23px rgba(126,34,206,.22)}.materials-mark img{display:block;width:76%;height:76%;object-fit:contain}.materials-copy{position:relative;z-index:1}.materials-copy span{color:#9d174d;font-size:10px;font-weight:700;letter-spacing:.14em}.materials-copy h2{margin:4px 0;font-size:22px}.materials-copy p{margin:0;color:#7c3f5a;font-size:12px}.materials-meta{position:relative;z-index:1;display:flex;align-items:baseline;gap:5px;padding:8px 16px;border-left:1px solid rgba(157,23,77,.18)}.materials-meta strong{font-size:25px}.materials-meta span{color:#9d5d77;font-size:10px}.materials-enter{position:relative;z-index:1;padding:11px 15px;border-radius:10px;color:#fff;background:#951b58;font-size:12px;font-weight:700}.materials-enter b{margin-left:8px;font-size:16px}
@media(max-width:1200px){.category-strip{grid-template-columns:repeat(5,1fr)}.goods-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}@media(max-width:850px){.market-hero{align-items:flex-start;flex-direction:column;padding:24px}.market-hero h1{font-size:25px}.hero-actions{width:100%}.hero-actions .el-button{flex:1}.materials-feature{grid-template-columns:auto 1fr auto}.materials-meta{display:none}.category-strip{display:flex;overflow-x:auto}.category-strip button{flex:0 0 105px}.market-body{grid-template-columns:1fr}.filter-panel{position:static;display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}.filter-title,.filter-panel .trust-note,.filter-panel>.el-button{grid-column:1/-1}.goods-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:560px){.market-page{gap:13px}.materials-feature{grid-template-columns:auto 1fr;padding:17px}.materials-mark{width:48px;height:48px;border-radius:14px}.materials-copy h2{font-size:18px}.materials-copy p{display:none}.materials-enter{grid-column:1/-1;text-align:center}.search-bar{padding:10px}.search-bar>.el-button{display:none}.filter-panel{padding:13px}.goods-grid{gap:9px}.goods-card{border-radius:11px}.goods-copy{padding:9px}.goods-copy h3{font-size:13px}.price-line strong{font-size:20px}.seller-line i{display:none}.goods-toolbar h2{font-size:18px}.sort-select{width:130px}}
.budget-prefix{padding:2px 5px;border-radius:4px;color:#0f766e;background:#ecfdf5;font-size:9px;font-weight:700}
.trust-note,.seller-line i,.budget-prefix{color:var(--cpu-primary);background:var(--cpu-primary-soft)}.favorite-btn{color:var(--cpu-text-secondary);background:var(--cpu-card);box-shadow:0 2px 9px rgba(15,23,42,.12)}
.channel-tip{display:flex;align-items:center;justify-content:space-between;padding:9px;border-radius:8px;color:var(--cpu-primary);background:var(--cpu-primary-soft);font-size:10px}.channel-tip a{color:var(--cpu-primary);font-weight:700;text-decoration:none}
.toolbar-actions{display:flex;align-items:center;gap:8px}.mobile-filter-btn{display:none}@media(max-width:850px){.filter-panel{display:none}.filter-panel.is-mobile-open{display:grid}.mobile-filter-btn{display:inline-flex}}@media(max-width:560px){.goods-toolbar{align-items:flex-start;gap:8px}.toolbar-actions{align-items:stretch;flex-direction:column-reverse}.mobile-filter-btn,.sort-select{width:130px}}
:global(html[data-theme="dark"]) .goods-card:hover{box-shadow:0 12px 28px rgba(0,0,0,.34)}
:global(html[data-theme="dark"]) .price-line em{color:#fbbf24;background:rgba(245,158,11,.16)}
</style>
