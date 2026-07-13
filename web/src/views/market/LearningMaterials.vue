<template>
  <div class="materials-page">
    <nav class="crumb"><router-link to="/market">商城</router-link><span>/</span><b>靠浦特色学习资料</b></nav>

    <section class="materials-hero">
      <div class="hero-copy">
        <span class="eyebrow">KAOPU FEATURED LEARNING</span>
        <h1>靠浦特色学习资料</h1>
        <p>把真正有用的课程笔记、备考资料和原创学习工具，放进一个更专注、更可信的校园资料馆。</p>
        <div class="hero-tags"><span>精选学习内容</span><span>校内认证发布</span><span>付款后安全交付</span></div>
      </div>
      <div class="hero-actions">
        <div class="material-stat"><strong>{{ total }}</strong><span>份在架资料</span></div>
        <el-button v-if="auth.isLoggedIn" type="primary" size="large" @click="goPublish"><el-icon><Plus /></el-icon> 发布学习资料</el-button>
        <el-button v-else type="primary" size="large" @click="goLogin">登录后发布</el-button>
      </div>
    </section>

    <section class="feature-row">
      <article><i>01</i><div><b>课程沉淀</b><span>系统笔记、复习提纲与知识梳理</span></div></article>
      <article><i>02</i><div><b>备考进阶</b><span>语言考试、升学与专业能力资料</span></div></article>
      <article><i>03</i><div><b>原创工具</b><span>模板、题库与提升效率的数字内容</span></div></article>
    </section>

    <section class="materials-search cpu-card">
      <el-input v-model="filters.q" clearable size="large" placeholder="搜索课程、考试、笔记或资料名称" @keyup.enter="search">
        <template #prefix><el-icon><Search /></el-icon></template>
      </el-input>
      <el-segmented v-model="filters.listingType" :options="listingOptions" @change="search" />
      <el-button type="primary" size="large" @click="search">搜索资料</el-button>
    </section>

    <section class="results-head">
      <div><span>LEARNING LIBRARY</span><h2>{{ filters.q ? `“${filters.q}”的结果` : '全部学习资料' }} <small>{{ total }} 份</small></h2></div>
      <el-select v-model="filters.sort" class="sort-select" @change="search">
        <el-option label="最新发布" value="new" />
        <el-option label="人气优先" value="popular" />
        <el-option label="价格从低到高" value="price_asc" />
        <el-option label="价格从高到低" value="price_desc" />
      </el-select>
    </section>

    <div v-if="loading" class="materials-grid">
      <article v-for="i in 6" :key="i" class="material-card loading-card"><el-skeleton animated :rows="4" /></article>
    </div>
    <el-alert v-else-if="error" type="error" :closable="false" show-icon :title="error"><template #default><el-button size="small" @click="load">重新加载</el-button></template></el-alert>
    <div v-else-if="items.length" class="materials-grid">
      <article v-for="item in items" :key="item.id" class="material-card" @click="router.push({ name: 'market-item', params: { id: item.id } })">
        <div class="material-cover">
          <img v-if="item.cover" :src="item.cover" :alt="item.title" loading="lazy" />
          <div v-else class="cover-fallback"><span><img src="/brand/kaopu-cloud.svg" alt="" /></span><b>KAOPU MATERIAL</b></div>
          <em v-if="item.listingType === 'wanted'">资料求购</em>
          <button v-if="auth.isLoggedIn" type="button" :class="{ active: item.favorited }" aria-label="收藏" @click.stop="toggleFavorite(item)">
            <el-icon><StarFilled v-if="item.favorited" /><Star v-else /></el-icon>
          </button>
        </div>
        <div class="material-copy">
          <span class="material-kind">{{ item.listingType === 'wanted' ? 'WANTED' : 'DIGITAL EDITION' }}</span>
          <h3>{{ item.title }}</h3>
          <p>{{ summary(item.description) }}</p>
          <div class="price-line"><span v-if="item.listingType === 'wanted'">预算</span><strong><small>¥</small>{{ item.price }}</strong><del v-if="item.originalPrice">¥{{ item.originalPrice }}</del><i v-if="item.negotiable">可议价</i></div>
          <footer>
            <UserAvatar :size="28" :src="item.seller?.avatar" :name="item.seller?.nickname" />
            <div><b>{{ item.seller?.nickname || item.seller?.username }}</b><span>校内认证 · {{ fmtRelative(item.createdAt) }}</span></div>
            <em>{{ item.favoriteCount }} 收藏</em>
          </footer>
        </div>
      </article>
    </div>
    <el-empty v-else description="暂时没有符合条件的学习资料">
      <el-button v-if="filters.q || filters.listingType" plain @click="reset">清空筛选</el-button>
      <el-button v-else-if="auth.isLoggedIn" type="primary" @click="goPublish">发布第一份资料</el-button>
    </el-empty>

    <el-pagination v-if="total > pageSize" v-model:current-page="page" :page-size="pageSize" :total="total" layout="prev, pager, next" background @current-change="load" />
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { Plus, Search, Star, StarFilled } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import { marketApi, type MarketItem } from "@/api/market";
import { useAuthStore } from "@/stores/auth";
import { fmtRelative } from "@/utils/format";
import UserAvatar from "@/components/common/UserAvatar.vue";

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const items = ref<MarketItem[]>([]);
const loading = ref(false);
const error = ref("");
const total = ref(0);
const page = ref(1);
const pageSize = 18;
let requestSeq = 0;
const listingOptions = [{ label: "全部", value: "" }, { label: "资料出售", value: "sell" }, { label: "资料求购", value: "wanted" }];
const filters = reactive({ q: String(route.query.q || ""), listingType: "", sort: "new" as "new" | "popular" | "price_asc" | "price_desc" });

