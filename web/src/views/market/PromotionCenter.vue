<template>
  <div class="promotion-center">
    <header class="page-head">
      <div><span>KAOPU PROMOTION</span><h1>推广服务</h1><p>为自己的有效内容申请明确标注的展示服务。学生商品款仍由买卖双方线下结算。</p></div>
      <div><el-button @click="$router.push('/market/merchant/apply')">商户资料</el-button><el-button @click="load">刷新</el-button></div>
    </header>

    <el-alert :type="site.features.promotion ? 'info' : 'warning'" show-icon :closable="false" :title="site.features.promotion ? '当前只记录推广订单，由管理员人工核验并确认；不会跳转自动支付，也不会从商品成交金额中抽佣。' : '商业展示当前已暂停；历史订单与售后记录仍可查看，学生交易、求购和免费学习内容不受影响。'" />

    <section v-if="site.features.promotion" class="plan-section">
      <div class="section-head"><div><span>AVAILABLE PLANS</span><h2>可用方案</h2></div><small>价格和时长由后台配置，以当前页面显示为准</small></div>
      <div class="plan-grid" v-loading="loading">
        <article v-for="plan in plans" :key="plan.id" class="cpu-card">
          <PromotionLabel :label="plan.badgeLabel" :kind="kindFor(plan.type)" />
          <h3>{{ plan.name }}</h3><p>{{ plan.description }}</p>
          <div><strong>¥{{ plan.price }}</strong><span>/ {{ plan.durationDays }} 天</span><small>{{ plan.maxActive ? ` · 同时最多 ${plan.maxActive} 个展示位` : ' · 不设库存上限' }}</small></div>
          <el-button type="primary" plain :disabled="!targetOptions(plan).length" @click="openOrder(plan)">{{ targetOptions(plan).length ? '选择推广对象' : emptyTargetText(plan) }}</el-button>
        </article>
      </div>
    </section>

    <section class="merchant-entry cpu-card">
      <div><span>MERCHANT PROFILE</span><h2>合作商户主页</h2><p>商户资料和推广订单分开审核：先提交经营与服务信息，通过后再申请主页启用方案。</p></div>
      <div v-if="merchant"><el-tag :type="merchantStatusType(merchant.status)">{{ merchantStatusLabel(merchant.status) }}</el-tag><b>{{ merchant.name }}</b><small v-if="merchant.activeUntil">主页有效至 {{ formatDate(merchant.activeUntil) }}</small><small v-if="merchant.reviewDueAt">资料复核日期 {{ formatDate(merchant.reviewDueAt) }}</small></div>
      <el-button type="primary" @click="$router.push('/market/merchant/apply')">{{ merchant ? '编辑商户资料' : '申请商户主页' }}</el-button>
    </section>

    <section class="orders-section">
      <div class="section-head"><div><span>MY ORDERS</span><h2>推广订单</h2></div><small>曝光和点击按访客、推广位和自然日去重</small></div>
      <div class="order-list" v-loading="loading">
        <article v-for="order in orders" :key="order.id" class="cpu-card">
          <header><div><PromotionLabel :label="order.badgeLabel" :kind="kindFor(order.type)" /><b>{{ order.planName }}</b></div><el-tag :type="orderStatusType(order.status)">{{ orderStatusLabel(order.status) }}</el-tag></header>
          <h3>{{ targetTitle(order) }}</h3>
          <dl><div><dt>订单编号</dt><dd>{{ order.outTradeNo }}</dd></div><div><dt>推广费用</dt><dd>¥{{ order.amount }}</dd></div><div><dt>曝光</dt><dd>{{ order.impressionCount }}</dd></div><div><dt>点击</dt><dd>{{ order.clickCount }}（{{ order.ctr }}%）</dd></div><div v-if="order.type==='merchant_homepage'"><dt>归因咨询</dt><dd>{{ order.inquiriesAttributed }}</dd></div><div v-if="order.verifiedAmount"><dt>人工核验</dt><dd>{{ verificationMethodLabel(order.verificationMethod) }} · ¥{{ order.verifiedAmount }}</dd></div><div v-if="order.verificationReferenceMasked"><dt>核验凭证</dt><dd>{{ order.verificationReferenceMasked }}</dd></div></dl>
          <div v-if="order.adjustments?.length" class="adjustment-list"><b>售后与票据记录</b><article v-for="adjustment in order.adjustments" :key="adjustment.id"><span>{{ adjustmentTypeLabel(adjustment.type) }}<template v-if="adjustment.extensionDays"> · 延长 {{ adjustment.extensionDays }} 天</template><template v-if="adjustment.amountCents"> · ¥{{ adjustment.amount }}</template></span><small>{{ adjustment.note }}<template v-if="adjustment.referenceMasked"> · 凭证 {{ adjustment.referenceMasked }}</template></small><time>{{ formatTime(adjustment.createdAt) }}</time></article></div>
          <p v-if="order.adminNote">处理说明：{{ order.adminNote }}</p><p v-else-if="order.status === 'pending'">等待管理员核验并人工确认。</p>
          <footer><time>{{ formatTime(order.createdAt) }}</time><el-button v-if="order.status === 'pending'" link type="danger" @click="cancelOrder(order)">取消申请</el-button></footer>
        </article>
        <el-empty v-if="!loading && !orders.length" description="还没有推广订单" />
      </div>
    </section>

    <el-dialog v-model="orderOpen" title="创建推广订单" width="500px">
      <template v-if="selectedPlan">
        <div class="selected-plan"><PromotionLabel :label="selectedPlan.badgeLabel" :kind="kindFor(selectedPlan.type)" /><div><b>{{ selectedPlan.name }}</b><span>¥{{ selectedPlan.price }} · {{ selectedPlan.durationDays }} 天</span></div></div>
        <el-form label-position="top">
          <el-form-item label="推广对象" required><el-select v-model="orderForm.targetId" style="width:100%" placeholder="请选择"><el-option v-for="option in targetOptions(selectedPlan)" :key="option.id" :label="option.title" :value="option.id" /></el-select></el-form-item>
          <el-form-item label="申请说明"><el-input v-model="orderForm.note" type="textarea" :rows="3" maxlength="500" show-word-limit placeholder="可补充期望展示时间等信息" /></el-form-item>
        </el-form>
        <el-alert type="warning" :closable="false" title="提交后只生成待确认记录，不会发起商品支付或自动扣款。" />
      </template>
      <template #footer><el-button @click="orderOpen=false">取消</el-button><el-button type="primary" :loading="submitting" @click="submitOrder">提交申请</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { marketApi, type MarketItem, type MerchantProfile, type PromotionOrder, type PromotionPlan, type WantedPost } from "@/api/market";
