<template>
  <div class="publisher-page" v-loading="loading">
    <header class="page-head">
      <div>
        <span>LEARNING PUBLISHER CENTER</span>
        <h1>学习资料发布中心</h1>
        <p>校园用户无需申请即可发布资料；资料内容与版本通过审核后在专区上架。</p>
      </div>
      <div class="head-actions">
        <el-button @click="router.push({ name: 'market-learning-materials' })">返回资料专区</el-button>
        <el-button @click="router.push({ name: 'market-learning-orders', query: { side: 'seller' } })">资料订单</el-button>
        <el-button type="primary" :disabled="!activePublisher" @click="router.push({ name: 'market-learning-materials-publish' })">发布资料</el-button>
      </div>
    </header>

    <el-alert type="info" :closable="false" show-icon title="平台不代收资料款。买家直接向你的收款码付款；你核对到账后确认，系统才会解锁完整资料。" />
    <el-alert v-if="publisherRestricted" type="error" :closable="false" show-icon :title="`资料发布权限当前${publishingStatusLabel}：${context.profile?.statusReason || '请查看治理记录并按需申诉'}`" />

    <section class="status-grid">
      <article class="cpu-card">
        <span>发布权限</span>
        <strong>{{ activePublisher ? "正常" : "受限" }}</strong>
        <small>无需申请，校园用户默认开放</small>
      </article>
      <article class="cpu-card">
        <span>完成订单</span>
        <strong>{{ context.profile?.completedOrderCount || 0 }}</strong>
        <small>退款 {{ ((context.profile?.refundRateBps || 0) / 100).toFixed(2) }}% · 争议 {{ ((context.profile?.disputeRateBps || 0) / 100).toFixed(2) }}%</small>
      </article>
      <article class="cpu-card">
        <span>已购评分</span>
        <strong>{{ context.profile?.averageRatingBps ? (context.profile.averageRatingBps / 100).toFixed(2) : "—" }}</strong>
        <small>{{ context.profile?.ratingCount || 0 }} 条已购评价</small>
      </article>
    </section>

    <section class="cpu-card item-card">
      <div class="section-head">
        <div><h2>我的资料发布</h2><p>学习资料只在这里管理，不进入实体商品的“我的交易”。</p></div>
        <el-radio-group v-model="itemFilter" size="small">
          <el-radio-button value="all">全部</el-radio-button>
          <el-radio-button value="active">已上架</el-radio-button>
          <el-radio-button value="reviewing">审核中</el-radio-button>
          <el-radio-button value="draft">草稿</el-radio-button>
          <el-radio-button value="withdrawn">已下架</el-radio-button>
        </el-radio-group>
      </div>
      <div v-if="filteredItems.length" class="item-list">
        <article v-for="item in filteredItems" :key="item.id">
          <div class="item-cover"><img v-if="item.cover" :src="item.cover" :alt="item.title" /><span v-else>📝</span></div>
          <div class="item-copy">
            <div><b>{{ item.title }}</b><el-tag size="small" :type="itemStatusType(item.status)">{{ itemStatusLabel(item.status) }}</el-tag></div>
            <span>{{ item.material?.courseCode || "课程待补充" }} · ¥{{ item.price }} · {{ item.material?.versionLabel || "版本待补充" }}</span>
            <small>更新于 {{ formatDate(item.updatedAt) }}</small>
          </div>
          <div class="item-actions">
            <el-button size="small" @click="router.push({ name: 'market-learning-material-item', params: { id: item.id } })">查看</el-button>
            <el-button size="small" type="primary" plain @click="router.push({ name: 'market-learning-materials-edit', params: { id: item.id } })">编辑</el-button>
          </div>
        </article>
      </div>
      <el-empty v-else description="当前分类还没有资料"><el-button type="primary" :disabled="!activePublisher" @click="router.push({ name: 'market-learning-materials-publish' })">发布第一份资料</el-button></el-empty>
    </section>

    <section v-if="violations.length" class="cpu-card collection-card">
      <div class="section-head"><div><h2>治理记录与申诉</h2><p>违规动作、证据和处理状态在这里留痕；申诉通过不会自动恢复已下架资料，需重新审核。</p></div></div>
      <div class="violation-list">
        <article v-for="row in violations" :key="row.id">
          <div><el-tag :type="row.status === 'active' ? 'danger' : 'info'">{{ row.status }}</el-tag><b>{{ row.reason }}</b><span>{{ row.action }} · {{ formatDate(row.createdAt) }}</span></div>
          <el-button v-if="row.status === 'active' && !row.appeals.some(item => item.status === 'pending')" size="small" @click="appealViolation = row">发起申诉</el-button>
          <small v-else-if="row.appeals.length">申诉：{{ row.appeals[0].status }} {{ row.appeals[0].handleNote }}</small>
        </article>
      </div>
    </section>

    <section class="cpu-card collection-card">
      <div class="section-head">
        <div><h2>收款方式</h2><p>收款码只向相关订单买家和管理员展示，不会出现在公开资料页。</p></div>
        <el-button type="primary" :disabled="!activePublisher" @click="methodDialog = true">添加收款码</el-button>
      </div>
      <div v-if="context.profile?.collectionMethods.length" class="method-grid">
        <article v-for="method in context.profile.collectionMethods" :key="method.id" :class="{ disabled: method.status !== 'active' }">
          <img :src="method.qrImageUrl" :alt="providerLabel(method.provider)" />
          <div><el-tag :type="method.provider === 'wechat' ? 'success' : 'primary'">{{ providerLabel(method.provider) }}</el-tag><b>{{ method.label || `${providerLabel(method.provider)}收款码` }}</b><span>版本 {{ method.versionNumber }} · {{ method.status === "active" ? "使用中" : "已停用" }}</span></div>
          <el-button v-if="method.status === 'active'" link type="danger" @click="disableMethod(method.id)">停用</el-button>
        </article>
      </div>
      <el-empty v-else description="尚未配置收款码；可以先保存资料草稿，提交上架审核前再配置。" />
    </section>

    <el-dialog v-model="methodDialog" title="添加收款码" width="520px">
      <el-form label-position="top">
        <el-form-item label="收款平台"><el-radio-group v-model="methodForm.provider"><el-radio-button value="wechat">微信支付</el-radio-button><el-radio-button value="alipay">支付宝</el-radio-button></el-radio-group></el-form-item>
        <el-form-item label="备注"><el-input v-model="methodForm.label" maxlength="60" placeholder="例如：本人支付宝" /></el-form-item>
        <el-form-item label="收款码图片"><label class="image-picker"><input type="file" accept="image/png,image/jpeg,image/webp" @change="pickMethodImage" /><img v-if="methodPreview" :src="methodPreview" alt="收款码预览" /><span v-else>选择 PNG、JPEG 或 WebP 图片，最大 5MB</span></label></el-form-item>
      </el-form>
      <template #footer><el-button @click="methodDialog = false">取消</el-button><el-button type="primary" :loading="savingMethod" @click="saveMethod">保存收款码</el-button></template>
    </el-dialog>
    <el-dialog v-model="appealDialog" title="申诉治理记录" width="520px"><el-input v-model="appealContent" type="textarea" :rows="6" maxlength="3000" show-word-limit placeholder="说明异议、事实依据和希望复核的内容（至少 10 字）" /><template #footer><el-button @click="appealViolation = null">取消</el-button><el-button type="primary" @click="submitAppeal">提交申诉</el-button></template></el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  learningMaterialsApi,
  type LearningCollectionProvider,
  type LearningCreatorContext,
  type LearningCreatorViolation,
  type LearningMaterialItem,
} from "@/api/learningMaterials";

