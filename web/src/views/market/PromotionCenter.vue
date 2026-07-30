<template>
  <div class="promotion-center">
    <header class="page-head">
      <div><span>KAOPU PROMOTION</span><h1>{{ isEnglish ? "Promotion Services" : "推广服务" }}</h1><p>{{ isEnglish ? "Request clearly labelled exposure for your active content. Item payments remain a direct arrangement between students." : "为自己的有效内容申请明确标注的展示服务。学生商品款仍由买卖双方线下结算。" }}</p></div>
      <div><el-button @click="load">{{ isEnglish ? "Refresh" : "刷新" }}</el-button></div>
    </header>

    <el-alert :type="site.features.promotion ? 'info' : 'warning'" show-icon :closable="false" :title="site.features.promotion ? (isEnglish ? 'Promotion fees are paid by QR code and manually verified per order. The system does not auto-charge or take a commission from item trades.' : '推广费用通过收款码支付并由管理员逐单人工核验；系统不会自动扣款，也不会从商品成交金额中抽佣。') : (isEnglish ? 'Commercial exposure is paused. Previous orders remain available, while student trades, wanted requests, and paid materials are unaffected.' : '商业展示当前已暂停；历史订单与售后记录仍可查看，学生交易、求购和付费学习资料不受影响。')" />

    <section v-if="pointMode" class="point-promotion cpu-card" v-loading="pointLoading">
      <div class="point-title">
        <div><span>POINT PROMOTION</span><h2>{{ isEnglish ? "Points Promotion" : "积分推流" }}</h2></div>
        <el-tag type="warning" effect="plain">{{ isEnglish ? "In design" : "机制设计中" }}</el-tag>
      </div>
      <template v-if="pointContext">
        <div class="point-target">
          <div><small>{{ isEnglish ? "Promotion target" : "本次推广对象" }}</small><b>{{ pointContext.target.title }}</b><span>{{ pointTargetLabel(pointContext.target.type) }} · {{ pointContext.target.status }}</span></div>
          <el-button plain @click="$router.push(pointContext.target.href)">{{ isEnglish ? "View content" : "查看内容" }}</el-button>
        </div>
        <div class="point-balance"><span>{{ isEnglish ? "Current points" : "当前积分" }}</span><strong>{{ pointContext.pointBalance }}</strong><small>{{ isEnglish ? "No points are deducted on this page" : "不会在当前页面自动扣除" }}</small></div>
      </template>
      <template v-else>
        <p class="point-empty">{{ isEnglish ? "Open Points Promotion from one of your posts, active listings, or wanted requests so the target is linked automatically." : "请从本人帖子、在售商品或有效求购上的“积分推流”入口进入，系统会自动带入推广对象。" }}</p>
        <div class="point-links"><el-button @click="$router.push('/profile')">{{ isEnglish ? "My posts" : "我的帖子" }}</el-button><el-button @click="$router.push('/market/mine?tab=selling')">{{ isEnglish ? "My listings" : "我的发布" }}</el-button><el-button @click="$router.push('/market/mine?tab=wanted')">{{ isEnglish ? "Wanted requests" : "求购需求" }}</el-button></div>
      </template>
      <el-steps :active="0" finish-status="success" simple>
        <el-step :title="isEnglish ? 'Select target' : '选择推广对象'" />
        <el-step :title="isEnglish ? 'Set points and duration' : '配置积分与时长'" />
        <el-step :title="isEnglish ? 'Confirm and activate' : '确认并生效'" />
      </el-steps>
      <el-alert type="info" :closable="false" show-icon :title="isEnglish ? 'The points-promotion mechanism is being designed. This version provides the unified entry and API without deducting points.' : (pointConfig?.message || '积分推流机制正在设计中，当前只建设统一入口和接口，不会扣除积分。')" />
      <div class="point-actions"><el-button type="primary" disabled>{{ isEnglish ? "Available after launch" : "机制开放后可配置" }}</el-button></div>
    </section>

    <section v-if="site.features.promotion" class="plan-section">
      <div class="section-head"><div><span>AVAILABLE PLANS</span><h2>{{ isEnglish ? "Available plans" : "可用方案" }}</h2></div><small>{{ isEnglish ? "Prices and durations are configured by administrators; this page is authoritative" : "价格和时长由后台配置，以当前页面显示为准" }}</small></div>
      <div class="plan-grid" v-loading="loading">
        <article v-for="plan in plans" :key="plan.id" class="cpu-card">
          <PromotionLabel :label="plan.badgeLabel" :kind="kindFor(plan.type)" />
          <h3>{{ plan.name }}</h3><p>{{ plan.description }}</p>
          <div><strong>¥{{ plan.price }}</strong><span>/ {{ plan.durationDays }} {{ isEnglish ? "days" : "天" }}</span><small>{{ plan.maxActive ? (isEnglish ? ` · Up to ${plan.maxActive} concurrent placements` : ` · 同时最多 ${plan.maxActive} 个展示位`) : (isEnglish ? ' · No inventory limit' : ' · 不设库存上限') }}</small></div>
          <el-button type="primary" plain :disabled="!targetOptions(plan).length" @click="openOrder(plan)">{{ targetOptions(plan).length ? (isEnglish ? 'Select target' : '选择推广对象') : emptyTargetText(plan) }}</el-button>
        </article>
      </div>
    </section>

    <section class="orders-section">
      <div class="section-head"><div><span>MY ORDERS</span><h2>{{ isEnglish ? "Promotion orders" : "推广订单" }}</h2></div><small>{{ isEnglish ? "Impressions and clicks are deduplicated by visitor, placement, and calendar day" : "曝光和点击按访客、推广位和自然日去重" }}</small></div>
      <div class="order-list" v-loading="loading">
        <article v-for="order in orders" :key="order.id" class="cpu-card">
          <header><div><PromotionLabel :label="order.badgeLabel" :kind="kindFor(order.type)" /><b>{{ order.planName }}</b></div><el-tag :type="orderStatusType(order.status)">{{ orderStatusLabel(order.status) }}</el-tag></header>
          <h3>{{ targetTitle(order) }}</h3>
          <dl><div><dt>{{ isEnglish ? "Order ID" : "订单编号" }}</dt><dd>{{ order.outTradeNo }}</dd></div><div><dt>{{ isEnglish ? "Fee" : "推广费用" }}</dt><dd>¥{{ order.amount }}</dd></div><div><dt>{{ isEnglish ? "Impressions" : "曝光" }}</dt><dd>{{ order.impressionCount }}</dd></div><div><dt>{{ isEnglish ? "Clicks" : "点击" }}</dt><dd>{{ order.clickCount }}（{{ order.ctr }}%）</dd></div><div v-if="order.verifiedAmount"><dt>{{ isEnglish ? "Manual verification" : "人工核验" }}</dt><dd>{{ verificationMethodLabel(order.verificationMethod) }} · ¥{{ order.verifiedAmount }}</dd></div><div v-if="order.verificationReferenceMasked"><dt>{{ isEnglish ? "Verification reference" : "核验凭证" }}</dt><dd>{{ order.verificationReferenceMasked }}</dd></div></dl>
          <div v-if="order.adjustments?.length" class="adjustment-list"><b>{{ isEnglish ? "Support and receipt records" : "售后与票据记录" }}</b><article v-for="adjustment in order.adjustments" :key="adjustment.id"><span>{{ adjustmentTypeLabel(adjustment.type) }}<template v-if="adjustment.extensionDays"> · {{ isEnglish ? "Extended" : "延长" }} {{ adjustment.extensionDays }} {{ isEnglish ? "days" : "天" }}</template><template v-if="adjustment.amountCents"> · ¥{{ adjustment.amount }}</template></span><small>{{ adjustment.note }}<template v-if="adjustment.referenceMasked"> · {{ isEnglish ? "Reference" : "凭证" }} {{ adjustment.referenceMasked }}</template></small><time>{{ formatTime(adjustment.createdAt) }}</time></article></div>
          <p v-if="order.adminNote">{{ isEnglish ? "Handling note:" : "处理说明：" }}{{ order.adminNote }}</p>
          <p v-else-if="order.status === 'waitlisted'">{{ isEnglish ? "Promotion capacity is full. This order is waitlisted and you will receive an in-app notification when space opens." : "目前推广服务已满，已进入候补队列；空位释放后会发送站内通知。" }}</p>
          <p v-else-if="order.status === 'pending' && order.paymentSubmittedAt">{{ isEnglish ? "Payment confirmation submitted. An administrator will verify the amount, transaction, and four-digit key." : "付款确认已提交，等待管理员核验金额、流水和四位秘钥。" }}</p>
          <p v-else-if="order.status === 'pending'">{{ isEnglish ? "Your placement is reserved. Pay by QR code and enter the four-digit key before it expires." : "位置已保留，请在有效时间内扫码付款并回填四位秘钥。" }}</p>
          <el-alert v-if="order.status === 'rejected' && order.paymentSubmittedAt" type="warning" :closable="false" show-icon :title="isEnglish ? 'Payment was reported for this rejected order. Refunds are not automatic; contact an administrator to confirm the refund.' : '该订单已确认过付款但未通过，系统不会自动退款；请私下联系管理员确认退款。'" />
          <footer>
            <time>{{ formatTime(order.createdAt) }}</time>
            <div>
              <el-button v-if="order.status === 'pending'" link type="primary" @click="openPayment(order)">{{ order.paymentSubmittedAt ? (isEnglish ? 'View payment status' : '查看付款状态') : (isEnglish ? 'Pay now' : '立即付款') }}</el-button>
              <el-button v-if="['pending','waitlisted'].includes(order.status)" link type="danger" @click="cancelOrder(order)">{{ isEnglish ? "Cancel request" : "取消申请" }}</el-button>
            </div>
          </footer>
        </article>
        <el-empty v-if="!loading && !orders.length" :description="isEnglish ? 'No promotion orders yet' : '还没有推广订单'" />
      </div>
    </section>

    <el-dialog v-model="orderOpen" :title="isEnglish ? 'Create promotion order' : '创建推广订单'" width="500px">
      <template v-if="selectedPlan">
        <div class="selected-plan"><PromotionLabel :label="selectedPlan.badgeLabel" :kind="kindFor(selectedPlan.type)" /><div><b>{{ selectedPlan.name }}</b><span>¥{{ selectedPlan.price }} · {{ selectedPlan.durationDays }} {{ isEnglish ? "days" : "天" }}</span></div></div>
        <el-form label-position="top">
          <el-form-item :label="isEnglish ? 'Promotion target' : '推广对象'" required><el-select v-model="orderForm.targetId" style="width:100%" :placeholder="isEnglish ? 'Select one' : '请选择'"><el-option v-for="option in targetOptions(selectedPlan)" :key="option.id" :label="option.title" :value="option.id" /></el-select></el-form-item>
          <el-form-item :label="isEnglish ? 'Request note' : '申请说明'"><el-input v-model="orderForm.note" type="textarea" :rows="3" maxlength="500" show-word-limit :placeholder="isEnglish ? 'Optionally add preferred display dates or other context' : '可补充期望展示时间等信息'" /></el-form-item>
        </el-form>
        <el-alert type="warning" :closable="false" :title="isEnglish ? 'If capacity is available, the collection QR code and four-digit payment key appear after submission. If full, the request is waitlisted without payment.' : '有空位时提交后将显示收款码和四位付款秘钥；满位时只进入候补，不会要求付款。'" />
      </template>
      <template #footer><el-button @click="orderOpen=false">{{ isEnglish ? "Cancel" : "取消" }}</el-button><el-button type="primary" :loading="submitting" @click="submitOrder">{{ isEnglish ? "Submit request" : "提交申请" }}</el-button></template>
    </el-dialog>
    <PromotionPaymentDialog v-model="paymentOpen" :order="paymentOrder" @submitted="handlePaymentSubmitted" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useRoute } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import { marketApi, type MarketItem, type PointPromotionConfig, type PointPromotionContext, type PointPromotionTargetType, type PromotionOrder, type PromotionPlan, type WantedPost } from "@/api/market";