import PromotionLabel from "@/components/market/PromotionLabel.vue";
import { useSiteStore } from "@/stores/site";

const site = useSiteStore();
const plans = ref<PromotionPlan[]>([]), orders = ref<PromotionOrder[]>([]), items = ref<MarketItem[]>([]), wanted = ref<WantedPost[]>([]), merchant = ref<MerchantProfile | null>(null);
const loading = ref(false), submitting = ref(false), orderOpen = ref(false), selectedPlan = ref<PromotionPlan | null>(null);
const orderForm = reactive({ targetId: 0, note: "" });
onMounted(load);

async function load() {
  loading.value = true;
  try {
    const [nextPlans, nextOrders, mine, nextMerchant] = await Promise.all([
      marketApi.promotionPlans({ suppressErrorMessage: true }), marketApi.promotionOrders({ page: 1, size: 50 }, { suppressErrorMessage: true }), marketApi.mine({ suppressErrorMessage: true }), marketApi.myMerchantProfile({ suppressErrorMessage: true }),
    ]);
    plans.value = nextPlans; orders.value = nextOrders.list; items.value = mine.selling.filter((row) => row.status === "active" && row.deliveryType === "physical" && row.visibility === "public"); wanted.value = mine.wantedPosts.filter((row) => ["active", "responded"].includes(row.status)); merchant.value = nextMerchant;
  } finally { loading.value = false; }
}
function targetOptions(plan: PromotionPlan) { if (plan.targetType === "market_item") return items.value.map((row) => ({ id: row.id, title: row.title })); if (plan.targetType === "wanted_post") return wanted.value.map((row) => ({ id: row.id, title: row.title })); return merchant.value?.status === "approved" ? [{ id: merchant.value.id, title: merchant.value.name }] : []; }
function emptyTargetText(plan: PromotionPlan) { return plan.targetType === "merchant_profile" ? "商户资料待审核" : plan.targetType === "wanted_post" ? "暂无有效求购" : "暂无在售商品"; }
function openOrder(plan: PromotionPlan) { selectedPlan.value = plan; orderForm.targetId = targetOptions(plan)[0]?.id || 0; orderForm.note = ""; orderOpen.value = true; }
async function submitOrder() { if (!selectedPlan.value || !orderForm.targetId) return ElMessage.warning("请选择推广对象"); submitting.value = true; try { await marketApi.createPromotionOrder({ planCode: selectedPlan.value.code, targetId: orderForm.targetId, note: orderForm.note }); orderOpen.value = false; ElMessage.success("推广申请已提交，等待管理员人工确认"); await load(); } finally { submitting.value = false; } }
async function cancelOrder(order: PromotionOrder) { await ElMessageBox.confirm("确认取消这条待确认推广申请？", "取消申请", { type: "warning" }); await marketApi.cancelPromotionOrder(order.id); ElMessage.success("推广申请已取消"); await load(); }
function kindFor(type: PromotionPlan["type"]) { return ({ listing_pin: "pin", wanted_urgent: "urgent", home_featured: "home", merchant_homepage: "merchant" } as const)[type]; }
function targetTitle(order: PromotionOrder) { return order.marketItem?.title || order.wantedPost?.title || order.merchantProfile?.name || "推广对象已不可用"; }
function orderStatusLabel(status: PromotionOrder["status"]) { return ({ pending: "待人工确认", confirmed: "推广中", rejected: "未通过", cancelled: "已取消", expired: "已到期" } as const)[status]; }
function orderStatusType(status: PromotionOrder["status"]) { return status === "confirmed" ? "success" : status === "pending" ? "warning" : status === "rejected" ? "danger" : "info"; }
function verificationMethodLabel(value: string) { return ({ alipay: "支付宝", wechat: "微信支付", bank: "银行转账", cash: "现金", other: "其他", manual_admin: "管理员人工确认" } as Record<string, string>)[value] || "人工核验"; }
function adjustmentTypeLabel(value: string) { return ({ service_extension: "服务延期", refund_record: "退款留痕（不自动退款）", compensation_record: "补偿留痕", invoice_record: "票据留痕（不自动开票）", complaint_record: "投诉留痕" } as Record<string, string>)[value] || "人工记录"; }
function merchantStatusLabel(status: MerchantProfile["status"]) { return ({ reviewing: "审核中", approved: "审核通过", rejected: "未通过", suspended: "已暂停" } as const)[status]; }
function merchantStatusType(status: MerchantProfile["status"]) { return status === "approved" ? "success" : status === "reviewing" ? "warning" : "danger"; }
function formatTime(value: string) { return new Date(value).toLocaleString("zh-CN"); }
function formatDate(value: string) { return new Date(value).toLocaleDateString("zh-CN"); }
</script>

