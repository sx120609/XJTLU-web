<template>
  <div class="wanted-detail" v-loading="loading">
    <template v-if="post">
      <nav class="crumb"><router-link to="/market/wanted">校园求购</router-link><span>/</span><b>{{ post.title }}</b></nav>
      <section class="wanted-card cpu-card">
        <header>
          <div class="category-icon">{{ categoryIcon }}</div>
          <div class="headline"><div><el-tag size="small" :type="statusType">{{ statusLabel }}</el-tag><PromotionLabel v-if="post.promotion.urgent" label="加急" kind="urgent" /><span>发布于 {{ fmtRelative(post.createdAt) }}</span></div><h1>{{ post.title }}</h1><p>{{ categoryName }} · {{ post.campus || '校内' }} · {{ post.location || '地点待协商' }}</p></div>
          <div class="budget"><small>预算范围</small><strong>¥{{ post.budgetMin }}<template v-if="post.budgetMax !== post.budgetMin">–{{ post.budgetMax }}</template></strong></div>
        </header>

        <div class="detail-grid">
          <main>
            <section><h2>需求说明</h2><p class="description">{{ post.description }}</p></section>
            <section class="facts"><h2>希望收到的物品</h2><dl><div><dt>品牌 / 型号</dt><dd>{{ post.brandModel || '不限' }}</dd></div><div><dt>可接受成色</dt><dd>{{ post.condition || '可协商' }}</dd></div><div><dt>希望交易时间</dt><dd>{{ post.expectedTradeTime || '与发布者协商' }}</dd></div><div><dt>有效期至</dt><dd>{{ formatDate(post.expiresAt) }}</dd></div></dl></section>
            <el-alert type="warning" :closable="false" show-icon title="请在校内公共区域当面验货。平台不代收商品款；不要提前转账，不要向陌生人提供验证码或账户密码。" />
          </main>

          <aside>
            <section class="author-card">
              <div><UserAvatar :size="44" :src="post.author.avatar" :name="post.author.nickname" /><span><strong>{{ post.author.nickname || '校园用户' }}</strong><small>{{ post.isAnonymous ? '匿名发布 · 身份由平台核验' : post.author.studentSso ? 'XJTLU 身份已认证' : '校园平台用户' }}</small></span></div>
              <p>求购收到 {{ post.responseCount }} 个响应。响应物品和联系方式仅对交易双方可见。</p>
            </section>
            <div class="actions">
              <template v-if="post.mine">
                <el-button v-if="canEdit" @click="$router.push(`/market/wanted/${post.id}/edit`)">编辑求购</el-button>
                <el-button v-if="canFinish" @click="$router.push('/market/promotions')">申请加急</el-button>
                <el-button v-if="canRenew" type="primary" plain @click="lifecycle('renew')">续期 21 天</el-button>
                <el-button v-if="canFinish" type="success" plain @click="lifecycle('complete')">标记已求到</el-button>
                <el-button v-if="canFinish" type="danger" plain @click="lifecycle('cancel')">结束求购</el-button>
              </template>
              <template v-else>
                <el-button v-if="canRespond" type="primary" size="large" @click="openResponse">我有合适的物品</el-button>
                <el-button v-else disabled>{{ post.allowSellerOffers ? '当前不可响应' : '发布者未开放响应' }}</el-button>
              </template>
              <el-button @click="$router.push({ path: '/post', query: { board: 'trade-talk', wantedPostId: post.id } })">发起关联讨论</el-button>
              <el-button @click="shareOpen = true">分享求购</el-button>
              <el-button v-if="!post.mine && auth.isLoggedIn" type="danger" plain @click="reportWanted">举报求购</el-button>
            </div>
          </aside>
        </div>
      </section>

      <section v-if="matchingItems.length" class="matching-items cpu-card">
        <header><div><span>可解释匹配</span><h2>市集里已有这些合适物品</h2><p>按品类、预算、校区和描述关键词计算，不读取私聊或联系方式。</p></div><router-link to="/market">继续逛市集</router-link></header>
        <div class="matching-grid"><article v-for="match in matchingItems" :key="match.item.id" @click="$router.push(`/market/item/${match.item.id}`)"><div class="matching-cover"><img v-if="match.item.cover" :src="match.item.cover" :alt="match.item.title" /><span v-else>📦</span><b>{{ match.score }} 分</b></div><div class="matching-copy"><strong>{{ match.item.title }}</strong><p>¥{{ match.item.price }} · {{ match.item.campus || '校内' }} · {{ match.item.location || '地点待协商' }}</p><div><span v-for="reason in match.reasons" :key="reason.key">{{ reason.label }}</span></div></div></article></div>
      </section>

      <section v-if="post.responses?.length" class="responses cpu-card">
        <header><div><h2>{{ post.mine ? '收到的响应' : '我的响应' }}</h2><p>{{ post.mine ? '接受后将锁定对应商品，并创建 72 小时校内预约。' : '发布者接受后，双方可在交易消息中约定面交。' }}</p></div><el-tag>{{ post.responses.length }} 个</el-tag></header>
        <article v-for="response in post.responses" :key="response.id">
          <div class="response-cover"><img v-if="response.item.cover" :src="response.item.cover" :alt="response.item.title" /><span v-else>📦</span></div>
          <div class="response-copy"><div><strong>{{ response.item.title }}</strong><el-tag size="small" :type="responseStatusType(response.status)">{{ responseStatus(response.status) }}</el-tag></div><p>{{ response.description }}</p><small>{{ response.seller?.nickname || '校园用户' }} · 可交易时间：{{ response.availableTime || '待协商' }}</small></div>
          <div class="response-price"><strong>¥{{ response.price }}</strong><el-button size="small" @click="$router.push(`/market/item/${response.itemId}`)">查看物品</el-button></div>
          <div v-if="response.status === 'pending'" class="response-actions">
            <template v-if="post.mine"><el-button size="small" type="danger" plain @click="handleResponse(response.id, 'reject')">婉拒</el-button><el-button size="small" type="primary" @click="handleResponse(response.id, 'accept')">接受并预约</el-button></template>
            <el-button v-else size="small" @click="handleResponse(response.id, 'cancel')">撤回响应</el-button>
          </div>
        </article>
      </section>
    </template>
    <el-empty v-else-if="!loading" description="求购不存在或已被移除"><el-button @click="$router.push('/market/wanted')">返回求购列表</el-button></el-empty>

    <el-dialog v-model="responseOpen" title="响应这条求购" width="620px" destroy-on-close>
      <el-form label-position="top">
        <el-radio-group v-model="response.mode" class="response-mode"><el-radio-button value="existing">关联我的在售商品</el-radio-button><el-radio-button value="new">仅向求购者展示新物品</el-radio-button></el-radio-group>
        <el-form-item v-if="response.mode === 'existing'" label="选择商品" required><el-select v-model="response.itemId" placeholder="请选择自己当前在售的实体商品"><el-option v-for="item in availableItems" :key="item.id" :label="`${item.title} · ¥${item.price}`" :value="item.id" /></el-select><small v-if="!availableItems.length">还没有可关联的在售商品，也可以切换为上传新物品。</small></el-form-item>
        <template v-else>
          <el-form-item label="物品名称" required><el-input v-model="response.title" maxlength="120" placeholder="品牌、型号和关键信息" /></el-form-item>
          <div class="two-cols"><el-form-item label="品牌"><el-input v-model="response.brand" maxlength="80" /></el-form-item><el-form-item label="型号"><el-input v-model="response.model" maxlength="80" /></el-form-item></div>
          <el-form-item label="实拍图" required><div class="image-list"><div v-for="url in response.images" :key="url"><img :src="url" alt="响应物品" /><button type="button" @click="response.images.splice(response.images.indexOf(url), 1)">×</button></div><label v-if="response.images.length < 5"><input type="file" accept="image/*" multiple :disabled="uploading" @change="uploadImages" /><span>{{ uploading ? '上传中…' : '+ 添加图片' }}</span></label></div></el-form-item>
          <el-form-item label="物品成色"><el-select v-model="response.condition"><el-option label="全新" value="new" /><el-option label="近全新" value="like_new" /><el-option label="使用良好" value="good" /><el-option label="有使用痕迹" value="fair" /></el-select></el-form-item>
        </template>
        <div class="two-cols"><el-form-item label="响应价格（元）" required><el-input-number v-model="response.price" :min="0.01" :max="999999" :precision="2" controls-position="right" /></el-form-item><el-form-item label="可交易时间"><el-input v-model="response.availableTime" maxlength="300" placeholder="例如：工作日 18:00 后" /></el-form-item></div>
        <el-form-item label="物品与交易说明" required><el-input v-model="response.description" type="textarea" :rows="5" maxlength="5000" show-word-limit placeholder="如实说明使用情况、瑕疵、配件和验货要求，请勿填写联系方式。" /></el-form-item>
        <el-alert type="info" :closable="false" show-icon title="物品不会自动成交。求购者接受后才会生成预约，商品款仍由双方线下直接结算。" />
      </el-form>
      <template #footer><el-button @click="responseOpen = false">取消</el-button><el-button type="primary" :loading="submitting" @click="submitResponse">提交响应</el-button></template>
    </el-dialog>

    <MarketShareDialog v-model="shareOpen" :title="post?.title || '校园求购'" :summary="post ? `预算 ¥${post.budgetMin}–${post.budgetMax}，${post.campus || '校内'}面交` : ''" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import { marketApi, type MarketCategoryOption, type MarketItem, type MarketItemMatch, type WantedPost } from "@/api/market";