import PromotionLabel from "@/components/market/PromotionLabel.vue";
import PromotionPaymentDialog from "@/components/market/PromotionPaymentDialog.vue";
import { useSiteStore } from "@/stores/site";
import { useLocale } from "@/i18n";

const site = useSiteStore();
const route = useRoute();
const { isEnglish, locale } = useLocale();
const plans = ref<PromotionPlan[]>([]), orders = ref<PromotionOrder[]>([]), items = ref<MarketItem[]>([]), wanted = ref<WantedPost[]>([]);
const loading = ref(false), submitting = ref(false), orderOpen = ref(false), selectedPlan = ref<PromotionPlan | null>(null);
const paymentOpen = ref(false), paymentOrder = ref<PromotionOrder | null>(null);
const orderForm = reactive({ targetId: 0, note: "" });
const pointConfig = ref<PointPromotionConfig | null>(null), pointContext = ref<PointPromotionContext | null>(null), pointLoading = ref(false);
const pointMode = computed(() => String(route.query.mode || "") === "points");
onMounted(load);

async function load() {
  loading.value = true;
  try {
    const [nextPlans, nextOrders, mine] = await Promise.all([
      marketApi.promotionPlans({ scope: "content" }, { suppressErrorMessage: true }), marketApi.promotionOrders({ page: 1, size: 50, scope: "content" }, { suppressErrorMessage: true }), marketApi.mine({ suppressErrorMessage: true }),
    ]);
    plans.value = nextPlans; orders.value = nextOrders.list; items.value = mine.selling.filter((row) => row.status === "active" && row.deliveryType === "physical" && row.visibility === "public"); wanted.value = mine.wantedPosts.filter((row) => ["active", "responded"].includes(row.status));
    if (pointMode.value) await loadPointPromotion();
  } finally { loading.value = false; }
}
async function loadPointPromotion() {
  pointLoading.value = true;
  try {
    pointConfig.value = await marketApi.pointPromotionConfig({ suppressErrorMessage: true });
    const targetType = String(route.query.targetType || "") as PointPromotionTargetType;
    const targetId = Number(route.query.targetId);
    if (["topic", "market_item", "wanted_post"].includes(targetType) && Number.isInteger(targetId) && targetId > 0) {
      pointContext.value = await marketApi.pointPromotionContext(targetType, targetId, { suppressErrorMessage: true });
    } else {
      pointContext.value = null;
    }
  } finally { pointLoading.value = false; }
}
function targetOptions(plan: PromotionPlan) { if (plan.targetType === "market_item") return items.value.map((row) => ({ id: row.id, title: row.title })); if (plan.targetType === "wanted_post") return wanted.value.map((row) => ({ id: row.id, title: row.title })); return []; }
function emptyTargetText(plan: PromotionPlan) { return plan.targetType === "wanted_post" ? (isEnglish.value ? "No active wanted requests" : "暂无有效求购") : (isEnglish.value ? "No active listings" : "暂无在售商品"); }
function openOrder(plan: PromotionPlan) { selectedPlan.value = plan; orderForm.targetId = targetOptions(plan)[0]?.id || 0; orderForm.note = ""; orderOpen.value = true; }
async function submitOrder() {
  if (!selectedPlan.value || !orderForm.targetId) return ElMessage.warning(isEnglish.value ? "Select a promotion target" : "请选择推广对象");
  submitting.value = true;
  try {
    const order = await marketApi.createPromotionOrder({ planCode: selectedPlan.value.code, targetId: orderForm.targetId, note: orderForm.note });
    orderOpen.value = false;
    if (order.status === "waitlisted") ElMessage.warning(isEnglish.value ? "Promotion capacity is full. Your request is waitlisted." : "目前推广服务已满，申请已进入候补队列");
    else openPayment(order);
    await load();
  } finally { submitting.value = false; }
}
function openPayment(order: PromotionOrder) { paymentOrder.value = order; paymentOpen.value = true; }
async function handlePaymentSubmitted(order: PromotionOrder) { paymentOrder.value = order; await load(); }
async function cancelOrder(order: PromotionOrder) { await ElMessageBox.confirm(isEnglish.value ? "Cancel this promotion request?" : "确认取消这条推广申请？", isEnglish.value ? "Cancel request" : "取消申请", { type: "warning" }); await marketApi.cancelPromotionOrder(order.id); ElMessage.success(isEnglish.value ? "Promotion request cancelled" : "推广申请已取消"); await load(); }
function kindFor(type: PromotionPlan["type"]) { return ({ listing_pin: "pin", wanted_urgent: "urgent", home_featured: "home", merchant_homepage: "merchant" } as const)[type]; }
function targetTitle(order: PromotionOrder) { return order.marketItem?.title || order.wantedPost?.title || (isEnglish.value ? "Promotion target unavailable" : "推广对象已不可用"); }
function orderStatusLabel(status: PromotionOrder["status"]) { const labels=isEnglish.value?{waitlisted:"Waitlisted",pending:"Payment / verification pending",confirmed:"Active",rejected:"Rejected",cancelled:"Cancelled",expired:"Expired"}:{ waitlisted: "候补中", pending: "待付款/核验", confirmed: "推广中", rejected: "未通过", cancelled: "已取消", expired: "已到期" };return labels[status]; }
function orderStatusType(status: PromotionOrder["status"]) { return status === "confirmed" ? "success" : ["pending", "waitlisted"].includes(status) ? "warning" : status === "rejected" ? "danger" : "info"; }
function verificationMethodLabel(value: string) { const labels=isEnglish.value?{alipay:"Alipay",wechat:"WeChat Pay",bank:"Bank transfer",cash:"Cash",other:"Other",manual_admin:"Manual administrator confirmation"}:{ alipay: "支付宝", wechat: "微信支付", bank: "银行转账", cash: "现金", other: "其他", manual_admin: "管理员人工确认" };return (labels as Record<string,string>)[value]||(isEnglish.value?"Manual verification":"人工核验"); }
function adjustmentTypeLabel(value: string) { const labels=isEnglish.value?{service_extension:"Service extension",refund_record:"Refund record (not automatic)",compensation_record:"Compensation record",invoice_record:"Receipt record (not automatically issued)",complaint_record:"Complaint record"}:{ service_extension: "服务延期", refund_record: "退款留痕（不自动退款）", compensation_record: "补偿留痕", invoice_record: "票据留痕（不自动开票）", complaint_record: "投诉留痕" };return (labels as Record<string,string>)[value]||(isEnglish.value?"Manual record":"人工记录"); }
function formatTime(value: string) { return new Date(value).toLocaleString(locale.value); }
function pointTargetLabel(value: PointPromotionTargetType) { return isEnglish.value?({topic:"Post",market_item:"Item",wanted_post:"Wanted request"} as const)[value]:({ topic: "帖子", market_item: "商品", wanted_post: "求购" } as const)[value]; }
</script>

