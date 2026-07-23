<template>
  <div class="merchant-apply">
    <header class="page-head">
      <div><span>BECOME A MERCHANT</span><h1>成为商户</h1><p>商户资料、审核状态、主页启用和商户订单统一在这里管理。</p></div>
      <div class="head-actions"><el-button @click="$router.push('/market/merchants')">浏览已入驻商户</el-button><el-button @click="$router.push('/market')">返回市集</el-button></div>
    </header>

    <el-alert v-if="profile" :type="statusType(profile.status)" show-icon :closable="false" :title="statusCopy" />

    <el-form class="profile-form cpu-card" label-position="top" v-loading="loading">
      <section><h2>主页信息</h2><div class="two-cols"><el-form-item label="商户或服务名称" required><el-input v-model="form.name" maxlength="80" /></el-form-item><el-form-item label="主页地址" required><el-input v-model="form.slug" maxlength="40"><template #prepend>/market/merchant/</template></el-input></el-form-item></div><div class="two-cols"><el-form-item label="服务分类" required><el-select v-model="form.category" filterable allow-create default-first-option style="width:100%"><el-option v-for="category in categories" :key="category" :label="category" :value="category" /></el-select></el-form-item><el-form-item label="服务范围" required><el-input v-model="form.serviceArea" maxlength="200" placeholder="例如：南北校区，可上门" /></el-form-item></div><el-form-item label="服务介绍" required><el-input v-model="form.description" type="textarea" :rows="7" maxlength="5000" show-word-limit placeholder="说明服务项目、流程、资质或经营信息，不要伪造评价" /></el-form-item></section>
      <section><h2>价格与优惠</h2><div class="two-cols"><el-form-item label="价格范围" required><el-input v-model="form.priceRange" maxlength="200" placeholder="例如：打印 0.2 元/页起，以现场确认项目为准" /></el-form-item><el-form-item label="学生优惠"><el-input v-model="form.studentDiscount" maxlength="300" placeholder="没有可留空" /></el-form-item></div></section>
      <section><h2>展示图片</h2><p class="section-note">最多 9 张，建议使用真实门店、设备或服务场景图片。</p><div class="image-grid"><div v-for="(image,index) in form.images" :key="image" class="image-cell"><img :src="image" alt="商户图片" /><button type="button" @click="form.images.splice(index,1)">×</button></div><label v-if="form.images.length<9" class="upload-cell" :class="{disabled:uploading}"><input type="file" accept="image/*" multiple :disabled="uploading" @change="uploadImages" /><span>{{ uploading ? `${uploadProgress}%` : '+' }}</span><b>{{ uploading ? '上传中' : '添加图片' }}</b></label></div></section>
      <section><h2>业务联系方式</h2><p class="section-note">联系方式加密保存；公开页只显示脱敏值，已登录并验证校园身份的同学主动咨询后才能查看。{{ profile?.contactValueMasked ? `当前：${profile.contactValueMasked}` : '' }}</p><div class="two-cols"><el-form-item label="联系类型" required><el-select v-model="form.contactMethod" style="width:100%"><el-option label="微信" value="wechat" /><el-option label="QQ" value="qq" /><el-option label="电话" value="phone" /><el-option label="邮箱" value="email" /><el-option label="网站" value="website" /><el-option label="其他" value="other" /></el-select></el-form-item><el-form-item label="联系方式" required><el-input v-model="form.contactValue" maxlength="300" :placeholder="profile ? '为保护隐私，编辑时请重新填写' : '填写公开业务联系方式'" /></el-form-item></div></section>
      <el-alert type="warning" :closable="false" show-icon title="禁止发布代写代考、违规资料、贷款套现、账号交易等内容；所有商业展示都会明确标注“合作商户”或“推广”。" />
      <div class="form-actions"><el-button @click="$router.push('/market')">取消</el-button><el-button type="primary" :loading="submitting" @click="submit">提交审核</el-button></div>
    </el-form>

    <section class="merchant-service">
      <div class="section-head"><div><span>MERCHANT HOMEPAGE</span><h2>商户主页服务</h2><p>资料审核与主页启用订单分开处理，订单仍由管理员人工核验确认。</p></div><el-button v-if="profile" @click="$router.push(`/market/merchant/${profile.slug}`)">查看我的主页</el-button></div>
      <template v-if="profile">
        <article v-if="merchantPlan" class="service-plan cpu-card">
          <div><PromotionLabel :label="merchantPlan.badgeLabel" kind="merchant" /><h3>{{ merchantPlan.name }}</h3><p>{{ merchantPlan.description }}</p></div>
          <div class="plan-price"><strong>¥{{ merchantPlan.price }}</strong><span>/ {{ merchantPlan.durationDays }} 天</span><small v-if="profile.activeUntil">当前主页有效至 {{ formatDate(profile.activeUntil) }}</small></div>
          <el-button type="primary" :disabled="profile.status !== 'approved' || Boolean(pendingOrder)" :loading="ordering" @click="applyHomepage">{{ homepageActionLabel }}</el-button>
        </article>
        <el-alert v-else type="info" :closable="false" title="商户主页启用方案当前不可用；已提交的商户资料和历史订单不受影响。" />

        <div v-if="merchantOrders.length" class="merchant-orders">
          <h3>商户主页订单</h3>
          <article v-for="order in merchantOrders" :key="order.id" class="cpu-card">
            <div><b>{{ order.planName }}</b><span>{{ order.outTradeNo }}</span><small v-if="order.status === 'rejected' && order.paymentSubmittedAt">已付款订单未通过，请私下联系管理员退款</small></div>
            <div><strong>¥{{ order.amount }}</strong><el-tag :type="orderStatusType(order.status)">{{ orderStatusLabel(order.status) }}</el-tag></div>
            <div>
              <time>{{ formatTime(order.createdAt) }}</time>
              <el-button v-if="order.status === 'pending'" link type="primary" @click="openPayment(order)">{{ order.paymentSubmittedAt ? '查看付款状态' : '立即付款' }}</el-button>
              <el-button v-if="['pending','waitlisted'].includes(order.status)" link type="danger" @click="cancelOrder(order)">取消申请</el-button>
            </div>
          </article>
        </div>
      </template>
      <el-empty v-else description="先提交商户资料，审核通过后可在这里申请启用商户主页" />
    </section>
    <PromotionPaymentDialog v-model="paymentOpen" :order="paymentOrder" @submitted="handlePaymentSubmitted" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { marketApi, type MerchantProfile, type PromotionOrder, type PromotionPlan } from "@/api/market";