import { uploadApi } from "@/api/topic";
import { useAuthStore } from "@/stores/auth";
import { fmtRelative } from "@/utils/format";
import UserAvatar from "@/components/common/UserAvatar.vue";
import PromotionLabel from "@/components/market/PromotionLabel.vue";
import MarketShareDialog from "@/components/market/MarketShareDialog.vue";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const post = ref<WantedPost | null>(null);
const categories = ref<MarketCategoryOption[]>([]);
const availableItems = ref<MarketItem[]>([]);
const matchingItems = ref<MarketItemMatch[]>([]);
const loading = ref(false);
const submitting = ref(false);
const uploading = ref(false);
const responseOpen = ref(false);
const shareOpen = ref(route.query.published === "1");
const response = reactive({ mode: "existing" as "existing" | "new", itemId: undefined as number | undefined, title: "", brand: "", model: "", condition: "good", images: [] as string[], price: 0, availableTime: "", description: "" });
const category = computed(() => categories.value.find((entry) => entry.slug === post.value?.category));
const categoryIcon = computed(() => category.value?.icon || "📦");
const categoryName = computed(() => category.value?.name || post.value?.category || "其他");
const statusLabel = computed(() => ({ reviewing: "审核中", active: "求购中", responded: "已有响应", matched: "已匹配", completed: "已求到", cancelled: "已结束", expired: "已过期", removed: "已移除" } as Record<string, string>)[post.value?.status || ""] || post.value?.status);
const statusType = computed(() => post.value?.status === "completed" ? "success" : ["cancelled", "expired", "removed"].includes(post.value?.status || "") ? "info" : post.value?.status === "reviewing" ? "warning" : "primary");
const canEdit = computed(() => Boolean(post.value && ["active", "responded", "expired"].includes(post.value.status)));
const canRenew = computed(() => Boolean(post.value && ["active", "responded", "expired", "cancelled"].includes(post.value.status)));
const canFinish = computed(() => Boolean(post.value && ["active", "responded"].includes(post.value.status)));
const canRespond = computed(() => Boolean(post.value && auth.isLoggedIn && post.value.allowSellerOffers && ["active", "responded"].includes(post.value.status)));

