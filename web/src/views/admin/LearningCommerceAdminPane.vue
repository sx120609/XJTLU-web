<template>
  <section class="learning-admin cpu-card" v-loading="loading">
    <header>
      <div>
        <span>PAID LEARNING OPERATIONS</span>
        <h3>付费学习资料审核</h3>
        <p>创作者资质与每个资料版本分别人工审核；付款争议可进入订单查看完整凭证链。</p>
      </div>
      <el-button @click="load">刷新审核队列</el-button>
    </header>

    <div class="queue-counts">
      <article><b>{{ applications.length }}</b><span>待审核创作者</span></article>
      <article><b>{{ reviews.length }}</b><span>待审核资料</span></article>
      <article><b>{{ disputes.length }}</b><span>争议订单</span></article>
      <article><b>{{ issues.length }}</b><span>待处理售后</span></article>
    </div>

    <el-tabs v-model="tab">
      <el-tab-pane label="创作者认证" name="creators">
        <el-table :data="applications" stripe>
          <el-table-column label="申请人" min-width="150">
            <template #default="{ row }"><b>{{ row.user?.nickname || `用户 #${row.userId}` }}</b><small>{{ formatDate(row.submittedAt) }}</small></template>
          </el-table-column>
          <el-table-column prop="expertise" label="擅长领域" min-width="180" show-overflow-tooltip />
          <el-table-column prop="experience" label="经验说明" min-width="220" show-overflow-tooltip />
          <el-table-column prop="sampleDescription" label="样例说明" min-width="240" show-overflow-tooltip />
          <el-table-column label="操作" width="160">
            <template #default="{ row }">
              <el-button link type="success" @click="reviewCreator(row.id, 'approve')">通过</el-button>
              <el-button link type="danger" @click="reviewCreator(row.id, 'reject')">驳回</el-button>
            </template>
          </el-table-column>
        </el-table>
        <el-empty v-if="!applications.length" description="暂无待审核创作者申请" />
      </el-tab-pane>

      <el-tab-pane label="资料版本审核" name="materials">
        <el-table :data="reviews" stripe>
          <el-table-column label="资料" min-width="230">
            <template #default="{ row }">
              <router-link :to="{ name: 'market-learning-material-item', params: { id: row.version?.profile.item.id } }">{{ row.version?.profile.item.title }}</router-link>
              <small>{{ row.version?.profile.courseCode }} · {{ row.version?.profile.type?.name || "未分类" }}</small>
            </template>
          </el-table-column>
          <el-table-column label="版本文件" min-width="230">
            <template #default="{ row }">
              <div class="file-list"><span v-for="file in row.version?.files" :key="file.id">{{ file.originalName }}（{{ file.format }}）</span></div>
            </template>
          </el-table-column>
          <el-table-column label="提交人" min-width="130"><template #default="{ row }">{{ row.submittedBy?.nickname || `#${row.submittedById}` }}</template></el-table-column>
          <el-table-column label="操作" width="170">
            <template #default="{ row }">
              <el-button link type="success" @click="openMaterialReview(row, 'approve')">检查并通过</el-button>
              <el-button link type="danger" @click="openMaterialReview(row, 'reject')">驳回</el-button>
            </template>
          </el-table-column>
        </el-table>
        <el-empty v-if="!reviews.length" description="暂无待审核资料版本" />
      </el-tab-pane>

      <el-tab-pane label="付款争议" name="disputes">
        <el-table :data="disputes" stripe>
          <el-table-column label="订单" min-width="230">
            <template #default="{ row }"><b>{{ row.order.item.title }}</b><small>{{ row.order.outTradeNo }}</small></template>
          </el-table-column>
          <el-table-column label="买家 / 卖家" min-width="180"><template #default="{ row }">{{ row.order.buyer.nickname }} / {{ row.order.seller.nickname }}</template></el-table-column>
          <el-table-column label="金额" width="100"><template #default="{ row }">¥{{ row.amount }}</template></el-table-column>
          <el-table-column label="争议说明" min-width="220"><template #default="{ row }">{{ row.issues[0]?.reason || "卖家确认超时" }}</template></el-table-column>
          <el-table-column label="操作" width="120">
            <template #default="{ row }"><el-button link type="primary" @click="router.push({ name: 'market-learning-order-detail', params: { id: row.id }, query: { side: 'all' } })">核验凭证</el-button></template>
          </el-table-column>
        </el-table>
        <el-empty v-if="!disputes.length" description="暂无付款争议订单" />
      </el-tab-pane>

      <el-tab-pane label="售后队列" name="issues">
        <el-table :data="issues" stripe>
          <el-table-column label="订单 / 问题" min-width="250">
            <template #default="{ row }">
              <b>{{ row.order.order.item.title }}</b>
              <small>{{ row.reason }} · {{ row.order.order.outTradeNo }}</small>
            </template>
          </el-table-column>
          <el-table-column label="发起人" width="130"><template #default="{ row }">{{ row.requestedBy?.nickname || `#${row.requestedById}` }}</template></el-table-column>
          <el-table-column prop="detail" label="问题说明" min-width="240" show-overflow-tooltip />
          <el-table-column label="状态" width="120"><template #default="{ row }"><el-tag type="warning">{{ issueStatus(row.status) }}</el-tag></template></el-table-column>
          <el-table-column label="操作" width="270">
            <template #default="{ row }">
              <el-button link type="primary" @click="router.push({ name: 'market-learning-order-detail', params: { id: row.commerceOrderId }, query: { side: 'all' } })">查看订单</el-button>
              <template v-if="row.order.status !== 'disputed'">
                <el-button link type="success" @click="openIssueDecision(row, 'resolve')">解决</el-button>
                <el-button link @click="openIssueDecision(row, 'close')">关闭</el-button>
              </template>
              <el-button v-if="['awaiting_seller_confirmation', 'disputed', 'delivered', 'completed'].includes(row.order.status)" link type="danger" @click="openIssueDecision(row, 'record_refund')">登记退款</el-button>
            </template>
          </el-table-column>
        </el-table>
        <el-empty v-if="!issues.length" description="暂无待处理售后" />
      </el-tab-pane>
    </el-tabs>

    <el-dialog v-model="reviewDialog" :title="reviewAction === 'approve' ? '检查并通过资料' : '驳回资料'" width="560px">
      <el-alert type="warning" :closable="false" show-icon title="审核人员应实际检查权利说明、内容质量和文件安全，不能只依据标题判断。" />
      <el-checkbox v-model="checklist.rights">版权、原创或授权说明可信且完整</el-checkbox>
      <el-checkbox v-model="checklist.quality">内容范围、课程匹配和质量达到上架标准</el-checkbox>
      <el-checkbox v-model="checklist.fileSafety">文件类型、名称和内容不存在明显安全风险</el-checkbox>
      <el-input v-model="reviewReason" type="textarea" :rows="4" maxlength="2000" show-word-limit :placeholder="reviewAction === 'reject' ? '驳回时必须填写具体修改意见' : '通过说明（选填）'" />
      <template #footer>
        <el-button @click="reviewDialog = false">取消</el-button>
        <el-button :type="reviewAction === 'approve' ? 'success' : 'danger'" :loading="saving" @click="submitMaterialReview">{{ reviewAction === "approve" ? "确认通过" : "确认驳回" }}</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="issueDialog" :title="issueAction === 'record_refund' ? '登记线下退款' : issueAction === 'resolve' ? '解决售后问题' : '关闭售后记录'" width="520px">
      <el-alert
        v-if="issueAction === 'record_refund'"
        type="warning"
        :closable="false"
        show-icon
        title="平台不会自动划款。请确认线下退款已经实际完成后再登记；登记后将撤销买家资料访问权并关闭订单。"
      />
      <el-form label-position="top">
        <el-form-item v-if="issueAction === 'record_refund'" label="实际退款金额（元）">
          <el-input-number v-model="refundAmount" :min="0.01" :max="Number(activeIssue?.order.amount || 0.01)" :precision="2" :step="1" controls-position="right" />
        </el-form-item>
        <el-form-item label="处理结果">
          <el-input v-model="issueResolution" type="textarea" :rows="4" maxlength="2000" show-word-limit placeholder="填写核验过程、双方沟通结果及线下退款参考信息" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="issueDialog = false">取消</el-button>
        <el-button :type="issueAction === 'record_refund' ? 'danger' : 'primary'" :loading="saving" @click="submitIssueDecision">
          {{ issueAction === "record_refund" ? "确认已退款并登记" : "确认处理" }}
        </el-button>
      </template>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  learningMaterialsApi,
  type LearningAdminOrderIssue,
  type LearningCommerceOrder,
  type LearningCreatorApplication,
  type LearningMaterialReview,
} from "@/api/learningMaterials";

