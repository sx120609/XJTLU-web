<template>
  <div class="detail-page" v-loading="loading">
    <template v-if="item">
      <nav class="crumb"><router-link to="/market">校园市集</router-link><span>/</span><span>{{ categoryLabel(item.category) }}</span><span>/</span><b>{{ item.title }}</b></nav>
      <section class="product-card cpu-card">
        <div class="gallery">
          <div class="main-image"><img v-if="activeImage" :src="activeImage" :alt="item.title" /><div v-else>📦</div></div>
          <div v-if="item.images.length > 1" class="thumb-list"><button v-for="image in item.images" :key="image.id" :class="{ active: activeImage === image.url }" @click="activeImage = image.url"><img :src="image.url" alt="商品缩略图" /></button></div>
        </div>

        <div class="product-info">
          <div class="status-line"><span>出售</span><em :class="`status-${item.status}`">{{ statusLabel(item.status) }}</em><PromotionLabel v-if="item.promotions.pinned" label="置顶" kind="pin" /><PromotionLabel v-if="item.promotions.home" label="推广" kind="home" /><time v-if="item.expiresAt">有效期至 {{ formatDate(item.expiresAt) }}</time></div>
          <h1>{{ item.title }}</h1>
          <div class="price-box"><strong><small>¥</small>{{ item.price }}</strong><del v-if="item.originalPrice">原价 ¥{{ item.originalPrice }}</del><i v-if="item.negotiable">可议价</i></div>
          <dl>
            <div><dt>商品成色</dt><dd>{{ conditionLabel(item.condition) }}</dd></div>
            <div><dt>交付方式</dt><dd>{{ tradeModeLabel(item.tradeMode) }}</dd></div>
            <div><dt>所在校区</dt><dd>{{ item.campus || '与卖家协商' }}</dd></div>
            <div><dt>推荐地点</dt><dd>{{ item.location || '与卖家协商' }}</dd></div>
            <div v-if="item.brand || item.model"><dt>品牌 / 型号</dt><dd>{{ [item.brand, item.model].filter(Boolean).join(' · ') }}</dd></div>
            <div v-if="item.usageDuration"><dt>使用时间</dt><dd>{{ item.usageDuration }}</dd></div>
            <div v-if="item.accessories"><dt>配件情况</dt><dd>{{ item.accessories }}</dd></div>
            <div v-if="item.availableTime"><dt>可交易时间</dt><dd>{{ item.availableTime }}</dd></div>
            <div><dt>当面测试</dt><dd>{{ item.testAllowed ? '支持' : '请与卖家确认' }}</dd></div>
            <div><dt>浏览 / 收藏</dt><dd>{{ item.viewCount }} / {{ item.favoriteCount }}</dd></div>
          </dl>

          <div v-if="!item.mine" class="buy-actions">
            <el-button type="primary" :disabled="!auth.isLoggedIn || item.status !== 'active'" :loading="submitting" @click="startChat">发起私聊</el-button>
            <el-button circle :icon="item.favorited ? StarFilled : Star" @click="favorite" />
          </div>
          <div v-else class="owner-actions">
            <el-button v-if="['active', 'draft', 'expired', 'withdrawn', 'sold'].includes(item.status)" type="primary" @click="$router.push({ name: 'market-edit', params: { id: item.id } })">编辑商品</el-button>
            <el-button v-if="item.status === 'active'" @click="boostItem">积分推流</el-button>
            <el-button @click="$router.push({ name: 'market-messages' })">查看私聊</el-button>
            <el-button v-if="['expired', 'withdrawn', 'sold'].includes(item.status)" @click="relist">重新上架</el-button>
            <el-button v-if="['active', 'expired', 'withdrawn'].includes(item.status)" type="success" plain @click="markSold">标记已售</el-button>
            <el-button v-if="['active', 'negotiating', 'expired'].includes(item.status)" type="danger" plain @click="withdraw">下架</el-button>
          </div>
          <p v-if="!auth.isLoggedIn" class="login-tip">登录 XJTLU 账号后即可收藏和发起私聊。</p>
          <div class="trade-note"><b>简单交易</b><span>有意向就直接私聊，双方自行沟通价格、时间和校内地点。实际成交后买卖双方分别确认，系统才计为成交并发放积分；靠浦不代收商品款。</span></div>
        </div>
      </section>

      <section class="content-grid">
        <article class="description-card cpu-card">
          <h2>商品详情</h2><div class="description">{{ item.description }}</div>
          <div v-if="item.flaws" class="flaw-note"><b>瑕疵说明</b><span>{{ item.flaws }}</span></div>
          <div class="public-actions"><el-button plain @click="$router.push({ path: '/post', query: { board: 'trade-talk', itemId: item.id } })">发起关联讨论</el-button><el-button plain @click="shareOpen = true">分享商品</el-button><el-button v-if="!item.mine && auth.isLoggedIn" text type="danger" @click="reportOpen = true">举报信息</el-button></div>
        </article>
        <aside class="seller-card cpu-card" role="button" tabindex="0" @click="$router.push(`/market/seller/${item.sellerId}`)" @keydown.enter="$router.push(`/market/seller/${item.sellerId}`)">
          <div class="seller-head"><UserAvatar :size="52" :src="item.seller.avatar" :name="item.seller.nickname" /><div><strong>{{ item.seller.nickname || '靠浦用户' }}</strong><span>{{ sellerTrust?.identity.label || (item.seller.studentSso ? '✓ XJTLU 校园认证' : '校园平台用户') }}</span></div></div>
          <div class="seller-stats"><div><b>{{ sellerTrust?.score ?? '—' }}</b><span>信誉值</span></div><div><b>{{ Number(sellerProfile?.stats.rating ?? item.sellerRating ?? 0).toFixed(1) }}</b><span>交易评分</span></div><div><b>{{ sellerTrust?.completedTradeCount ?? sellerProfile?.stats.completedTrades ?? 0 }}</b><span>成交笔数</span></div><div><b>{{ sellerTrust?.completionRate ?? 0 }}%</b><span>成交率</span></div></div>
          <p>查看卖家的在售物品和交易记录。建议在校园公共区域见面，当面验货；商品款由买家直接支付给卖家。</p>
        </aside>
      </section>

      <section v-if="matchingWanted.length" class="match-section cpu-card">
        <header><div><span>智能撮合</span><h2>这些同学正在求购类似物品</h2></div><router-link to="/market/wanted">查看全部求购</router-link></header>
        <div class="match-grid"><article v-for="match in matchingWanted" :key="match.wantedPost.id" @click="$router.push(`/market/wanted/${match.wantedPost.id}`)"><div class="match-score"><b>{{ match.score }}</b><small>匹配度</small></div><div class="match-copy"><strong>{{ match.wantedPost.title }}</strong><p>预算 ¥{{ match.wantedPost.budgetMin }}–{{ match.wantedPost.budgetMax }} · {{ match.wantedPost.campus }}</p><div><span v-for="reason in match.reasons" :key="reason.key">{{ reason.label }}</span></div></div></article></div>
      </section>
      <section v-if="related.length" class="related"><header><h2>同类商品</h2><router-link to="/market">查看更多</router-link></header><div class="related-grid"><article v-for="row in related" :key="row.id" @click="$router.push({ name: 'market-item', params: { id: row.id } })"><div><img v-if="row.cover" :src="row.cover" :alt="row.title" /><span v-else>📦</span></div><h3>{{ row.title }}</h3><strong>¥{{ row.price }}</strong></article></div></section>
    </template>
    <el-empty v-else-if="!loading" description="商品不存在或已被下架"><el-button @click="$router.push('/market')">返回市集</el-button></el-empty>

    <el-dialog v-model="reportOpen" title="举报商品" width="460px"><el-select v-model="report.reason" placeholder="选择原因" style="width:100%"><el-option v-for="reason in reportReasons" :key="reason" :label="reason" :value="reason" /></el-select><el-input v-model="report.detail" type="textarea" :rows="4" maxlength="1000" show-word-limit placeholder="补充说明" style="margin-top:12px" /><template #footer><el-button @click="reportOpen = false">取消</el-button><el-button type="danger" :loading="submitting" @click="submitReport">提交举报</el-button></template></el-dialog>
    <MarketShareDialog v-model="shareOpen" :title="item?.title || '校园市集商品'" :summary="item ? `¥${item.price}，${item.campus || '校内'}面交` : ''" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { Star, StarFilled } from "@element-plus/icons-vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { marketApi, marketTradeModeLabel, type MarketItem, type MarketTrustProfile, type MarketWantedMatch } from "@/api/market";
