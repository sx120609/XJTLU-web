<template>
  <div class="wanted-page">
    <section class="wanted-hero">
      <div><span>KAOPU · WANTED</span><h1>校园求购</h1><p>把预算和要求说明白，让有合适物品的 XJTLUer 主动回应。</p></div>
      <el-button v-if="auth.isLoggedIn" type="primary" size="large" @click="$router.push('/publish/wanted')"><el-icon><Plus /></el-icon> 发布求购</el-button>
      <el-button v-else type="primary" size="large" @click="$router.push({ name: 'login', query: { redirect: '/publish/wanted' } })">登录后发布</el-button>
    </section>

    <section class="filter-bar cpu-card">
      <el-input v-model="filters.q" clearable placeholder="搜索求购物品、品牌型号或交易地点" @keyup.enter="search"><template #prefix><el-icon><Search /></el-icon></template></el-input>
      <el-select v-model="filters.category" clearable placeholder="全部分类"><el-option v-for="category in categories" :key="category.slug" :label="`${category.icon} ${category.name}`" :value="category.slug" /></el-select>
      <el-select v-model="filters.campus" clearable placeholder="全部校区">
        <el-option v-for="campus in MARKET_CAMPUSES" :key="campus" :label="campus" :value="campus" />
      </el-select>
      <el-select v-model="filters.sort" aria-label="求购排序" @change="search">
        <el-option label="最新发布" value="new" />
        <el-option label="人气优先" value="popular" />
      </el-select>
      <el-button type="primary" @click="search">筛选</el-button>
    </section>

    <section class="wanted-content" v-loading="loading">
      <div class="content-head"><div><h2>{{ filters.sort === 'popular' ? '热门求购' : '最新求购' }}</h2><span>{{ total }} 条有效需求</span></div><small>联系方式默认不公开 · 看中响应可直接私聊</small></div>
      <el-alert v-if="error" type="error" :closable="false" show-icon :title="error"><template #default><el-button size="small" @click="load">重试</el-button></template></el-alert>
      <div v-else-if="posts.length" class="wanted-grid">
        <article v-for="post in posts" :key="post.id" :class="{ urgent: post.promotion.urgent, 'learning-wanted': post.category === 'learning_materials' }" @click="openPost(post)">
          <header><span>{{ categoryIcon(post.category) }}</span><b v-if="post.category === 'learning_materials'" class="learning-badge">学习资料</b><em>{{ statusLabel(post.status) }}</em><time>{{ fmtRelative(post.createdAt) }}</time></header>
          <PromotionLabel v-if="post.promotion.urgent" label="加急" kind="urgent" />
          <h3>{{ post.title }}</h3>
          <p>{{ post.description }}</p>
          <div class="budget"><small>预算</small><strong>¥{{ post.budgetMin }}<template v-if="post.budgetMax !== post.budgetMin">–{{ post.budgetMax }}</template></strong></div>
          <div class="wanted-tags"><span v-if="post.brandModel">{{ post.brandModel }}</span><span v-if="post.condition">{{ post.condition }}</span><span>{{ post.campus || '校内' }}</span></div>
          <footer><span><UserAvatar :size="25" :src="post.author?.avatar" :name="post.author?.nickname" /> {{ post.author?.nickname || '校园用户' }} <i>{{ post.isAnonymous ? '匿名发布' : '已认证' }}</i></span><b>{{ post.responseCount }} 个响应</b></footer>
        </article>
      </div>
      <el-empty v-else description="暂时没有符合条件的求购"><el-button type="primary" plain @click="$router.push('/publish/wanted')">发布求购</el-button></el-empty>
      <el-pagination v-if="total > pageSize" v-model:current-page="page" :page-size="pageSize" :total="total" layout="prev, pager, next" background @current-change="load" />
    </section>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { Plus, Search } from "@element-plus/icons-vue";
import { MARKET_CAMPUSES, marketApi, type MarketCampus, type MarketCategoryOption, type WantedPost } from "@/api/market";
import { useAuthStore } from "@/stores/auth";
import { fmtRelative } from "@/utils/format";
import UserAvatar from "@/components/common/UserAvatar.vue";
import PromotionLabel from "@/components/market/PromotionLabel.vue";

const auth = useAuthStore();
const router = useRouter();
const categories = ref<MarketCategoryOption[]>([]);
const posts = ref<WantedPost[]>([]);
const filters = reactive<{ q: string; category: string; campus: MarketCampus | ""; sort: "new" | "popular" }>({ q: "", category: "", campus: "", sort: "new" });
const loading = ref(false);
const error = ref("");
const total = ref(0);
const page = ref(1);
const pageSize = 24;
let sequence = 0;

onMounted(async () => {
  try {
    const meta = await marketApi.meta({ suppressErrorMessage: true });
    categories.value = meta.wantedCategories || meta.categories;
  } catch { categories.value = []; }
  await load();
});