import PromotionLabel from "@/components/market/PromotionLabel.vue";
import PromotionPaymentDialog from "@/components/market/PromotionPaymentDialog.vue";
import { uploadApi } from "@/api/topic";

const categories = ["打印装订", "电脑维修", "手机维修", "搬运寄存", "摄影与证件照", "校园周边餐饮", "其他合规服务"];
const profile = ref<MerchantProfile | null>(null), merchantPlans = ref<PromotionPlan[]>([]), merchantOrders = ref<PromotionOrder[]>([]);
const loading = ref(false), submitting = ref(false), ordering = ref(false), uploading = ref(false), uploadProgress = ref(0);
const paymentOpen = ref(false), paymentOrder = ref<PromotionOrder | null>(null);
const form = reactive({ slug: "", name: "", category: "", description: "", priceRange: "", serviceArea: "", studentDiscount: "", contactMethod: "wechat", contactValue: "", images: [] as string[] });
const merchantPlan = computed(() => merchantPlans.value[0] || null);
const pendingOrder = computed(() => merchantOrders.value.find((order) => ["pending", "waitlisted"].includes(order.status)));
const statusCopy = computed(() => profile.value?.status === "approved" ? "商户资料已审核通过，可在下方申请主页启用或续期。" : profile.value?.status === "reviewing" ? "资料正在人工审核，修改后会重新进入审核。" : profile.value?.status === "suspended" ? `主页已暂停：${profile.value.reviewNote || '请联系管理员核查'}` : `资料未通过：${profile.value?.reviewNote || '请修改后重新提交'}`);
const homepageActionLabel = computed(() => profile.value?.status !== "approved" ? "资料审核通过后可申请" : pendingOrder.value ? "主页启用申请待确认" : profile.value?.activeUntil ? "申请主页续期" : "申请启用主页");

onMounted(load);

async function load() {
  loading.value = true;
  try {
    const [nextProfile, nextPlans, nextOrders] = await Promise.all([
      marketApi.myMerchantProfile({ suppressErrorMessage: true }),
      marketApi.promotionPlans({ scope: "merchant" }, { suppressErrorMessage: true }),
      marketApi.promotionOrders({ page: 1, size: 50, scope: "merchant" }, { suppressErrorMessage: true }),
    ]);
    profile.value = nextProfile;
    merchantPlans.value = nextPlans;
    merchantOrders.value = nextOrders.list;
    if (nextProfile) Object.assign(form, { slug: nextProfile.slug, name: nextProfile.name, category: nextProfile.category, description: nextProfile.description, priceRange: nextProfile.priceRange, serviceArea: nextProfile.serviceArea, studentDiscount: nextProfile.studentDiscount, contactMethod: nextProfile.contactMethod, contactValue: "", images: [...nextProfile.images] });
  } finally { loading.value = false; }
}