import { useAuthStore } from "@/stores/auth";
import UserAvatar from "@/components/common/UserAvatar.vue";
import MarketShareDialog from "@/components/market/MarketShareDialog.vue";
import PromotionLabel from "@/components/market/PromotionLabel.vue";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const item = ref<MarketItem | null>(null);
const related = ref<MarketItem[]>([]);
const matchingWanted = ref<MarketWantedMatch[]>([]);
const sellerProfile = ref<Awaited<ReturnType<typeof marketApi.userMarketProfile>> | null>(null);
const sellerTrust = ref<MarketTrustProfile | null>(null);
const loading = ref(false);
const submitting = ref(false);
const activeImage = ref("");
const reportOpen = ref(false);
const shareOpen = ref(route.query.published === "1");
const report = reactive({ reason: "", detail: "" });
const reportReasons = ["疑似诈骗", "禁售或违规物品", "商品信息虚假", "盗用图片", "恶意引流", "其他"];
const categories = ref<Record<string, string>>({});

onMounted(load);
watch(() => route.params.id, load);

async function load() {
  const id = Number(route.params.id);
  if (!id) return;
  loading.value = true;
  try {
    const nextItem = await marketApi.item(id, { suppressErrorMessage: true });
    if (nextItem.category === "digital_goods") {
      await router.replace({ name: "market-learning-material-item", params: { id } });
      return;
    }
    item.value = nextItem;
    for (const badge of [nextItem.promotions.pinned, nextItem.promotions.home]) if (badge?.orderId) void marketApi.recordPromotionEvent(badge.orderId, "impression", { suppressErrorMessage: true });
    activeImage.value = nextItem.cover;
    const [meta, result, profile, trust, matches] = await Promise.all([
      marketApi.meta({ suppressErrorMessage: true }),
      marketApi.items({ category: nextItem.category, listingType: "sell", size: 8 }, { suppressErrorMessage: true }),
      marketApi.userMarketProfile(nextItem.sellerId, { suppressErrorMessage: true }).catch(() => null),
      marketApi.userTrust(nextItem.sellerId, { suppressErrorMessage: true }).catch(() => null),
      marketApi.itemMatches(id, { suppressErrorMessage: true }).catch(() => []),
    ]);
    categories.value = Object.fromEntries(meta.categories.map((category) => [category.slug, category.name]));
    related.value = result.list.filter((row) => row.id !== id).slice(0, 4);
    sellerProfile.value = profile;
    sellerTrust.value = trust;
    matchingWanted.value = matches;
  } catch {
    item.value = null;
    related.value = [];
    sellerProfile.value = null;
    sellerTrust.value = null;
    matchingWanted.value = [];
  } finally { loading.value = false; }
}