<style scoped>
.point-promotion{display:grid;gap:16px}.point-title,.point-target{display:flex;align-items:center;justify-content:space-between;gap:16px}.point-title span{color:var(--cpu-primary);font-size:9px;font-weight:800;letter-spacing:.16em}.point-title h2{margin:4px 0}.point-target{padding:14px;border-radius:12px;background:var(--cpu-surface-soft)}.point-target>div{display:flex;min-width:0;flex-direction:column;gap:4px}.point-target small,.point-target span,.point-empty{color:var(--cpu-text-secondary);font-size:11px}.point-target b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.point-balance{display:flex;align-items:baseline;gap:10px}.point-balance strong{color:var(--cpu-primary);font-size:32px}.point-balance small{color:var(--cpu-text-secondary)}.point-links,.point-actions{display:flex;gap:8px}.point-actions{justify-content:flex-end}
.promotion-center{max-width:1180px;margin:0 auto;display:flex;flex-direction:column;gap:20px}.page-head,.section-head{display:flex;align-items:flex-end;justify-content:space-between;gap:20px}.page-head>div:last-child{display:flex;gap:8px}.page-head span,.section-head span{color:var(--cpu-primary);font-size:9px;font-weight:800;letter-spacing:.16em}.page-head h1{margin:6px 0;font-size:30px}.page-head p,.section-head small{margin:0;color:var(--cpu-text-secondary);font-size:11px}.section-head h2{margin:4px 0 0}.plan-grid{display:grid;grid-template-columns:repeat(3,1fr);align-items:stretch;gap:13px;margin-top:12px}.plan-grid>article{display:flex;align-items:flex-start;align-self:stretch;box-sizing:border-box;flex-direction:column;margin:0;padding:18px}.plan-grid h3{margin:12px 0 6px}.plan-grid p{min-height:48px;margin:0;color:var(--cpu-text-secondary);font-size:10px;line-height:1.6}.plan-grid article>div{margin:16px 0}.plan-grid strong{font-size:25px}.plan-grid article>div span,.plan-grid article>div small{color:var(--cpu-text-secondary);font-size:10px}.plan-grid .el-button{width:100%;margin-top:auto}.order-list{display:grid;grid-template-columns:repeat(2,1fr);align-items:stretch;gap:12px;margin-top:12px}.order-list>article{box-sizing:border-box;align-self:stretch;margin:0;padding:16px}.order-list header,.order-list header>div,.order-list footer{display:flex;align-items:center;justify-content:space-between;gap:8px}.order-list header>div{justify-content:flex-start}.order-list h3{margin:13px 0}.order-list dl{display:grid;grid-template-columns:1fr 1fr;gap:7px}.order-list dl>div{padding:8px;border-radius:7px;background:var(--cpu-surface-soft)}.order-list dt{color:var(--cpu-text-secondary);font-size:8px}.order-list dd{margin:3px 0 0;font-size:10px;font-weight:700}.order-list p{color:var(--cpu-text-secondary);font-size:10px}.adjustment-list{display:grid;gap:6px;margin-top:10px;padding:10px;border:1px dashed var(--cpu-border-soft);border-radius:9px}.adjustment-list>b{font-size:10px}.adjustment-list article{display:grid;grid-template-columns:1fr auto;gap:3px 8px;padding:7px;background:var(--cpu-surface-soft);border-radius:7px}.adjustment-list span{font-size:9px;font-weight:700}.adjustment-list small{grid-column:1/-1;color:var(--cpu-text-secondary);font-size:8px}.adjustment-list time{font-size:8px}.order-list footer{margin-top:10px;padding-top:9px;border-top:1px dashed var(--cpu-border-soft)}.order-list time{color:var(--cpu-text-muted);font-size:8px}.selected-plan{display:flex;align-items:center;gap:10px;margin-bottom:16px;padding:12px;border-radius:9px;background:var(--cpu-surface-soft)}.selected-plan div{display:flex;flex-direction:column}.selected-plan span{color:var(--cpu-text-secondary);font-size:10px}@media(max-width:900px){.plan-grid{grid-template-columns:repeat(2,1fr)}}@media(max-width:650px){.page-head,.section-head{align-items:flex-start;flex-direction:column}.page-head>div:last-child{width:100%}.page-head .el-button{flex:1}.plan-grid,.order-list{grid-template-columns:1fr}}
</style>
