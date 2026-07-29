<template>
  <div class="creator-page" v-loading="loading">
    <header class="page-head">
      <div>
        <span>CREATOR CENTER</span>
        <h1>学习资料创作者中心</h1>
        <p>先完成创作者认证和收款码配置，再提交付费资料人工审核。</p>
      </div>
      <div class="head-actions">
        <el-button @click="router.push({ name: 'market-learning-orders', query: { side: 'seller' } })">资料订单</el-button>
        <el-button type="primary" :disabled="!activeCreator" @click="router.push({ name: 'market-learning-materials-publish' })">发布资料</el-button>
      </div>
    </header>

    <el-alert
      type="info"
      :closable="false"
      show-icon
      title="平台不代收资料款。买家直接向你的收款码付款；你核对到账后确认，系统才会解锁完整资料。"
    />

    <section v-if="!context.profile" class="cpu-card application-card">
      <div class="section-head">
        <div>
          <h2>创作者认证</h2>
          <p>审核重点是学习领域、资料制作经验、样例说明与版权承诺。</p>
        </div>
        <el-tag v-if="context.application" :type="applicationTagType">{{ applicationStatus }}</el-tag>
      </div>

      <el-alert
        v-if="context.application?.status === 'rejected'"
        type="error"
        :closable="false"
        show-icon
        :title="context.application.reviewReason || '申请未通过，请完善资料后重新提交。'"
      />
      <div v-if="applicationPending" class="pending-copy">
        <b>申请已提交，正在等待人工审核</b>
        <span>提交时间：{{ formatDate(context.application?.submittedAt) }}</span>
      </div>
      <el-form v-else label-position="top" class="application-form">
        <el-form-item label="擅长领域">
          <el-input v-model="application.expertise" maxlength="300" show-word-limit placeholder="例如：CPT、数学基础、语言考试与课程规划" />
        </el-form-item>
        <el-form-item label="资料制作或教学经验">
          <el-input v-model="application.experience" type="textarea" :rows="4" maxlength="2000" show-word-limit />
        </el-form-item>
        <el-form-item label="拟发布资料样例说明">
          <el-input v-model="application.sampleDescription" type="textarea" :rows="4" maxlength="2000" show-word-limit placeholder="说明内容范围、适用课程、文件结构和预期帮助" />
        </el-form-item>
        <el-checkbox v-model="rightsCommitted">我承诺仅发布本人原创、已获授权或依法可使用的内容，并接受平台审核。</el-checkbox>
        <div class="form-actions">
          <el-button type="primary" :loading="savingApplication" @click="submitApplication">提交认证申请</el-button>
        </div>
      </el-form>
    </section>

    <template v-else>
      <el-alert v-if="!activeCreator" type="error" :closable="false" show-icon :title="`创作者权限当前为 ${context.profile?.status}：${context.profile?.statusReason || '请查看治理记录并按需申诉'}`" />
      <section class="status-grid">
        <article class="cpu-card">
          <span>创作者等级</span>
          <strong>{{ levelLabel }}</strong>
          <small>质量分 {{ context.profile?.qualityScore ?? 60 }}</small>
        </article>
        <article class="cpu-card">
          <span>成交评分</span>
          <strong>{{ context.profile?.averageRatingBps ? (context.profile.averageRatingBps/100).toFixed(2) : "—" }}</strong>
          <small>{{ context.profile?.ratingCount || 0 }} 条已购评价</small>
        </article>
        <article class="cpu-card">
          <span>完成订单</span>
          <strong>{{ context.profile?.completedOrderCount || 0 }}</strong>
          <small>退款 {{ ((context.profile?.refundRateBps || 0)/100).toFixed(2) }}% · 争议 {{ ((context.profile?.disputeRateBps || 0)/100).toFixed(2) }}%</small>
        </article>
      </section>

      <section v-if="violations.length" class="cpu-card collection-card">
        <div class="section-head"><div><h2>治理记录与申诉</h2><p>违规动作、证据和处理状态在这里留痕；申诉通过不会自动恢复已下架资料，需重新审核。</p></div></div>
        <div class="violation-list"><article v-for="row in violations" :key="row.id"><div><el-tag :type="row.status==='active'?'danger':'info'">{{ row.status }}</el-tag><b>{{ row.reason }}</b><span>{{ row.action }} · {{ formatDate(row.createdAt) }}</span></div><el-button v-if="row.status==='active'&&!row.appeals.some(item=>item.status==='pending')" size="small" @click="appealViolation=row">发起申诉</el-button><small v-else-if="row.appeals.length">申诉：{{ row.appeals[0].status }} {{ row.appeals[0].handleNote }}</small></article></div>
      </section>

      <section class="cpu-card collection-card">
        <div class="section-head">
          <div>
            <h2>收款方式</h2>
            <p>收款码只向相关订单买家和管理员展示，不会出现在公开资料页。</p>
          </div>
          <el-button type="primary" @click="methodDialog = true">添加收款码</el-button>
        </div>
        <div v-if="context.profile?.collectionMethods.length" class="method-grid">
          <article v-for="method in context.profile.collectionMethods" :key="method.id" :class="{ disabled: method.status !== 'active' }">
            <img :src="method.qrImageUrl" :alt="providerLabel(method.provider)" />
            <div>
              <el-tag :type="method.provider === 'wechat' ? 'success' : 'primary'">{{ providerLabel(method.provider) }}</el-tag>
              <b>{{ method.label || `${providerLabel(method.provider)}收款码` }}</b>
              <span>版本 {{ method.versionNumber }} · {{ method.status === "active" ? "使用中" : "已停用" }}</span>
            </div>
            <el-button v-if="method.status === 'active'" link type="danger" @click="disableMethod(method.id)">停用</el-button>
          </article>
        </div>
        <el-empty v-else description="尚未配置收款码，配置后才能提交资料审核" />
      </section>
    </template>

    <el-dialog v-model="methodDialog" title="添加收款码" width="520px">
      <el-form label-position="top">
        <el-form-item label="收款平台">
          <el-radio-group v-model="methodForm.provider">
            <el-radio-button value="wechat">微信支付</el-radio-button>
            <el-radio-button value="alipay">支付宝</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="methodForm.label" maxlength="60" placeholder="例如：本人支付宝" />
        </el-form-item>
        <el-form-item label="收款码图片">
          <label class="image-picker">
            <input type="file" accept="image/png,image/jpeg,image/webp" @change="pickMethodImage" />
            <img v-if="methodPreview" :src="methodPreview" alt="收款码预览" />
            <span v-else>选择 PNG、JPEG 或 WebP 图片，最大 5MB</span>
          </label>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="methodDialog = false">取消</el-button>
        <el-button type="primary" :loading="savingMethod" @click="saveMethod">保存收款码</el-button>
      </template>
    </el-dialog>
    <el-dialog v-model="appealDialog" title="申诉治理记录" width="520px"><el-input v-model="appealContent" type="textarea" :rows="6" maxlength="3000" show-word-limit placeholder="说明异议、事实依据和希望复核的内容（至少 10 字）" /><template #footer><el-button @click="appealViolation=null">取消</el-button><el-button type="primary" @click="submitAppeal">提交申诉</el-button></template></el-dialog>
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
} from "@/api/learningMaterials";