async function favorite() {
  if (!item.value) return;
  if (!auth.isLoggedIn) return router.push({ name: "login", query: { redirect: route.fullPath } });
  const result = await marketApi.favorite(item.value.id);
  item.value.favorited = result.favorited;
  item.value.favoriteCount = result.favoriteCount;
}

async function startChat() {
  if (!item.value) return;
  if (!auth.isLoggedIn) return router.push({ name: "login", query: { redirect: route.fullPath } });
  submitting.value = true;
  try {
    const conversation = await marketApi.createConversation(item.value.id);
    await router.push({ name: "market-messages", query: { conversation: conversation.id } });
  } finally { submitting.value = false; }
}

async function boostItem() {
  if (!item.value) return;
  await router.push({
    name: "market-promotions",
    query: { mode: "points", targetType: "market_item", targetId: String(item.value.id) },
  });
}

async function withdraw() {
  if (!item.value) return;
  await ElMessageBox.confirm("下架后商品将不再出现在市集列表，未成交的私聊交易会保留但不能继续确认成交，确定继续？", "下架商品", { type: "warning" });
  item.value = await marketApi.updateItemLifecycle(item.value.id, "withdraw");
  ElMessage.success("商品已下架");
}

async function relist() {
  if (!item.value) return;
  item.value = await marketApi.updateItemLifecycle(item.value.id, "relist");
  ElMessage.success("商品已重新上架");
}