onMounted(async () => {
  try {
    const meta = await marketApi.learningMaterialsMeta({ suppressErrorMessage: true });
    total.value = meta.category.itemCount || 0;
  } catch { /* 列表接口仍可独立工作 */ }
  await load();
});

async function load() {
  const seq = ++requestSeq;
  loading.value = true;
  error.value = "";
  try {
    const result = await marketApi.learningMaterials({ page: page.value, size: pageSize, ...filters }, { suppressErrorMessage: true });
    if (seq !== requestSeq) return;
    items.value = result.list;
    total.value = result.total;
  } catch (reason) {
    if (seq !== requestSeq) return;
    items.value = [];
    error.value = reason instanceof Error ? reason.message : "学习资料加载失败";
  } finally {
    if (seq === requestSeq) loading.value = false;
  }
}

function search() { page.value = 1; void load(); }
function reset() { Object.assign(filters, { q: "", listingType: "", sort: "new" }); search(); }
function goLogin() { router.push({ name: "login", query: { redirect: route.fullPath } }); }
function goPublish() { router.push({ name: "market-learning-materials-publish" }); }
function summary(value: string) { return value.replace(/[#>*_`\[\]()]/g, " ").replace(/\s+/g, " ").trim().slice(0, 82); }
async function toggleFavorite(item: MarketItem) {
  try {
    const result = await marketApi.favorite(item.id);
    item.favorited = result.favorited;
    item.favoriteCount = result.favoriteCount;
  } catch { ElMessage.error("收藏操作失败"); }
}
</script>

<style scoped>
.materials-page{display:flex;flex-direction:column;gap:18px;max-width:1320px;margin:0 auto}.crumb{display:flex;gap:8px;color:var(--cpu-text-secondary);font-size:12px}.crumb a{color:#a21caf;text-decoration:none}.materials-hero{position:relative;overflow:hidden;display:flex;justify-content:space-between;align-items:flex-end;gap:32px;padding:38px 42px;border:1px solid rgba(190,24,93,.12);border-radius:24px;color:#47152f;background:linear-gradient(120deg,#fff1f2 0%,#fce7f3 45%,#ede9fe 100%);box-shadow:0 20px 50px rgba(136,19,55,.08)}.materials-hero:before{content:"";position:absolute;right:24%;top:-52px;width:245px;height:245px;background:url('/brand/kaopu-cloud.svg') center/contain no-repeat;opacity:.38;transform:rotate(-8deg)}.materials-hero:after{content:"";position:absolute;right:-80px;bottom:-130px;width:310px;height:310px;border:52px solid rgba(255,255,255,.42);border-radius:50%}.hero-copy,.hero-actions{position:relative;z-index:1}.eyebrow{color:#9d174d;font-size:10px;font-weight:800;letter-spacing:.2em}.hero-copy h1{margin:8px 0 10px;font-size:38px;letter-spacing:-.03em}.hero-copy p{max-width:650px;margin:0;color:#7c3f5a;font-size:14px;line-height:1.8}.hero-tags{display:flex;gap:8px;margin-top:20px}.hero-tags span{padding:6px 10px;border:1px solid rgba(157,23,77,.13);border-radius:999px;color:#831843;background:rgba(255,255,255,.48);font-size:10px}.hero-actions{display:flex;align-items:center;gap:15px}.material-stat{display:flex;flex-direction:column;align-items:flex-end}.material-stat strong{font-size:34px;line-height:1}.material-stat span{margin-top:5px;color:#9d5d77;font-size:10px}.hero-actions :deep(.el-button--primary){border-color:#98155b;background:#98155b}.feature-row{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.feature-row article{display:flex;align-items:center;gap:13px;padding:15px 17px;border:1px solid rgba(190,24,93,.09);border-radius:14px;background:color-mix(in srgb,var(--cpu-card) 88%,#fff1f2)}.feature-row i{display:grid;place-items:center;width:36px;height:36px;border-radius:11px;color:#9d174d;background:#fce7f3;font-size:10px;font-style:normal;font-weight:800}.feature-row div{display:flex;flex-direction:column;gap:3px}.feature-row b{font-size:12px}.feature-row span{color:var(--cpu-text-secondary);font-size:10px}.materials-search{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:11px;padding:14px}.materials-search :deep(.el-segmented){align-self:center}.results-head{display:flex;align-items:flex-end;justify-content:space-between;padding-top:8px}.results-head span{color:#a21caf;font-size:9px;font-weight:800;letter-spacing:.14em}.results-head h2{margin:4px 0 0;font-size:23px}.results-head small{margin-left:5px;color:var(--cpu-text-secondary);font-size:11px;font-weight:500}.sort-select{width:155px}.materials-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.material-card{overflow:hidden;border:1px solid rgba(190,24,93,.1);border-radius:17px;background:var(--cpu-card);cursor:pointer;transition:.2s}.material-card:hover{transform:translateY(-4px);border-color:rgba(190,24,93,.28);box-shadow:0 16px 35px rgba(91,33,60,.1)}.material-cover{position:relative;height:185px;overflow:hidden;background:linear-gradient(145deg,#fff1f2,#f3e8ff)}.material-cover>img{width:100%;height:100%;object-fit:cover;transition:.25s}.material-card:hover .material-cover>img{transform:scale(1.035)}.cover-fallback{height:100%;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:8px;color:#9d174d}.cover-fallback span{display:grid;place-items:center;width:65px;height:65px;border-radius:20px;background:linear-gradient(145deg,#be185d,#7c3aed);box-shadow:0 12px 24px rgba(126,34,206,.18)}.cover-fallback span img{display:block;width:76%;height:76%;object-fit:contain}.cover-fallback b{font-size:8px;letter-spacing:.18em}.material-cover>em{position:absolute;left:12px;top:12px;padding:5px 8px;border-radius:7px;color:#fff;background:#be185d;font-size:9px;font-style:normal;font-weight:700}.material-cover>button{position:absolute;right:11px;top:11px;width:34px;height:34px;border:0;border-radius:50%;color:#64748b;background:rgba(255,255,255,.9);cursor:pointer;box-shadow:0 3px 12px rgba(15,23,42,.11)}.material-cover>button.active{color:#be185d}.material-copy{padding:16px}.material-kind{color:#a21caf;font-size:8px;font-weight:800;letter-spacing:.13em}.material-copy h3{height:44px;margin:6px 0;font-size:16px;line-height:22px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.material-copy>p{height:36px;margin:0;color:var(--cpu-text-secondary);font-size:10px;line-height:18px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.price-line{display:flex;align-items:baseline;gap:7px;margin:13px 0}.price-line>span,.price-line i{padding:2px 5px;border-radius:5px;color:#9d174d;background:#fce7f3;font-size:9px;font-style:normal}.price-line strong{color:#be185d;font-size:24px}.price-line small{font-size:11px}.price-line del{color:#94a3b8;font-size:10px}.material-copy footer{display:flex;align-items:center;gap:8px;padding-top:12px;border-top:1px solid var(--cpu-border-soft)}.material-copy footer>div{display:flex;min-width:0;flex-direction:column;gap:1px}.material-copy footer b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px}.material-copy footer span{color:var(--cpu-text-secondary);font-size:8px}.material-copy footer>em{margin-left:auto;color:var(--cpu-text-secondary);font-size:9px;font-style:normal}.loading-card{min-height:360px;padding:22px}.el-pagination{justify-content:center;margin-top:8px}
@media(max-width:900px){.materials-hero{align-items:flex-start;flex-direction:column;padding:29px}.hero-copy h1{font-size:31px}.hero-actions{width:100%;justify-content:space-between}.feature-row{grid-template-columns:1fr}.materials-search{grid-template-columns:1fr auto}.materials-search :deep(.el-segmented){grid-column:1/-1;grid-row:2}.materials-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:560px){.materials-hero{padding:24px 20px;border-radius:18px}.hero-copy h1{font-size:27px}.hero-tags{flex-wrap:wrap}.hero-actions{align-items:stretch;flex-direction:column}.material-stat{align-items:flex-start}.materials-search{grid-template-columns:1fr}.materials-search :deep(.el-segmented){grid-row:auto}.results-head{align-items:flex-start;flex-direction:column;gap:11px}.sort-select{width:100%}.materials-grid{grid-template-columns:1fr}.material-cover{height:200px}}
:global(html[data-theme="dark"]) .materials-hero{color:#fdf2f8;background:linear-gradient(120deg,rgba(131,24,67,.48),rgba(88,28,135,.45))}:global(html[data-theme="dark"]) .hero-copy p{color:#f0b7cf}:global(html[data-theme="dark"]) .feature-row article{background:rgba(131,24,67,.12)}
</style>