async function load() {
  const current = ++sequence;
  loading.value = true;
  error.value = "";
  try {
    const result = await marketApi.wanted({ page: page.value, size: pageSize, ...filters }, { suppressErrorMessage: true });
    if (current !== sequence) return;
    posts.value = result.list;
    total.value = result.total;
    for (const post of result.list) if (post.promotion.urgent?.orderId) void marketApi.recordPromotionEvent(post.promotion.urgent.orderId, "impression", { suppressErrorMessage: true });
  } catch (reason) {
    if (current !== sequence) return;
    posts.value = [];
    error.value = reason instanceof Error ? reason.message : "求购加载失败";
  } finally { if (current === sequence) loading.value = false; }
}
function search() { page.value = 1; void load(); }
function openPost(post: WantedPost) { if (post.promotion.urgent?.orderId) void marketApi.recordPromotionEvent(post.promotion.urgent.orderId, "click", { suppressErrorMessage: true }); void router.push(`/market/wanted/${post.id}`); }
function categoryIcon(value: string) { return categories.value.find((entry) => entry.slug === value)?.icon || "📦"; }
function statusLabel(value: string) { return ({ active: "求购中", responded: "已有响应", matched: "已匹配", completed: "已完成", expired: "已过期" } as Record<string, string>)[value] || value; }
</script>

<style scoped>
.wanted-page{display:flex;flex-direction:column;gap:18px}.wanted-hero{display:flex;align-items:center;justify-content:space-between;gap:22px;padding:25px 30px;border-radius:18px;color:#fff;background:linear-gradient(125deg,#5747c8,#6d5ce7 55%,#0f8b78)}.wanted-hero span{font-size:10px;letter-spacing:.15em;opacity:.8}.wanted-hero h1{margin:6px 0 3px;font-size:28px}.wanted-hero p{margin:0;font-size:12px;opacity:.86}.filter-bar{display:grid;grid-template-columns:minmax(0,1fr) 180px 120px 130px auto;gap:9px;padding:13px}.wanted-content{min-height:260px}.content-head{display:flex;align-items:flex-end;justify-content:space-between;margin-bottom:13px}.content-head h2{display:inline;margin:0 8px 0 0;font-size:20px}.content-head span,.content-head small{color:var(--cpu-text-secondary);font-size:10px}.wanted-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:13px}.wanted-grid article{display:flex;min-width:0;flex-direction:column;padding:16px;border:1px solid var(--cpu-border-soft);border-radius:14px;background:var(--cpu-card);cursor:pointer;transition:.18s}.wanted-grid article:hover{transform:translateY(-3px);border-color:color-mix(in srgb,var(--cpu-primary) 45%,var(--cpu-border-soft));box-shadow:0 12px 26px rgba(15,23,42,.08)}.wanted-grid header{display:flex;align-items:center;gap:7px}.wanted-grid header>span{display:grid;place-items:center;width:34px;height:34px;border-radius:10px;background:var(--cpu-surface-soft);font-size:20px}.wanted-grid header em{padding:3px 6px;border-radius:5px;color:#b45309;background:#fef3c7;font-size:9px;font-style:normal}.wanted-grid time{margin-left:auto;color:var(--cpu-text-muted);font-size:9px}.wanted-grid h3{margin:13px 0 7px;font-size:16px}.wanted-grid>article>p{display:-webkit-box;height:42px;margin:0;overflow:hidden;color:var(--cpu-text-secondary);-webkit-box-orient:vertical;-webkit-line-clamp:2;font-size:11px;line-height:21px}.budget{display:flex;align-items:baseline;gap:7px;margin:11px 0}.budget small{color:var(--cpu-text-secondary);font-size:9px}.budget strong{color:#ef4444;font-size:20px}.wanted-tags{display:flex;gap:5px;overflow:hidden}.wanted-tags span{flex:0 0 auto;padding:3px 6px;border-radius:5px;color:var(--cpu-text-secondary);background:var(--cpu-surface-soft);font-size:9px}.hot-reasons{margin-top:8px;color:var(--cpu-text-secondary);font-size:9px}.hot-reasons span{margin-right:6px;color:var(--cpu-primary);font-weight:700}.wanted-grid footer{display:flex;align-items:center;justify-content:space-between;margin-top:14px;padding-top:11px;border-top:1px dashed var(--cpu-border-soft);color:var(--cpu-text-secondary);font-size:9px}.wanted-grid footer>span{display:flex;align-items:center;gap:5px}.wanted-grid footer i{color:var(--cpu-primary);font-style:normal}.wanted-grid footer b{color:var(--cpu-primary)}.el-pagination{justify-content:center;margin-top:20px}@media(max-width:900px){.wanted-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.filter-bar{grid-template-columns:1fr 1fr}.filter-bar>.el-button{grid-column:1/-1}}@media(max-width:560px){.wanted-page{gap:13px}.wanted-hero{align-items:flex-start;flex-direction:column;padding:20px}.wanted-hero .el-button{width:100%}.wanted-grid{grid-template-columns:1fr}.filter-bar{grid-template-columns:1fr}.filter-bar>.el-button{grid-column:auto}.content-head{align-items:flex-start;flex-direction:column;gap:5px}.wanted-grid article{padding:14px}}
.wanted-grid article.urgent{border-color:#fca5a5;background:linear-gradient(145deg,#fff,var(--cpu-card) 70%,#fef2f2)}.wanted-grid article> :deep(.promotion-label){align-self:flex-start;margin-top:9px}
.wanted-grid article.learning-wanted{border-color:#c084fc;background:linear-gradient(145deg,var(--cpu-card),color-mix(in srgb,#a855f7 9%,var(--cpu-card)))}.wanted-grid article.learning-wanted header>span{color:#7e22ce;background:#f3e8ff}.learning-badge{padding:3px 7px;border-radius:6px;color:#7e22ce;background:#f3e8ff;font-size:9px}.wanted-grid article.learning-wanted footer b{color:#9333ea}
</style>