async function uploadImages(event: Event) { const input = event.target as HTMLInputElement; const files = Array.from(input.files || []).slice(0, 9-form.images.length); if (!files.length) return; uploading.value = true; try { for (let index=0; index<files.length; index++) { const file=files[index]; const result=await uploadApi.media(file,file.name,{onProgress:(state)=>{uploadProgress.value=Math.round(((index+state.percent/100)/files.length)*100)}}); form.images.push(result.url); } } finally { uploading.value=false; uploadProgress.value=0; input.value=""; } }
async function submit() { if (!form.name.trim() || !form.slug.trim() || !form.category || form.description.trim().length<20 || !form.priceRange.trim() || !form.serviceArea.trim() || !form.contactValue.trim()) return ElMessage.warning("请完整填写商户资料和本次联系方式"); submitting.value=true; try { profile.value=await marketApi.saveMerchantProfile(form); form.contactValue=""; ElMessage.success("商户资料已提交人工审核"); } finally { submitting.value=false; } }
async function applyHomepage() {
  if (!profile.value || !merchantPlan.value || profile.value.status !== "approved" || pendingOrder.value) return;
  await ElMessageBox.confirm(`确认申请“${merchantPlan.value.name}”？有可用位置时会显示收款码，付款后仍由管理员人工核验。`, "申请商户主页服务", { type: "warning" });
  ordering.value = true;
  try { const order = await marketApi.createPromotionOrder({ planCode: merchantPlan.value.code, targetId: profile.value.id }); if (order.status === "waitlisted") ElMessage.warning("目前推广服务已满，申请已进入候补队列"); else openPayment(order); await load(); } finally { ordering.value = false; }
}
function openPayment(order: PromotionOrder) { paymentOrder.value = order; paymentOpen.value = true; }
async function handlePaymentSubmitted(order: PromotionOrder) { paymentOrder.value = order; await load(); }
async function cancelOrder(order: PromotionOrder) { await ElMessageBox.confirm("确认取消这条商户主页申请？", "取消申请", { type: "warning" }); await marketApi.cancelPromotionOrder(order.id); ElMessage.success("商户主页申请已取消"); await load(); }
function statusType(status: MerchantProfile["status"]) { return status === "approved" ? "success" : status === "reviewing" ? "warning" : "error"; }
function orderStatusLabel(status: PromotionOrder["status"]) { return ({ waitlisted: "候补中", pending: "待付款/核验", confirmed: "主页生效中", rejected: "未通过", cancelled: "已取消", expired: "已到期" } as const)[status]; }
function orderStatusType(status: PromotionOrder["status"]) { return status === "confirmed" ? "success" : ["pending", "waitlisted"].includes(status) ? "warning" : status === "rejected" ? "danger" : "info"; }
function formatTime(value: string) { return new Date(value).toLocaleString("zh-CN"); }
function formatDate(value: string) { return new Date(value).toLocaleDateString("zh-CN"); }
</script>

<style scoped>
.merchant-apply{max-width:1020px;margin:0 auto;display:flex;flex-direction:column;gap:18px}.page-head,.section-head{display:flex;align-items:flex-end;justify-content:space-between;gap:20px}.head-actions{display:flex;gap:8px}.page-head span,.section-head span{color:var(--cpu-primary);font-size:9px;font-weight:800;letter-spacing:.16em}.page-head h1{margin:6px 0}.page-head p,.section-head p,.section-note{margin:0;color:var(--cpu-text-secondary);font-size:11px}.profile-form{padding:25px}.profile-form section+section{margin-top:27px;padding-top:22px;border-top:1px solid var(--cpu-border-soft)}.profile-form h2{margin:0 0 15px;font-size:17px}.section-note{margin:-8px 0 13px}.two-cols{display:grid;grid-template-columns:1fr 1fr;gap:17px}.image-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:10px}.image-cell,.upload-cell{position:relative;aspect-ratio:1;overflow:hidden;border-radius:11px;background:var(--cpu-surface-soft)}.image-cell img{width:100%;height:100%;object-fit:cover}.image-cell button{position:absolute;right:5px;top:5px;width:24px;height:24px;border:0;border-radius:50%;color:#fff;background:rgba(15,23,42,.7)}.upload-cell{display:flex;align-items:center;justify-content:center;flex-direction:column;border:1px dashed var(--cpu-border);cursor:pointer}.upload-cell input{display:none}.upload-cell span{font-size:25px}.upload-cell b{font-size:10px}.form-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:20px}.merchant-service{display:flex;flex-direction:column;gap:13px}.section-head h2{margin:5px 0}.service-plan{display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:24px;padding:20px}.service-plan h3{margin:9px 0 5px}.service-plan p{margin:0;color:var(--cpu-text-secondary);font-size:11px}.plan-price{display:flex;align-items:flex-end;flex-direction:column}.plan-price strong{font-size:25px}.plan-price span,.plan-price small{color:var(--cpu-text-secondary);font-size:10px}.merchant-orders{display:flex;flex-direction:column;gap:9px}.merchant-orders>h3{margin:4px 0}.merchant-orders>article{display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:18px;padding:14px 17px}.merchant-orders>article>div{display:flex;align-items:flex-start;flex-direction:column;gap:4px}.merchant-orders>article>div:nth-child(2){align-items:flex-end}.merchant-orders>article>div:last-child{align-items:flex-end}.merchant-orders span,.merchant-orders time{color:var(--cpu-text-secondary);font-size:9px}@media(max-width:650px){.page-head,.section-head{align-items:flex-start;flex-direction:column}.head-actions{width:100%}.head-actions .el-button{flex:1}.two-cols{grid-template-columns:1fr}.profile-form{padding:16px}.image-grid{grid-template-columns:repeat(3,1fr)}.form-actions .el-button{flex:1}.service-plan,.merchant-orders>article{grid-template-columns:1fr}.plan-price,.merchant-orders>article>div:nth-child(2),.merchant-orders>article>div:last-child{align-items:flex-start}.service-plan>.el-button{width:100%}}
</style>