onMounted(load);

async function load() {
  loading.value = true;
  try {
    const id = Number(route.params.id);
    const [wanted, meta, matches] = await Promise.all([
      marketApi.wantedPost(id, { suppressErrorMessage: true }),
      marketApi.meta({ suppressErrorMessage: true }),
      marketApi.wantedMatches(id, { suppressErrorMessage: true }).catch(() => []),
    ]);
    post.value = wanted;
    if (wanted.promotion.urgent?.orderId) void marketApi.recordPromotionEvent(wanted.promotion.urgent.orderId, "impression", { suppressErrorMessage: true });
    categories.value = meta.categories;
    matchingItems.value = matches;
  } catch (error) {
    post.value = null;
    matchingItems.value = [];
    ElMessage.error(error instanceof Error ? error.message : "求购加载失败");
  } finally { loading.value = false; }
}

async function openResponse() {
  if (!auth.isLoggedIn) return router.push({ name: "login", query: { redirect: route.fullPath } });
  const mine = await marketApi.mine({ suppressErrorMessage: true });
  availableItems.value = mine.selling.filter((item) => item.status === "active" && item.deliveryType === "physical" && item.visibility === "public");
  response.mode = availableItems.value.length ? "existing" : "new";
  response.itemId = availableItems.value[0]?.id;
  response.price = Number(post.value?.budgetMax || 0);
  response.availableTime = "";
  response.description = "";
  responseOpen.value = true;
}

async function uploadImages(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files || []).slice(0, 5 - response.images.length);
  if (!files.length) return;
  uploading.value = true;
  try {
    for (const file of files) response.images.push((await uploadApi.media(file, file.name)).url);
  } finally { uploading.value = false; input.value = ""; }
}