const router = useRouter();
const loading = ref(false);
const saving = ref(false);
const tab = ref("creators");
const applications = ref<LearningCreatorApplication[]>([]);
const reviews = ref<LearningMaterialReview[]>([]);
const disputes = ref<LearningCommerceOrder[]>([]);
const issues = ref<LearningAdminOrderIssue[]>([]);
const reviewDialog = ref(false);
const reviewAction = ref<"approve" | "reject">("approve");
const activeReview = ref<LearningMaterialReview | null>(null);
const reviewReason = ref("");
const checklist = reactive({ rights: false, quality: false, fileSafety: false });
const issueDialog = ref(false);
const issueAction = ref<"resolve" | "close" | "record_refund">("resolve");
const activeIssue = ref<LearningAdminOrderIssue | null>(null);
const issueResolution = ref("");
const refundAmount = ref(0.01);

onMounted(load);

async function load() {
  loading.value = true;
  try {
    const [creatorRows, materialRows, orderRows, issueRows] = await Promise.all([
      learningMaterialsApi.adminCreatorApplications("submitted", { suppressErrorMessage: true }),
      learningMaterialsApi.adminMaterialReviews("submitted", { suppressErrorMessage: true }),
      learningMaterialsApi.orders("all", { suppressErrorMessage: true }),
      learningMaterialsApi.adminOrderIssues("active", { suppressErrorMessage: true }),
    ]);
    applications.value = creatorRows;
    reviews.value = materialRows;
    disputes.value = orderRows.filter((row) => row.status === "disputed");
    issues.value = issueRows;
  } finally {
    loading.value = false;
  }
}