<style scoped>
.promotion-center{max-width:1180px;margin:0 auto;display:flex;flex-direction:column;gap:20px}.page-head,.section-head{display:flex;align-items:flex-end;justify-content:space-between;gap:20px}.page-head>div:last-child{display:flex;gap:8px}.page-head span,.section-head span,.merchant-entry>div:first-child>span{color:var(--cpu-primary);font-size:9px;font-weight:800;letter-spacing:.16em}.page-head h1{margin:6px 0;font-size:30px}.page-head p,.section-head small,.merchant-entry p{margin:0;color:var(--cpu-text-secondary);font-size:11px}.section-head h2{margin:4px 0 0}.plan-grid{display:grid;grid-template-columns:repeat(4,1fr);align-items:stretch;gap:13px;margin-top:12px}.plan-grid>article{display:flex;align-items:flex-start;align-self:stretch;box-sizing:border-box;flex-direction:column;margin:0;padding:18px}.plan-grid h3{margin:12px 0 6px}.plan-grid p{min-height:48px;margin:0;color:var(--cpu-text-secondary);font-size:10px;line-height:1.6}.plan-grid article>div{margin:16px 0}.plan-grid strong{font-size:25px}.plan-grid article>div span,.plan-grid article>div small{color:var(--cpu-text-secondary);font-size:10px}.plan-grid .el-button{width:100%;margin-top:auto}.merchant-entry{display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:20px;padding:20px}.merchant-entry h2{margin:5px 0}.merchant-entry>div:nth-child(2){display:flex;align-items:flex-end;flex-direction:column;gap:4px}.merchant-entry small{color:var(--cpu-text-secondary)}.order-list{display:grid;grid-template-columns:repeat(2,1fr);align-items:stretch;gap:12px;margin-top:12px}.order-list>article{box-sizing:border-box;align-self:stretch;margin:0;padding:16px}.order-list header,.order-list header>div,.order-list footer{display:flex;align-items:center;justify-content:space-between;gap:8px}.order-list header>div{justify-content:flex-start}.order-list h3{margin:13px 0}.order-list dl{display:grid;grid-template-columns:1fr 1fr;gap:7px}.order-list dl>div{padding:8px;border-radius:7px;background:var(--cpu-surface-soft)}.order-list dt{color:var(--cpu-text-secondary);font-size:8px}.order-list dd{margin:3px 0 0;font-size:10px;font-weight:700}.order-list p{color:var(--cpu-text-secondary);font-size:10px}.adjustment-list{display:grid;gap:6px;margin-top:10px;padding:10px;border:1px dashed var(--cpu-border-soft);border-radius:9px}.adjustment-list>b{font-size:10px}.adjustment-list article{display:grid;grid-template-columns:1fr auto;gap:3px 8px;padding:7px;background:var(--cpu-surface-soft);border-radius:7px}.adjustment-list span{font-size:9px;font-weight:700}.adjustment-list small{grid-column:1/-1;color:var(--cpu-text-secondary);font-size:8px}.adjustment-list time{font-size:8px}.order-list footer{margin-top:10px;padding-top:9px;border-top:1px dashed var(--cpu-border-soft)}.order-list time{color:var(--cpu-text-muted);font-size:8px}.selected-plan{display:flex;align-items:center;gap:10px;margin-bottom:16px;padding:12px;border-radius:9px;background:var(--cpu-surface-soft)}.selected-plan div{display:flex;flex-direction:column}.selected-plan span{color:var(--cpu-text-secondary);font-size:10px}@media(max-width:900px){.plan-grid{grid-template-columns:repeat(2,1fr)}}@media(max-width:650px){.page-head,.section-head{align-items:flex-start;flex-direction:column}.page-head>div:last-child{width:100%}.page-head .el-button{flex:1}.plan-grid,.order-list{grid-template-columns:1fr}.merchant-entry{grid-template-columns:1fr}.merchant-entry>div:nth-child(2){align-items:flex-start}.merchant-entry .el-button{width:100%}}
</style>