async function submitResponse() {
  if (!post.value || submitting.value) return;
  if (response.mode === "existing" && !response.itemId) return void ElMessage.warning("请选择一个在售商品");
  if (response.mode === "new" && (!response.title.trim() || !response.images.length)) return void ElMessage.warning("请填写物品名称并上传至少一张实拍图");
  if (response.price <= 0 || !response.description.trim()) return void ElMessage.warning("请填写响应价格和物品说明");
  submitting.value = true;
  try {
    await marketApi.respondToWanted(post.value.id, { itemId: response.mode === "existing" ? response.itemId : undefined, title: response.mode === "new" ? response.title : undefined, price: response.price, description: response.description, images: response.mode === "new" ? response.images : undefined, condition: response.condition, brand: response.brand, model: response.model, availableTime: response.availableTime });
    responseOpen.value = false;
    ElMessage.success("响应已提交，等待求购者处理");
    await load();
  } finally { submitting.value = false; }
}

async function handleResponse(id: number, action: "accept" | "reject" | "cancel") {
  if (action === "accept") await ElMessageBox.confirm("接受后会锁定该物品并生成 72 小时预约。请先核对物品描述和价格。", "接受响应", { type: "warning" });
  await marketApi.updateWantedResponse(id, action);
  ElMessage.success(action === "accept" ? "已接受响应，预约已经创建" : "操作成功");
  if (action === "accept") await router.push("/market/mine?tab=reservations"); else await load();
}

async function lifecycle(action: "renew" | "cancel" | "complete") {
  if (!post.value) return;
  if (action !== "renew") await ElMessageBox.confirm(action === "complete" ? "确认已经求到物品并结束这条求购？" : "确认结束这条求购？未处理响应会一并关闭。", "确认操作", { type: "warning" });
  post.value = await marketApi.updateWantedLifecycle(post.value.id, action);
  ElMessage.success(action === "renew" ? "求购已续期" : "求购状态已更新");
  await load();
}

async function reportWanted() {
  if (!post.value) return;
  const { value } = await ElMessageBox.prompt("请简要说明违规类型或风险情况，管理员会结合完整内容核查。", "举报求购", { inputPattern: /\S{2,80}/, inputErrorMessage: "请填写 2–80 个字符", confirmButtonText: "提交举报", type: "warning" });
  await marketApi.reportWanted(post.value.id, { reason: value });
  ElMessage.success("举报已提交，感谢你的反馈");
}

function formatDate(value: string) { return new Date(value).toLocaleString("zh-CN", { year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }); }
function responseStatus(value: string) { return ({ pending: "等待处理", accepted: "已接受", rejected: "未接受", cancelled: "已撤回", expired: "已过期" } as Record<string, string>)[value] || value; }
function responseStatusType(value: string) { return value === "accepted" ? "success" : value === "pending" ? "warning" : "info"; }
</script>