const router = useRouter();
const loading = ref(false);
const savingMethod = ref(false);
const methodDialog = ref(false);
const context = reactive<LearningCreatorContext>({ publishingAllowed: true, publishingStatus: "active", profile: null, application: null });
const items = ref<LearningMaterialItem[]>([]);
const itemFilter = ref("all");
const methodForm = reactive<{ provider: LearningCollectionProvider; label: string; image: File | null }>({ provider: "wechat", label: "", image: null });
const methodPreview = ref("");
const violations = ref<LearningCreatorViolation[]>([]);
const appealContent = ref("");
const appealViolation = ref<LearningCreatorViolation | null>(null);

const publisherRestricted = computed(() => context.publishingAllowed === false || ["suspended", "revoked"].includes(context.publishingStatus));
const activePublisher = computed(() => !publisherRestricted.value);
const publishingStatusLabel = computed(() => context.publishingStatus === "revoked" ? "已撤销" : "已暂停");
const filteredItems = computed(() => itemFilter.value === "all" ? items.value : items.value.filter((item) => item.status === itemFilter.value));
const appealDialog = computed({ get: () => Boolean(appealViolation.value), set: (value) => { if (!value) appealViolation.value = null; } });

onMounted(load);
onBeforeUnmount(clearPreview);

async function load() {
  loading.value = true;
  try {
    const [contextResult, itemsResult, violationsResult] = await Promise.allSettled([
      learningMaterialsApi.creatorContext({ suppressErrorMessage: true }),
      learningMaterialsApi.myItems({ suppressErrorMessage: true }),
      learningMaterialsApi.creatorViolations({ suppressErrorMessage: true }),
    ]);
    if (contextResult.status === "fulfilled") Object.assign(context, contextResult.value);
    if (itemsResult.status === "fulfilled") items.value = itemsResult.value;
    if (violationsResult.status === "fulfilled") violations.value = violationsResult.value;
  } finally { loading.value = false; }
}

function pickMethodImage(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0] || null;
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { input.value = ""; return ElMessage.warning("收款码图片不能超过 5MB"); }
  clearPreview();
  methodForm.image = file;
  methodPreview.value = URL.createObjectURL(file);
}

function clearPreview() {
  if (methodPreview.value) URL.revokeObjectURL(methodPreview.value);
  methodPreview.value = "";
}