const router = useRouter();
const loading = ref(false);
const savingApplication = ref(false);
const savingMethod = ref(false);
const methodDialog = ref(false);
const rightsCommitted = ref(false);
const context = reactive<LearningCreatorContext>({ profile: null, application: null });
const application = reactive({ expertise: "", experience: "", sampleDescription: "" });
const methodForm = reactive<{ provider: LearningCollectionProvider; label: string; image: File | null }>({
  provider: "wechat",
  label: "",
  image: null,
});
const methodPreview = ref("");
const violations = ref<LearningCreatorViolation[]>([]);
const appealContent = ref("");
const appealViolation = ref<LearningCreatorViolation | null>(null);

const activeCreator = computed(() => context.profile?.status === "active");
const activeMethods = computed(() => context.profile?.collectionMethods.filter((row) => row.status === "active") || []);
const applicationPending = computed(() => ["submitted", "reviewing"].includes(context.application?.status || ""));
const applicationStatusLabels: Record<string, string> = {
  submitted: "待审核",
  reviewing: "审核中",
  approved: "已通过",
  rejected: "未通过",
  withdrawn: "已撤回",
};
const applicationStatus = computed(() => applicationStatusLabels[context.application?.status || ""] || "未申请");
const applicationTagType = computed(() => applicationPending.value ? "warning" : context.application?.status === "rejected" ? "danger" : "info");
const levelLabel = computed(() => ({ certified: "认证", reliable: "可信", excellent: "卓越" }[context.profile?.level || "certified"]));
const appealDialog = computed({ get: () => Boolean(appealViolation.value), set: (value) => { if (!value) appealViolation.value = null; } });