<style scoped>
.wanted-detail{display:flex;flex-direction:column;gap:16px}.crumb{display:flex;gap:7px;overflow:hidden;color:var(--cpu-text-secondary);font-size:10px}.crumb a{color:var(--cpu-primary)}.crumb b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.wanted-card{padding:24px}.wanted-card>header{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:16px;padding-bottom:20px;border-bottom:1px solid var(--cpu-border-soft)}.category-icon{display:grid;place-items:center;width:58px;height:58px;border-radius:16px;background:var(--cpu-primary-soft);font-size:30px}.headline>div{display:flex;align-items:center;gap:8px}.headline>div span{color:var(--cpu-text-secondary);font-size:9px}.headline h1{margin:8px 0 4px;font-size:25px}.headline p{margin:0;color:var(--cpu-text-secondary);font-size:11px}.budget{text-align:right}.budget small{display:block;color:var(--cpu-text-secondary);font-size:9px}.budget strong{color:#ef4444;font-size:27px}.detail-grid{display:grid;grid-template-columns:minmax(0,1fr) 270px;gap:30px;padding-top:22px}.detail-grid main{display:flex;min-width:0;flex-direction:column;gap:22px}.detail-grid h2,.responses h2{margin:0 0 10px;font-size:16px}.description{margin:0;white-space:pre-wrap;color:var(--cpu-text-secondary);font-size:13px;line-height:1.9}.facts dl{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:0}.facts dl div{padding:11px;border-radius:9px;background:var(--cpu-surface-soft)}.facts dt{color:var(--cpu-text-secondary);font-size:9px}.facts dd{margin:5px 0 0;font-size:12px}.detail-grid aside{display:flex;flex-direction:column;gap:12px}.author-card{padding:14px;border:1px solid var(--cpu-border-soft);border-radius:12px}.author-card>div{display:flex;align-items:center;gap:9px}.author-card span{display:flex;flex-direction:column;gap:3px}.author-card small{color:var(--cpu-primary);font-size:9px}.author-card p{margin:12px 0 0;padding-top:10px;border-top:1px dashed var(--cpu-border-soft);color:var(--cpu-text-secondary);font-size:10px;line-height:1.6}.actions{display:flex;flex-direction:column;gap:7px}.actions .el-button{width:100%;margin:0}.matching-items{padding:20px}.matching-items>header{display:flex;align-items:flex-end;justify-content:space-between;gap:12px}.matching-items header span{color:var(--cpu-primary);font-size:10px;letter-spacing:.12em}.matching-items h2{margin:4px 0;font-size:18px}.matching-items header p{margin:0;color:var(--cpu-text-secondary);font-size:10px}.matching-items header a{color:var(--cpu-primary);font-size:11px}.matching-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-top:14px}.matching-grid article{overflow:hidden;border:1px solid var(--cpu-border-soft);border-radius:11px;cursor:pointer}.matching-grid article:hover{border-color:var(--cpu-primary)}.matching-cover{position:relative;display:grid;place-items:center;height:120px;overflow:hidden;background:var(--cpu-surface-soft);font-size:32px}.matching-cover img{width:100%;height:100%;object-fit:cover}.matching-cover b{position:absolute;right:7px;top:7px;padding:3px 7px;border-radius:10px;color:#fff;background:rgba(17,94,89,.9);font-size:9px}.matching-copy{padding:10px}.matching-copy>strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px}.matching-copy p{margin:5px 0;color:var(--cpu-text-secondary);font-size:9px}.matching-copy>div{display:flex;gap:3px;flex-wrap:wrap}.matching-copy span{padding:2px 5px;border-radius:8px;color:var(--cpu-primary);background:var(--cpu-primary-soft);font-size:8px}.responses{padding:20px}.responses>header{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}.responses header h2{margin-bottom:3px}.responses header p{margin:0;color:var(--cpu-text-secondary);font-size:10px}.responses article{display:flex;align-items:center;gap:12px;padding:12px 0;border-top:1px solid var(--cpu-border-soft)}.response-cover{display:grid;place-items:center;width:66px;height:60px;overflow:hidden;flex:0 0 auto;border-radius:9px;background:var(--cpu-surface-soft);font-size:24px}.response-cover img{width:100%;height:100%;object-fit:cover}.response-copy{min-width:0;flex:1}.response-copy>div{display:flex;align-items:center;gap:7px}.response-copy p{margin:5px 0;color:var(--cpu-text-secondary);font-size:11px}.response-copy small{color:var(--cpu-text-muted);font-size:9px}.response-price{display:flex;align-items:flex-end;flex-direction:column;gap:6px}.response-price strong{color:#ef4444;font-size:18px}.response-actions{display:flex;gap:5px}.response-mode{margin-bottom:18px}.two-cols{display:grid;grid-template-columns:1fr 1fr;gap:14px}.image-list{display:flex;flex-wrap:wrap;gap:8px}.image-list>div,.image-list label{position:relative;width:88px;height:88px;overflow:hidden;border-radius:9px;background:var(--cpu-surface-soft)}.image-list img{width:100%;height:100%;object-fit:cover}.image-list button{position:absolute;right:4px;top:4px;width:23px;height:23px;border:0;border-radius:50%;color:#fff;background:rgba(15,23,42,.65)}.image-list label{display:grid;place-items:center;border:1px dashed var(--cpu-border);color:var(--cpu-text-secondary);font-size:10px;cursor:pointer}.image-list input{display:none}@media(max-width:900px){.matching-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:760px){.wanted-card{padding:16px}.wanted-card>header{grid-template-columns:auto 1fr}.budget{grid-column:1/-1;text-align:left}.detail-grid{grid-template-columns:1fr}.facts dl{grid-template-columns:1fr}.matching-items{padding:15px}.matching-items>header{align-items:flex-start;flex-direction:column}.matching-grid{display:flex;overflow-x:auto;scroll-snap-type:x mandatory}.matching-grid article{min-width:76%;scroll-snap-align:start}.responses article{align-items:flex-start;flex-wrap:wrap}.response-copy{min-width:calc(100% - 80px)}.response-actions{width:100%;justify-content:flex-end}.two-cols{grid-template-columns:1fr}}
</style>