async function markSold() {
  if (!item.value) return;
  await ElMessageBox.confirm("确认商品已经通过其他方式售出？站内未完成的交易将不能再确认成交。", "标记已售", { type: "warning" });
  item.value = await marketApi.updateItemLifecycle(item.value.id, "mark_sold");
  ElMessage.success("商品已标记为售出");
}

async function submitReport() {
  if (!item.value || !report.reason) return void ElMessage.warning("请选择举报原因");
  submitting.value = true;
  try { await marketApi.report(item.value.id, report); reportOpen.value = false; ElMessage.success("举报已提交"); }
  finally { submitting.value = false; }
}

function categoryLabel(value: string) { return categories.value[value] || value; }
function conditionLabel(value: string) { return ({ new: "全新", like_new: "近全新", good: "使用良好", fair: "有使用痕迹" } as Record<string, string>)[value] || value; }
const tradeModeLabel = marketTradeModeLabel;
function statusLabel(value: string) { return ({ draft: "草稿", reviewing: "审核中", active: "在售", negotiating: "洽谈中", reserved: "历史洽谈", sold: "已售出", expired: "已过期", withdrawn: "已下架", hidden: "已隐藏" } as Record<string, string>)[value] || value; }
function formatDate(value: string) { return new Date(value).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" }); }
</script>

<style scoped>
.detail-page{display:flex;flex-direction:column;gap:17px}.crumb{display:flex;align-items:center;gap:8px;color:var(--cpu-text-secondary);font-size:11px}.crumb a{color:var(--cpu-primary);text-decoration:none}.crumb b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.product-card{display:grid;grid-template-columns:minmax(340px,1fr) minmax(370px,.9fr);gap:34px;padding:26px}.main-image{display:grid;place-items:center;aspect-ratio:1.12/1;overflow:hidden;border-radius:14px;background:var(--cpu-surface-soft);font-size:70px}.main-image img{width:100%;height:100%;object-fit:contain}.thumb-list{display:flex;gap:8px;margin-top:10px;overflow-x:auto}.thumb-list button{width:66px;height:58px;padding:0;overflow:hidden;border:2px solid transparent;border-radius:8px;background:none}.thumb-list button.active{border-color:var(--cpu-primary)}.thumb-list img{width:100%;height:100%;object-fit:cover}.status-line{display:flex;align-items:center;gap:7px}.status-line span,.status-line em{padding:4px 7px;border-radius:5px;color:var(--cpu-primary);background:var(--cpu-primary-soft);font-size:10px;font-style:normal}.status-line em{color:var(--cpu-text-secondary);background:var(--cpu-surface-soft)}.status-line time{margin-left:auto;color:var(--cpu-text-muted);font-size:9px}.product-info h1{margin:13px 0;font-size:25px;line-height:1.4}.price-box{display:flex;align-items:baseline;gap:10px;padding:15px;border-radius:11px;background:linear-gradient(90deg,var(--cpu-primary-soft),var(--cpu-card))}.price-box strong{color:#ef4444;font-size:32px}.price-box small{font-size:14px}.price-box del{color:var(--cpu-text-muted);font-size:12px}.price-box i{padding:3px 7px;border-radius:5px;color:#b45309;background:#fef3c7;font-size:10px;font-style:normal}.product-info dl{display:grid;grid-template-columns:1fr 1fr;margin:16px 0}.product-info dl div{display:flex;gap:10px;padding:9px 3px;border-bottom:1px dashed var(--cpu-border-soft);font-size:11px}.product-info dt{flex:0 0 auto;color:var(--cpu-text-secondary)}.product-info dd{margin:0;font-weight:600}.buy-actions,.owner-actions{display:flex;flex-wrap:wrap;gap:8px}.buy-actions .el-button:nth-child(2){flex:1}.login-tip{color:#b45309;font-size:11px}.trade-note{display:flex;gap:9px;margin-top:14px;padding:10px;border-radius:9px;color:var(--cpu-primary);background:var(--cpu-primary-soft);font-size:10px}.trade-note b{flex:0 0 auto}.trade-note span{color:var(--cpu-text-secondary);line-height:1.5}.content-grid{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:17px}.description-card,.seller-card{padding:22px}.description-card h2{margin:0 0 16px;font-size:18px}.description{min-height:150px;white-space:pre-wrap;font-size:13px;line-height:1.85}.flaw-note{display:flex;gap:10px;margin-top:16px;padding:12px;border-radius:9px;color:var(--cpu-text-secondary);background:var(--cpu-surface-soft);font-size:11px}.flaw-note b{flex:0 0 auto;color:var(--cpu-text)}.public-actions{display:flex;gap:8px;margin-top:18px;padding-top:14px;border-top:1px solid var(--cpu-border-soft)}.seller-card{cursor:pointer}.seller-head{display:flex;align-items:center;gap:12px}.seller-head div{display:flex;flex-direction:column;gap:5px}.seller-head span{color:var(--cpu-primary);font-size:10px}.seller-stats{display:grid;grid-template-columns:repeat(4,1fr);margin:18px 0}.seller-stats div{display:flex;align-items:center;flex-direction:column;border-right:1px solid var(--cpu-border-soft)}.seller-stats div:last-child{border:0}.seller-stats b{font-size:18px}.seller-stats span{color:var(--cpu-text-secondary);font-size:9px}.seller-card p{margin:0;padding:10px;border-radius:8px;color:var(--cpu-text-secondary);background:var(--cpu-surface-soft);font-size:10px;line-height:1.6}.match-section{padding:20px}.match-section header{display:flex;align-items:flex-end;justify-content:space-between;gap:12px}.match-section header span{color:var(--cpu-primary);font-size:10px;letter-spacing:.12em}.match-section h2{margin:4px 0 0;font-size:18px}.match-section header a{color:var(--cpu-primary);font-size:11px}.match-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:14px}.match-grid article{display:flex;align-items:center;gap:12px;padding:13px;border:1px solid var(--cpu-border-soft);border-radius:11px;cursor:pointer}.match-grid article:hover{border-color:var(--cpu-primary)}.match-score{display:flex;align-items:center;justify-content:center;width:54px;height:54px;flex:0 0 auto;flex-direction:column;border-radius:50%;color:var(--cpu-primary);background:var(--cpu-primary-soft)}.match-score b{font-size:17px}.match-score small{font-size:8px}.match-copy{min-width:0}.match-copy>strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.match-copy p{margin:4px 0;color:var(--cpu-text-secondary);font-size:10px}.match-copy>div{display:flex;gap:4px;flex-wrap:wrap}.match-copy span{padding:2px 6px;border-radius:9px;color:var(--cpu-primary);background:var(--cpu-primary-soft);font-size:9px}.related header{display:flex;align-items:center;justify-content:space-between}.related header a{color:var(--cpu-primary);font-size:12px}.related-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.related-grid article{padding:10px;border:1px solid var(--cpu-border-soft);border-radius:12px;background:var(--cpu-card);cursor:pointer}.related-grid article>div{display:grid;place-items:center;height:130px;overflow:hidden;border-radius:8px;background:var(--cpu-surface-soft);font-size:40px}.related-grid img{width:100%;height:100%;object-fit:cover}.related-grid h3{height:36px;margin:8px 0 3px;overflow:hidden;font-size:12px}.related-grid strong{color:#ef4444}@media(max-width:850px){.product-card{grid-template-columns:1fr;padding:16px}.content-grid{grid-template-columns:1fr}.related-grid{grid-template-columns:repeat(2,1fr)}}@media(max-width:560px){.main-image{aspect-ratio:1}.product-info dl{grid-template-columns:1fr}.buy-actions{position:sticky;bottom:8px;z-index:5;padding:8px;border-radius:10px;background:var(--cpu-card);box-shadow:0 6px 24px rgba(0,0,0,.16)}.product-info h1{font-size:21px}.price-box strong{font-size:28px}.match-section{padding:15px}.match-section header{align-items:flex-start;flex-direction:column}.match-grid{grid-template-columns:1fr}.match-grid article{padding:11px}}
</style>