onMounted(load);
onBeforeUnmount(clearPreview);

async function load() {
  loading.value = true;
  try {
    const [nextContext, nextViolations] = await Promise.all([
      learningMaterialsApi.creatorContext({ suppressErrorMessage: true }),
      learningMaterialsApi.creatorViolations({ suppressErrorMessage: true }),
    ]);
    Object.assign(context, nextContext);
    violations.value = nextViolations;
  } finally {
    loading.value = false;
  }
}

async function submitApplication() {
  if (application.expertise.trim().length < 2) return ElMessage.warning("请填写擅长领域");
  if (application.experience.trim().length < 10) return ElMessage.warning("请具体说明资料制作或教学经验");
  if (application.sampleDescription.trim().length < 10) return ElMessage.warning("请具体说明拟发布的资料样例");
  if (!rightsCommitted.value) return ElMessage.warning("请先确认版权与内容承诺");
  savingApplication.value = true;
  try {
    context.application = await learningMaterialsApi.applyCreator({
      expertise: application.expertise.trim(),
      experience: application.experience.trim(),
      sampleDescription: application.sampleDescription.trim(),
      rightsCommitted: true,
    });
    ElMessage.success("创作者认证申请已提交");
  } finally {
    savingApplication.value = false;
  }
}

function pickMethodImage(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0] || null;
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) {
    input.value = "";
    return ElMessage.warning("收款码图片不能超过 5MB");
  }
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
  } finally {
    savingMethod.value = false;
  }
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

function providerLabel(provider: LearningCollectionProvider) {
  return provider === "wechat" ? "微信支付" : "支付宝";
}

function formatDate(value?: string | null) {
  return value ? new Date(value).toLocaleString("zh-CN") : "—";
}
</script>

<style scoped>
.creator-page{max-width:1120px;margin:0 auto;display:flex;flex-direction:column;gap:18px}.page-head,.section-head{display:flex;align-items:flex-start;justify-content:space-between;gap:20px}.page-head span{color:#a21caf;font-size:10px;font-weight:800;letter-spacing:.16em}.page-head h1{margin:6px 0;font-size:30px}.page-head p,.section-head p{margin:0;color:var(--cpu-text-secondary);font-size:12px}.head-actions{display:flex;gap:9px}.application-card,.collection-card{padding:24px}.section-head{margin-bottom:18px}.section-head h2{margin:0 0 5px}.application-form{max-width:760px}.form-actions{margin-top:18px}.pending-copy{display:flex;flex-direction:column;gap:8px;padding:25px;border-radius:12px;background:var(--cpu-surface-soft)}.pending-copy span{color:var(--cpu-text-secondary);font-size:12px}.status-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.status-grid article{display:flex;flex-direction:column;padding:20px}.status-grid span,.status-grid small{color:var(--cpu-text-secondary);font-size:11px}.status-grid strong{margin:6px 0;color:#a21caf;font-size:28px}.method-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.method-grid article{display:grid;grid-template-columns:92px 1fr auto;align-items:center;gap:14px;padding:14px;border:1px solid var(--cpu-border-soft);border-radius:13px}.method-grid article.disabled{opacity:.58}.method-grid img{width:92px;height:92px;border-radius:10px;object-fit:contain;background:#fff}.method-grid article>div{display:flex;align-items:flex-start;flex-direction:column;gap:6px}.method-grid b{font-size:13px}.method-grid span{color:var(--cpu-text-secondary);font-size:10px}.image-picker{display:grid;place-items:center;min-height:220px;border:1px dashed #c084fc;border-radius:12px;background:#fdf4ff;cursor:pointer}.image-picker input{display:none}.image-picker img{max-width:210px;max-height:210px;object-fit:contain}.image-picker span{color:#86198f;font-size:12px}@media(max-width:760px){.page-head,.section-head{flex-direction:column}.head-actions{width:100%}.head-actions .el-button{flex:1}.status-grid,.method-grid{grid-template-columns:1fr}.method-grid article{grid-template-columns:76px 1fr auto}.method-grid img{width:76px;height:76px}}
.violation-list{display:flex;flex-direction:column;gap:8px}.violation-list article{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:12px;border:1px solid var(--cpu-border-soft);border-radius:10px}.violation-list article>div{display:flex;align-items:center;gap:9px;flex-wrap:wrap}.violation-list span,.violation-list small{color:var(--cpu-text-secondary);font-size:10px}
</style>