async function reviewCreator(id: number, action: "approve" | "reject") {
  let reason = "";
  if (action === "reject") {
    const result = await ElMessageBox.prompt("请填写具体驳回原因，申请人将看到该说明。", "驳回创作者申请", {
      inputPattern: /\S{2,}/,
      inputErrorMessage: "请填写至少 2 个字符",
    });
    reason = result.value.trim();
  } else {
    await ElMessageBox.confirm("确认已核验申请人的领域、经验、样例说明和版权承诺？", "通过创作者认证");
  }
  await learningMaterialsApi.adminReviewCreator(id, { action, reason });
  ElMessage.success(action === "approve" ? "创作者认证已通过" : "创作者申请已驳回");
  await load();
}

function openMaterialReview(row: LearningMaterialReview, action: "approve" | "reject") {
  activeReview.value = row;
  reviewAction.value = action;
  reviewReason.value = "";
  Object.assign(checklist, { rights: false, quality: false, fileSafety: false });
  reviewDialog.value = true;
}

async function submitMaterialReview() {
  if (!activeReview.value) return;
  if (reviewAction.value === "approve" && !Object.values(checklist).every(Boolean)) {
    return ElMessage.warning("三项人工检查全部通过后才能批准上架");
  }
  if (reviewAction.value === "reject" && reviewReason.value.trim().length < 2) {
    return ElMessage.warning("驳回时请填写具体修改意见");
  }
  saving.value = true;
  try {
    await learningMaterialsApi.adminReviewMaterial(activeReview.value.id, {
      action: reviewAction.value,
      reason: reviewReason.value.trim(),
      checklist: { ...checklist },
    });
    reviewDialog.value = false;
    ElMessage.success(reviewAction.value === "approve" ? "资料已审核通过并公开上架" : "资料已驳回修改");
    await load();
  } finally {
    saving.value = false;
  }
}

function openIssueDecision(row: LearningAdminOrderIssue, action: "resolve" | "close" | "record_refund") {
  activeIssue.value = row;
  issueAction.value = action;
  issueResolution.value = "";
  refundAmount.value = Number(row.order.amount);
  issueDialog.value = true;
}

async function submitIssueDecision() {
  if (!activeIssue.value) return;
  const resolution = issueResolution.value.trim();
  if (resolution.length < 2) return ElMessage.warning("请填写至少 2 个字符的处理结果");
  const payload: {
    action: "resolve" | "close" | "record_refund";
    resolution: string;
    refundAmountCents?: number;
  } = { action: issueAction.value, resolution };
  if (issueAction.value === "record_refund") {
    payload.refundAmountCents = Math.round(Number(refundAmount.value) * 100);
    if (payload.refundAmountCents < 1 || payload.refundAmountCents > activeIssue.value.order.priceCents) {
      return ElMessage.warning("退款金额必须大于 0 且不能超过订单实付金额");
    }
  }
  saving.value = true;
  try {
    await learningMaterialsApi.adminDecideOrderIssue(
      activeIssue.value.commerceOrderId,
      activeIssue.value.id,
      payload,
    );
    issueDialog.value = false;
    ElMessage.success(issueAction.value === "record_refund" ? "退款已登记，资料访问权已撤销" : "售后记录已处理");
    await load();
  } finally {
    saving.value = false;
  }
}

function issueStatus(value: string) {
  return ({
    open: "待处理",
    waiting_buyer: "等待买家",
    waiting_seller: "等待卖家",
    refund_requested: "申请退款",
  } as Record<string, string>)[value] || value;
}

function formatDate(value?: string | null) {
  return value ? new Date(value).toLocaleString("zh-CN") : "—";
}
</script>

<style scoped>
.learning-admin{margin:16px 0;padding:18px}.learning-admin>header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}.learning-admin header span{color:#a21caf;font-size:9px;font-weight:800;letter-spacing:.15em}.learning-admin h3{margin:5px 0}.learning-admin header p{margin:0;color:var(--cpu-text-secondary);font-size:12px}.queue-counts{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:16px 0}.queue-counts article{display:flex;flex-direction:column;padding:13px;border-radius:10px;background:var(--cpu-surface-soft)}.queue-counts b{color:#a21caf;font-size:23px}.queue-counts span,.el-table small{color:var(--cpu-text-secondary);font-size:10px}.el-table b,.el-table small{display:block}.el-table a{color:var(--cpu-primary);text-decoration:none}.file-list{display:flex;flex-direction:column;gap:3px;font-size:10px}.el-dialog .el-checkbox{display:flex;margin:14px 0}.el-dialog .el-textarea{margin-top:10px}@media(max-width:900px){.queue-counts{grid-template-columns:repeat(2,1fr)}}@media(max-width:700px){.learning-admin>header{flex-direction:column}.queue-counts{grid-template-columns:1fr}}
</style>