async function saveMethod() {
  if (!methodForm.image) return ElMessage.warning("请选择收款码图片");
  savingMethod.value = true;
  try {
    await learningMaterialsApi.createCollectionMethod(methodForm.provider, methodForm.label.trim(), methodForm.image);
    ElMessage.success("收款码已安全保存");
    methodDialog.value = false;
    methodForm.label = "";
    methodForm.image = null;
    clearPreview();
    await load();
  } finally { savingMethod.value = false; }
}

async function disableMethod(id: number) {
  await ElMessageBox.confirm("停用后，新订单不会再使用该收款码；历史订单仍保留原快照。", "停用收款码", { type: "warning" });
  await learningMaterialsApi.disableCollectionMethod(id);
  ElMessage.success("收款码已停用");
  await load();
}

async function submitAppeal() {
  if (!appealViolation.value) return;
  if (appealContent.value.trim().length < 10) return ElMessage.warning("请填写至少 10 个字符的申诉说明");
  await learningMaterialsApi.appealCreatorViolation(appealViolation.value.id, appealContent.value.trim());
  ElMessage.success("申诉已提交，等待运营人员复核");
  appealViolation.value = null;
  appealContent.value = "";
  await load();
}

function providerLabel(provider: LearningCollectionProvider) { return provider === "wechat" ? "微信支付" : "支付宝"; }
function formatDate(value?: string | null) { return value ? new Date(value).toLocaleString("zh-CN") : "—"; }
function itemStatusLabel(status: string) { return ({ active: "已上架", reviewing: "审核中", draft: "草稿", withdrawn: "已下架", hidden: "已隐藏", sold: "已售出" } as Record<string, string>)[status] || status; }
function itemStatusType(status: string) { return status === "active" ? "success" : status === "reviewing" ? "warning" : status === "hidden" ? "danger" : "info"; }
</script>

<style scoped>
.publisher-page{max-width:1120px;margin:0 auto;display:flex;flex-direction:column;gap:18px}.page-head,.section-head{display:flex;align-items:flex-start;justify-content:space-between;gap:20px}.page-head span{color:#a21caf;font-size:10px;font-weight:800;letter-spacing:.16em}.page-head h1{margin:6px 0;font-size:30px}.page-head p,.section-head p{margin:0;color:var(--cpu-text-secondary);font-size:12px}.head-actions{display:flex;gap:9px;flex-wrap:wrap}.status-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.status-grid article{display:flex;flex-direction:column;padding:20px}.status-grid span,.status-grid small{color:var(--cpu-text-secondary);font-size:11px}.status-grid strong{margin:6px 0;color:#a21caf;font-size:28px}.item-card,.collection-card{padding:24px}.section-head{margin-bottom:18px}.section-head h2{margin:0 0 5px}.item-list{display:flex;flex-direction:column}.item-list>article{display:flex;align-items:center;gap:14px;padding:12px 0;border-top:1px solid var(--cpu-border-soft)}.item-cover{display:grid;place-items:center;width:72px;height:62px;overflow:hidden;flex:0 0 72px;border-radius:9px;color:#7e22ce;background:#f3e8ff;font-size:25px}.item-cover img{width:100%;height:100%;object-fit:cover}.item-copy{display:flex;min-width:0;flex:1;flex-direction:column;gap:5px}.item-copy>div{display:flex;align-items:center;gap:8px}.item-copy b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.item-copy span,.item-copy small{color:var(--cpu-text-secondary);font-size:10px}.item-actions{display:flex;gap:7px}.method-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.method-grid article{display:grid;grid-template-columns:92px 1fr auto;align-items:center;gap:14px;padding:14px;border:1px solid var(--cpu-border-soft);border-radius:13px}.method-grid article.disabled{opacity:.58}.method-grid img{width:92px;height:92px;border-radius:10px;object-fit:contain;background:#fff}.method-grid article>div{display:flex;align-items:flex-start;flex-direction:column;gap:6px}.method-grid b{font-size:13px}.method-grid span{color:var(--cpu-text-secondary);font-size:10px}.image-picker{display:grid;place-items:center;min-height:220px;border:1px dashed #c084fc;border-radius:12px;background:#fdf4ff;cursor:pointer}.image-picker input{display:none}.image-picker img{max-width:210px;max-height:210px;object-fit:contain}.image-picker span{color:#86198f;font-size:12px}.violation-list{display:flex;flex-direction:column;gap:8px}.violation-list article{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:12px;border:1px solid var(--cpu-border-soft);border-radius:10px}.violation-list article>div{display:flex;align-items:center;gap:9px;flex-wrap:wrap}.violation-list span,.violation-list small{color:var(--cpu-text-secondary);font-size:10px}@media(max-width:760px){.page-head,.section-head{flex-direction:column}.head-actions{width:100%}.status-grid,.method-grid{grid-template-columns:1fr}.method-grid article{grid-template-columns:76px 1fr auto}.method-grid img{width:76px;height:76px}.item-list>article{align-items:flex-start;flex-wrap:wrap}.item-actions{width:100%;justify-content:flex-end}}
</style>
