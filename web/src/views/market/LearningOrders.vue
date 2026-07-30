<template>
  <div class="orders-page" v-loading="loading">
    <header class="page-head">
      <div>
        <span>LEARNING ORDERS</span>
        <h1>{{ isEnglish ? "Learning Material Orders" : "学习资料订单" }}</h1>
        <p>{{ isEnglish ? "Buyers pay creators directly; the platform records evidence, confirmation, and delivery." : "资料款由买家直接支付给资料发布者；平台记录凭证、确认与交付过程。" }}</p>
      </div>
      <div>
        <el-button @click="router.push({ name: 'market-learning-materials' })">{{ isEnglish ? "Browse materials" : "浏览资料" }}</el-button>
        <el-button type="primary" @click="router.push({ name: 'market-learning-creator' })">{{ isEnglish ? "Creator Center" : "资料发布中心" }}</el-button>
      </div>
    </header>

    <el-tabs v-model="side" @tab-change="changeSide">
      <el-tab-pane :label="isEnglish ? 'My purchases' : '我购买的'" name="buyer" />
      <el-tab-pane :label="isEnglish ? 'My sales' : '我出售的'" name="seller" />
    </el-tabs>

    <div class="order-layout">
      <aside class="order-list">
        <article
          v-for="row in orders"
          :key="row.id"
          :class="['cpu-card', { active: selected?.id === row.id }]"
          @click="openOrder(row.id)"
        >
          <img v-if="row.order.item.cover" :src="row.order.item.cover" :alt="row.order.item.title" />
          <div class="cover-fallback" v-else>KAOPU</div>
          <div>
            <span>{{ row.order.item.courseCode || (isEnglish ? "Learning material" : "学习资料") }}</span>
            <b>{{ row.order.item.title }}</b>
            <small>{{ formatDate(row.createdAt) }} · ¥{{ row.amount }}</small>
          </div>
          <el-tag :type="statusType(row.status)" size="small">{{ statusLabel(row.status) }}</el-tag>
        </article>
        <el-empty v-if="!orders.length && !loading" :description="isEnglish ? 'No learning material orders' : '暂无学习资料订单'" />
      </aside>

      <main v-if="selected" class="order-detail cpu-card">
        <section class="order-summary">
          <div>
            <span>{{ selected.order.item.courseCode || (isEnglish ? "Learning material" : "学习资料") }}</span>
            <h2>{{ selected.order.item.title }}</h2>
            <p>{{ isEnglish ? "Order" : "订单号" }} {{ selected.order.outTradeNo }}</p>
          </div>
          <div class="amount">
            <small>{{ isEnglish ? "Order total" : "订单金额" }}</small>
            <strong>¥{{ selected.amount }}</strong>
            <el-tag :type="statusType(selected.status)">{{ statusLabel(selected.status) }}</el-tag>
          </div>
        </section>

        <el-steps :active="stepActive" finish-status="success" align-center>
          <el-step :title="isEnglish ? 'Order created' : '创建订单'" />
          <el-step :title="isEnglish ? 'Payment evidence' : '提交付款凭证'" />
          <el-step :title="isEnglish ? 'Seller confirms and delivers' : '卖家确认并交付'" />
          <el-step :title="isEnglish ? 'Completed' : '完成'" />
        </el-steps>

        <section v-if="selected.status === 'pending_payment' && selected.mine.buyer" class="payment-panel">
          <div>
            <h3>{{ isEnglish ? "Pay the creator" : "向资料发布者付款" }}</h3>
            <p>{{ isEnglish ? "Verify the payment provider and amount. After paying, upload a genuine screenshot and wait for the seller to confirm receipt." : "请核对收款平台和金额。付款后必须上传真实付款截图，等待卖家确认到账。" }}</p>
            <dl>
              <div><dt>{{ isEnglish ? "Provider" : "收款平台" }}</dt><dd>{{ providerLabel(selected.collectionMethod?.provider) }}</dd></div>
              <div><dt>{{ isEnglish ? "Payment note" : "收款备注" }}</dt><dd>{{ selected.collectionMethod?.label || (isEnglish ? "Creator's own collection QR code" : "资料发布者本人收款码") }}</dd></div>
              <div><dt>{{ isEnglish ? "Amount due" : "应付金额" }}</dt><dd>¥{{ selected.amount }}</dd></div>
              <div><dt>{{ isEnglish ? "Payment deadline" : "付款期限" }}</dt><dd>{{ formatDate(selected.paymentDueAt) }}</dd></div>
            </dl>
          </div>
          <img v-if="selected.collectionMethod?.qrImageUrl" :src="selected.collectionMethod.qrImageUrl" :alt="isEnglish ? 'Creator collection QR code' : '资料发布者收款码'" />
        </section>

        <section v-if="latestEvidence" class="evidence-panel">
          <div>
            <h3>{{ isEnglish ? "Payment evidence" : "付款凭证" }}</h3>
            <p>{{ isEnglish ? `Attempt ${latestEvidence.attempt}` : `第 ${latestEvidence.attempt} 次提交` }} · {{ formatDate(latestEvidence.createdAt) }}</p>
            <dl>
              <div><dt>{{ isEnglish ? "Status" : "状态" }}</dt><dd>{{ evidenceStatus(latestEvidence.status) }}</dd></div>
              <div><dt>{{ isEnglish ? "Buyer note" : "买家备注" }}</dt><dd>{{ latestEvidence.buyerNote || (isEnglish ? "None" : "无") }}</dd></div>
              <div v-if="latestEvidence.handledReason"><dt>{{ isEnglish ? "Handling note" : "处理说明" }}</dt><dd>{{ latestEvidence.handledReason }}</dd></div>
            </dl>
          </div>
          <img v-if="latestEvidence.imageUrl" :src="latestEvidence.imageUrl" :alt="isEnglish ? 'Payment evidence' : '付款凭证'" />
        </section>

        <el-alert
          v-if="selected.status === 'awaiting_seller_confirmation'"
          type="warning"
          :closable="false"
          show-icon
          :title="selected.mine.seller || selected.mine.staff ? (isEnglish ? 'Check the payment evidence and dispute records. Deliver only after confirming actual receipt.' : '请核对收款凭证与争议记录，确认真实到账后再交付资料。') : (isEnglish ? `The seller should finish checking by ${formatDate(selected.sellerResponseDueAt)}.` : `卖家最晚应在 ${formatDate(selected.sellerResponseDueAt)} 前完成核对。`)"
        />
        <el-alert
          v-if="selected.status === 'disputed'"
          type="error"
          :closable="false"
          show-icon
          :title="isEnglish ? 'The order is in dispute resolution. The platform will manually review payment evidence and both parties’ statements.' : '订单已转入争议处理，平台将根据付款凭证与双方说明人工核验。'"
        />

        <section v-if="canDownload" class="files-panel">
          <header>
            <div><h3>{{ isEnglish ? "Full material unlocked" : "完整资料已解锁" }}</h3><p>{{ isEnglish ? "This order is linked to version" : "当前订单绑定版本" }} {{ selected.version.label || `v${selected.version.versionNumber}` }}。</p></div>
            <el-button @click="router.push({ name: 'market-learning-material-library' })">{{ isEnglish ? "Open library" : "进入资料库" }}</el-button>
          </header>
          <div>
            <article v-for="file in selected.version.files" :key="file.id">
              <b>{{ file.originalName }}</b>
              <span>{{ file.format }} · {{ formatBytes(file.fileSize) }}</span>
              <div><a v-if="file.format==='PDF'" :href="learningMaterialsApi.viewUrl(file.id)" target="_blank" rel="noopener">{{ isEnglish ? "Watermarked view" : "带水印阅读" }}</a><a :href="learningMaterialsApi.downloadUrl(file.id)">{{ isEnglish ? "Download" : "下载" }}</a></div>
            </article>
          </div>
        </section>

        <section v-if="selected.issues.length" class="issues-panel">
          <h3>{{ isEnglish ? "Support and disputes" : "售后与争议" }}</h3>
          <article v-for="issue in selected.issues" :key="issue.id">
            <el-tag :type="['resolved', 'closed', 'refund_recorded'].includes(issue.status) ? 'success' : 'warning'">{{ issue.status }}</el-tag>
            <div><b>{{ issue.reason }}</b><p>{{ issue.detail }}</p><small v-if="issue.slaDueAt">{{ isEnglish ? "Response deadline:" : "响应时限：" }}{{ formatDate(issue.slaDueAt) }}<template v-if="issue.overdue"> · {{ isEnglish ? "Overdue" : "已超时" }}</template></small><div v-if="issue.messages.length" class="issue-thread"><p v-for="message in issue.messages" :key="message.id"><b>{{ message.kind==='staff'?(isEnglish?'Platform staff':'平台运营'):message.sender?.nickname||(isEnglish?'Order participant':'订单参与方') }}</b>：{{ message.content }}<a v-if="message.attachment" :href="message.attachment.imageUrl" target="_blank" rel="noopener">{{ isEnglish ? "View " : "查看" }}{{ message.attachment.kind==='refund_evidence'?(isEnglish?'refund evidence':'退款凭证'):(isEnglish?'evidence':'证据') }}</a></p></div><small v-if="issue.resolution">{{ isEnglish ? "Outcome" : "处理结果" }}（{{ responsibilityLabel(issue.responsibility) }}）：{{ issue.resolution }}</small><el-button v-if="!['resolved','closed','refund_recorded'].includes(issue.status)" size="small" text type="primary" @click="openIssueMessage(issue.id)">{{ isEnglish ? "Add note / evidence" : "补充说明 / 证据" }}</el-button></div>
          </article>
        </section>

        <footer class="order-actions">
          <template v-if="selected.mine.buyer">
            <el-button v-if="selected.status === 'pending_payment'" type="primary" @click="evidenceDialog = true">{{ isEnglish ? "Paid — upload evidence" : "已付款，上传凭证" }}</el-button>
            <el-button v-if="selected.status === 'pending_payment'" @click="cancelOrder">{{ isEnglish ? "Cancel order" : "取消订单" }}</el-button>
            <el-button v-if="selected.status === 'delivered'" type="success" @click="completeOrder">{{ isEnglish ? "Confirm material is correct" : "确认资料无误" }}</el-button>
            <el-button v-if="selected.status === 'completed'" type="primary" plain @click="openRating">{{ isEnglish ? "Review material" : "评价资料" }}</el-button>
          </template>
          <template v-if="(selected.mine.seller || selected.mine.staff) && ['awaiting_seller_confirmation', 'disputed'].includes(selected.status) && latestEvidence?.status === 'submitted'">
            <el-button type="success" @click="confirmEvidence">{{ isEnglish ? "Confirm receipt and deliver" : "确认到账并交付" }}</el-button>
            <el-button type="danger" plain @click="rejectEvidence">{{ isEnglish ? "Not received / evidence mismatch" : "未到账 / 凭证不符" }}</el-button>
          </template>
          <el-button v-if="canOpenIssue" plain type="warning" @click="openIssue">{{ isEnglish ? "Open support or dispute" : "发起售后或争议" }}</el-button>
          <el-button @click="refreshSelected">{{ isEnglish ? "Refresh status" : "刷新状态" }}</el-button>
        </footer>

        <section class="timeline">
          <h3>{{ isEnglish ? "Order timeline" : "订单记录" }}</h3>
          <el-timeline>
            <el-timeline-item v-for="event in selected.events" :key="event.id" :timestamp="formatDate(event.createdAt)">
              {{ eventLabel(event.type) }}
            </el-timeline-item>
          </el-timeline>
        </section>
      </main>
      <el-empty v-else class="detail-empty" :description="isEnglish ? 'Select an order to view payment and delivery details' : '选择一笔订单查看付款和交付详情'" />
    </div>

    <el-dialog v-model="evidenceDialog" :title="isEnglish ? 'Upload payment evidence' : '上传付款凭证'" width="520px">
      <el-alert type="warning" :closable="false" show-icon :title="isEnglish ? 'Do not forge or reuse payment screenshots. Sellers must confirm only after actual receipt.' : '请勿伪造或重复使用付款截图。卖家只应在实际到账后确认。'" />
      <el-form label-position="top">
        <el-form-item :label="isEnglish ? 'Payment screenshot' : '付款截图'">
          <label class="evidence-picker">
            <input type="file" accept="image/png,image/jpeg,image/webp" @change="pickEvidence" />
            <img v-if="evidencePreview" :src="evidencePreview" :alt="isEnglish ? 'Payment screenshot preview' : '付款截图预览'" />
            <span v-else>{{ isEnglish ? "Choose a PNG, JPEG, or WebP image up to 5 MB" : "选择 PNG、JPEG 或 WebP 图片，最大 5MB" }}</span>
          </label>
        </el-form-item>
        <el-form-item :label="isEnglish ? 'Payment note (optional)' : '付款备注（选填）'">
          <el-input v-model="evidenceNote" maxlength="300" :placeholder="isEnglish ? 'Example: payment time or account suffix to help the seller verify' : '例如付款时间、付款账户尾号等便于卖家核对的信息'" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="evidenceDialog = false">{{ isEnglish ? "Cancel" : "取消" }}</el-button>
        <el-button type="primary" :loading="submittingEvidence" @click="submitEvidence">{{ isEnglish ? "Submit evidence" : "提交凭证" }}</el-button>
      </template>
    </el-dialog>
    <el-dialog v-model="ratingDialog" :title="isEnglish ? 'Verified purchase review' : '已购资料评价'" width="560px"><el-form label-position="left" label-width="120px"><el-form-item :label="isEnglish ? 'Accuracy' : '内容准确'"><el-rate v-model="rating.accuracy" /></el-form-item><el-form-item :label="isEnglish ? 'Usefulness' : '学习实用性'"><el-rate v-model="rating.usefulness" /></el-form-item><el-form-item :label="isEnglish ? 'Description match' : '描述相符'"><el-rate v-model="rating.descriptionMatch" /></el-form-item><el-form-item :label="isEnglish ? 'File quality' : '文件质量'"><el-rate v-model="rating.fileQuality" /></el-form-item><el-form-item :label="isEnglish ? 'Written review' : '文字评价'"><el-input v-model="rating.content" type="textarea" :rows="4" maxlength="2000" show-word-limit /></el-form-item></el-form><template #footer><el-button @click="ratingDialog=false">{{ isEnglish ? "Cancel" : "取消" }}</el-button><el-button type="primary" @click="submitRating">{{ isEnglish ? "Publish verified review" : "发布已购评价" }}</el-button></template></el-dialog>
    <el-dialog v-model="issueMessageDialog" :title="isEnglish ? 'Add support details and evidence' : '补充售后说明与证据'" width="520px"><el-input v-model="issueMessage" type="textarea" :rows="4" maxlength="2000" show-word-limit :placeholder="isEnglish ? 'Describe the facts, timing, and requested outcome' : '说明事实、时间和诉求'" /><el-select v-if="selected?.mine.seller||selected?.mine.staff" v-model="issueAttachmentKind" style="width:100%;margin-top:12px"><el-option :label="isEnglish ? 'Issue evidence' : '问题证据'" value="dispute_attachment" /><el-option :label="isEnglish ? 'Refund evidence' : '已退款凭证'" value="refund_evidence" /></el-select><label class="issue-file-picker"><input type="file" accept="image/png,image/jpeg,image/webp" @change="pickIssueEvidence" /><span>{{ issueEvidence?.name || (isEnglish ? "Choose evidence image (optional, up to 5 MB)" : "选择证据图片（可选，最大 5MB）") }}</span></label><template #footer><el-button @click="issueMessageDialog=false">{{ isEnglish ? "Cancel" : "取消" }}</el-button><el-button type="primary" @click="sendIssueMessage">{{ isEnglish ? "Submit additional material" : "提交补充材料" }}</el-button></template></el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import { useLocale } from "@/i18n";
import {
  learningMaterialsApi,
  type LearningCommerceOrder,
  type LearningCommerceOrderStatus,
  type LearningPaymentEvidence,
} from "@/api/learningMaterials";

const route = useRoute();
const router = useRouter();
const { isEnglish, locale } = useLocale();
const side = ref<"buyer" | "seller">(route.query.side === "seller" ? "seller" : "buyer");
const orders = ref<LearningCommerceOrder[]>([]);
const selected = ref<LearningCommerceOrder | null>(null);
const loading = ref(false);
const evidenceDialog = ref(false);
const evidenceFile = ref<File | null>(null);
const evidencePreview = ref("");
const evidenceNote = ref("");
const submittingEvidence = ref(false);
const ratingDialog = ref(false);
const rating = reactive({ accuracy: 5, usefulness: 5, descriptionMatch: 5, fileQuality: 5, content: "" });
const issueMessageDialog = ref(false);
const issueMessageId = ref(0);
const issueMessage = ref("");
const issueEvidence = ref<File | null>(null);
const issueAttachmentKind = ref<"dispute_attachment" | "refund_evidence">("dispute_attachment");

const latestEvidence = computed<LearningPaymentEvidence | null>(() => selected.value?.paymentEvidence?.[0] || null);
const canDownload = computed(() => Boolean(selected.value && ["delivered", "completed"].includes(selected.value.status)));
const canOpenIssue = computed(() => Boolean(selected.value && !["refunded", "cancelled", "expired"].includes(selected.value.status)));
const stepActive = computed(() => {
  const status = selected.value?.status;
  if (status === "completed" || status === "refunded") return 4;
  if (status === "delivered") return 3;
  if (status === "awaiting_seller_confirmation" || status === "disputed") return 2;
  return 1;
});

onMounted(load);
onBeforeUnmount(clearEvidencePreview);
watch(() => route.params.id, async (value) => {
  if (value) await loadSelected(Number(value));
});

async function load() {
  loading.value = true;
  try {
    orders.value = await learningMaterialsApi.orders(side.value, { suppressErrorMessage: true });
    const requestedId = Number(route.params.id || 0);
    if (requestedId) await loadSelected(requestedId);
    else selected.value = orders.value[0] || null;
  } finally {
    loading.value = false;
  }
}

async function loadSelected(id: number) {
  if (!Number.isInteger(id) || id < 1) return;
  selected.value = await learningMaterialsApi.order(id, { suppressErrorMessage: true });
  const index = orders.value.findIndex((row) => row.id === id);
  if (index >= 0) orders.value[index] = selected.value;
}

async function refreshSelected() {
  if (selected.value) await loadSelected(selected.value.id);
}

async function openOrder(id: number) {
  await router.push({ name: "market-learning-order-detail", params: { id }, query: { side: side.value } });
  await loadSelected(id);
}

async function changeSide(value: string | number) {
  side.value = value === "seller" ? "seller" : "buyer";
  await router.replace({ name: "market-learning-orders", query: { side: side.value } });
  await load();
}

function pickEvidence(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0] || null;
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) {
    input.value = "";
    return ElMessage.warning(isEnglish.value ? "The payment screenshot cannot exceed 5 MB" : "付款截图不能超过 5MB");
  }
  clearEvidencePreview();
  evidenceFile.value = file;
  evidencePreview.value = URL.createObjectURL(file);
}

function clearEvidencePreview() {
  if (evidencePreview.value) URL.revokeObjectURL(evidencePreview.value);
  evidencePreview.value = "";
}

async function submitEvidence() {
  if (!selected.value || !evidenceFile.value) return ElMessage.warning(isEnglish.value ? "Choose a payment screenshot" : "请选择付款截图");
  submittingEvidence.value = true;
  try {
    selected.value = await learningMaterialsApi.submitPaymentEvidence(selected.value.id, evidenceFile.value, {
      claimedPaidAt: new Date().toISOString(),
      buyerNote: evidenceNote.value.trim(),
    });
    ElMessage.success(isEnglish.value ? "Payment evidence submitted. Wait for the seller to verify receipt." : "付款凭证已提交，请等待卖家核对到账");
    evidenceDialog.value = false;
    evidenceFile.value = null;
    evidenceNote.value = "";
    clearEvidencePreview();
    await load();
  } finally {
    submittingEvidence.value = false;
  }
}

async function confirmEvidence() {
  if (!selected.value || !latestEvidence.value) return;
  await ElMessageBox.confirm(isEnglish.value ? "Deliver only after the funds are actually visible in your account. The buyer receives the full material immediately after confirmation." : "只有在你的收款账户确认真实到账后才能交付。确认后买家会立即获得完整资料。", isEnglish.value ? "Confirm receipt and deliver" : "确认到账并交付", { type: "warning" });
  selected.value = await learningMaterialsApi.confirmPaymentEvidence(selected.value.id, latestEvidence.value.id);
  ElMessage.success(isEnglish.value ? "Receipt confirmed. The full material has been delivered automatically." : "已确认到账，完整资料已自动交付");
  await load();
}

async function rejectEvidence() {
  if (!selected.value || !latestEvidence.value) return;
  const { value } = await ElMessageBox.prompt(isEnglish.value ? "Explain why payment was not received or the evidence does not match. The buyer will see this explanation." : "请具体说明未到账或凭证不符的原因，买家将看到此说明。", isEnglish.value ? "Reject payment evidence" : "驳回付款凭证", {
    inputPattern: /\S{2,}/,
    inputErrorMessage: isEnglish.value ? "Enter a reason of at least 2 characters" : "请填写至少 2 个字符的原因",
  });
  selected.value = await learningMaterialsApi.rejectPaymentEvidence(selected.value.id, latestEvidence.value.id, value.trim());
  ElMessage.success(isEnglish.value ? "Payment evidence rejected. The buyer may submit again." : "付款凭证已驳回，买家可以重新提交");
  await load();
}

async function completeOrder() {
  if (!selected.value) return;
  await ElMessageBox.confirm(isEnglish.value ? "Confirm that the material downloads correctly and matches its description?" : "确认资料可以正常下载且内容与介绍一致？", isEnglish.value ? "Complete order" : "确认订单完成");
  selected.value = await learningMaterialsApi.completeOrder(selected.value.id);
  ElMessage.success(isEnglish.value ? "Order completed" : "订单已完成");
  await load();
}

async function cancelOrder() {
  if (!selected.value) return;
  const { value } = await ElMessageBox.prompt(isEnglish.value ? "Enter a cancellation reason" : "请填写取消原因", isEnglish.value ? "Cancel order" : "取消订单", {
    inputValue: isEnglish.value ? "No longer needed" : "不再购买",
    inputPattern: /\S{2,}/,
    inputErrorMessage: isEnglish.value ? "Enter at least 2 characters" : "请填写至少 2 个字符",
  });
  selected.value = await learningMaterialsApi.cancelOrder(selected.value.id, value.trim());
  ElMessage.success(isEnglish.value ? "Order cancelled" : "订单已取消");
  await load();
}

async function openIssue() {
  if (!selected.value) return;
  const { value } = await ElMessageBox.prompt(isEnglish.value ? "Describe the payment, delivery, or content issue. It will be added to the order's support record." : "请说明遇到的付款、交付或内容问题。提交后订单将进入售后记录。", isEnglish.value ? "Open support or dispute" : "发起售后或争议", {
    inputPattern: /\S{5,}/,
    inputErrorMessage: isEnglish.value ? "Describe the issue in at least 5 characters" : "请填写至少 5 个字符的问题说明",
  });
  await learningMaterialsApi.openOrderIssue(selected.value.id, {
    type: ["awaiting_seller_confirmation", "disputed"].includes(selected.value.status) ? "payment" : "content",
    reason: value.trim(),
    detail: value.trim(),
  });
  ElMessage.success(isEnglish.value ? "Issue submitted" : "问题已提交");
  await refreshSelected();
}

function openRating() {
  const current = selected.value?.rating;
  Object.assign(rating, {
    accuracy: current?.accuracy ?? 5,
    usefulness: current?.usefulness ?? 5,
    descriptionMatch: current?.descriptionMatch ?? 5,
    fileQuality: current?.fileQuality ?? 5,
    content: current?.content ?? "",
  });
  ratingDialog.value = true;
}

async function submitRating() {
  if (!selected.value) return;
  const result = await learningMaterialsApi.rateOrder(selected.value.id, rating);
  ElMessage.success(result.status === "published" ? (isEnglish.value ? "Verified purchase review published" : "已发布真实购买评价") : (isEnglish.value ? "Review submitted and awaiting content review" : "评价已提交，正在等待内容复核"));
  ratingDialog.value = false;
  await refreshSelected();
}

function openIssueMessage(issueId: number) {
  issueMessageId.value = issueId;
  issueMessage.value = "";
  issueEvidence.value = null;
  issueAttachmentKind.value = "dispute_attachment";
  issueMessageDialog.value = true;
}

function pickIssueEvidence(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0] || null;
  if (file && file.size > 5 * 1024 * 1024) return ElMessage.warning(isEnglish.value ? "Evidence images cannot exceed 5 MB" : "证据图片不能超过 5MB");
  issueEvidence.value = file;
}

async function sendIssueMessage() {
  if (!selected.value || !issueMessageId.value) return;
  if (!issueMessage.value.trim() && !issueEvidence.value) return ElMessage.warning(isEnglish.value ? "Enter a note or choose an evidence image" : "请填写说明或选择证据图片");
  await learningMaterialsApi.sendOrderIssueMessage(selected.value.id, issueMessageId.value, {
    content: issueMessage.value.trim(),
    image: issueEvidence.value || undefined,
    attachmentKind: issueAttachmentKind.value,
  });
  ElMessage.success(isEnglish.value ? "Additional material added to the support evidence trail" : "补充材料已进入售后证据链");
  issueMessageDialog.value = false;
  await refreshSelected();
}

function responsibilityLabel(value: string) {
  const labels = isEnglish.value
    ? { buyer: "Buyer responsible", creator: "Creator responsible", platform: "Platform responsible", shared: "Shared responsibility", no_fault: "No-fault resolution", unassigned: "Pending decision" }
    : { buyer: "买家责任", creator: "资料发布者责任", platform: "平台责任", shared: "双方责任", no_fault: "无责处理", unassigned: "待认定" };
  return (labels as Record<string, string>)[value] || value;
}

function statusLabel(status: LearningCommerceOrderStatus) {
  const labels = isEnglish.value ? {
    pending_payment: "Awaiting payment",
    awaiting_seller_confirmation: "Awaiting seller",
    delivered: "Delivered",
    completed: "Completed",
    refunded: "Refunded",
    cancelled: "Cancelled",
    expired: "Expired",
    disputed: "In dispute",
  } : {
    pending_payment: "待付款",
    awaiting_seller_confirmation: "待卖家确认",
    delivered: "已交付",
    completed: "已完成",
    refunded: "已退款",
    cancelled: "已取消",
    expired: "已超时",
    disputed: "争议处理中",
  };
  return labels[status];
}

function statusType(status: LearningCommerceOrderStatus) {
  if (status === "completed" || status === "delivered") return "success";
  if (status === "disputed" || status === "refunded") return "danger";
  if (status === "pending_payment" || status === "awaiting_seller_confirmation") return "warning";
  return "info";
}

function evidenceStatus(status: LearningPaymentEvidence["status"]) {
  return (isEnglish.value
    ? { submitted: "Awaiting review", accepted: "Confirmed", rejected: "Rejected", superseded: "Replaced by newer evidence" }
    : { submitted: "待核对", accepted: "已确认", rejected: "已驳回", superseded: "已被新凭证替代" })[status];
}

function providerLabel(provider?: string) {
  return provider === "wechat" ? (isEnglish.value ? "WeChat Pay" : "微信支付") : provider === "alipay" ? (isEnglish.value ? "Alipay" : "支付宝") : (isEnglish.value ? "Not configured" : "未配置");
}

function eventLabel(type: string) {
  const labels = isEnglish.value ? {
    ORDER_CREATED: "Order created",
    PAYMENT_EVIDENCE_SUBMITTED: "Buyer submitted payment evidence",
    PAYMENT_EVIDENCE_REJECTED: "Seller rejected payment evidence",
    PAYMENT_CONFIRMED: "Seller confirmed receipt",
    ACCESS_GRANTED: "Full material unlocked",
    ORDER_DELIVERED: "Material delivered",
    ORDER_COMPLETED: "Buyer completed order",
    ORDER_AUTO_COMPLETED: "Order completed automatically",
    ORDER_CANCELLED: "Order cancelled",
    PAYMENT_TIMEOUT: "Payment deadline expired",
    ISSUE_OPENED: "Support case or dispute opened",
    ISSUE_MESSAGE_ADDED: "Support note or evidence added",
    ISSUE_RESOLVED: "Support issue resolved",
    ISSUE_CLOSED: "Support case closed",
    REFUND_RECORDED: "Refund recorded by administrator",
    SELLER_CONFIRMATION_TIMEOUT: "Seller confirmation timed out; dispute opened",
  } : {
    ORDER_CREATED: "订单已创建",
    PAYMENT_EVIDENCE_SUBMITTED: "买家已提交付款凭证",
    PAYMENT_EVIDENCE_REJECTED: "卖家驳回付款凭证",
    PAYMENT_CONFIRMED: "卖家确认到账",
    ACCESS_GRANTED: "系统已解锁完整资料",
    ORDER_DELIVERED: "资料已交付",
    ORDER_COMPLETED: "买家确认完成",
    ORDER_AUTO_COMPLETED: "订单到期自动完成",
    ORDER_CANCELLED: "订单已取消",
    PAYMENT_TIMEOUT: "订单付款超时",
    ISSUE_OPENED: "已发起售后或争议",
    ISSUE_MESSAGE_ADDED: "售后记录已补充说明或证据",
    ISSUE_RESOLVED: "售后问题已处理",
    ISSUE_CLOSED: "售后记录已关闭",
    REFUND_RECORDED: "管理员已登记退款",
    SELLER_CONFIRMATION_TIMEOUT: "卖家确认超时，转入争议处理",
  };
  return (labels as Record<string, string>)[type] || type;
}

function formatDate(value?: string | null) {
  return value ? new Date(value).toLocaleString(locale.value) : "—";
}

function formatBytes(value: number) {
  return value < 1024 * 1024 ? `${Math.max(1, Math.round(value / 1024))} KB` : `${(value / 1024 / 1024).toFixed(1)} MB`;
}
</script>

<style scoped>
.orders-page{max-width:1280px;margin:0 auto;display:flex;flex-direction:column;gap:15px}.page-head{display:flex;align-items:flex-start;justify-content:space-between;gap:20px}.page-head>div:last-child{display:flex;gap:8px}.page-head span{color:#a21caf;font-size:10px;font-weight:800;letter-spacing:.17em}.page-head h1{margin:6px 0;font-size:30px}.page-head p{margin:0;color:var(--cpu-text-secondary);font-size:12px}.order-layout{display:grid;grid-template-columns:390px 1fr;align-items:start;gap:15px}.order-list{display:flex;flex-direction:column;gap:9px}.order-list article{display:grid;grid-template-columns:68px 1fr auto;align-items:center;gap:10px;padding:10px;cursor:pointer}.order-list article.active{border-color:#c084fc;box-shadow:0 0 0 2px rgba(168,85,247,.08)}.order-list img,.cover-fallback{width:68px;height:68px;border-radius:9px;object-fit:cover}.cover-fallback{display:grid;place-items:center;color:#86198f;background:#fae8ff;font-size:10px;font-weight:800}.order-list article>div:nth-child(2){display:flex;min-width:0;flex-direction:column;gap:4px}.order-list span,.order-list small{color:var(--cpu-text-secondary);font-size:9px}.order-list b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}.order-detail{display:flex;flex-direction:column;gap:22px;padding:24px}.order-summary{display:flex;align-items:flex-start;justify-content:space-between;gap:20px}.order-summary span{color:#a21caf;font-size:10px;font-weight:700}.order-summary h2{margin:6px 0}.order-summary p{margin:0;color:var(--cpu-text-secondary);font-size:11px}.amount{display:flex;align-items:flex-end;flex-direction:column;gap:4px}.amount small{color:var(--cpu-text-secondary)}.amount strong{color:#be185d;font-size:28px}.payment-panel,.evidence-panel{display:grid;grid-template-columns:1fr 230px;gap:24px;padding:20px;border:1px solid #f0abfc;border-radius:14px;background:color-mix(in srgb,#fdf4ff 70%,var(--cpu-card))}.payment-panel h3,.evidence-panel h3,.files-panel h3,.issues-panel h3,.timeline h3{margin:0 0 6px}.payment-panel p,.evidence-panel p,.files-panel p{margin:0;color:var(--cpu-text-secondary);font-size:11px}.payment-panel>img,.evidence-panel>img{width:230px;height:230px;border-radius:12px;object-fit:contain;background:#fff}.payment-panel dl,.evidence-panel dl{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-top:18px}.payment-panel dl div,.evidence-panel dl div{display:flex;flex-direction:column;gap:4px}.payment-panel dt,.evidence-panel dt{color:var(--cpu-text-secondary);font-size:9px}.payment-panel dd,.evidence-panel dd{margin:0;font-size:12px;font-weight:700}.files-panel header{display:flex;align-items:flex-start;justify-content:space-between}.files-panel>div{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-top:12px}.files-panel a{display:grid;grid-template-columns:1fr auto;gap:3px 9px;padding:11px;border:1px solid var(--cpu-border-soft);border-radius:9px;color:inherit;text-decoration:none}.files-panel a b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px}.files-panel a span{color:var(--cpu-text-secondary);font-size:9px}.files-panel a em{grid-column:2;grid-row:1/3;align-self:center;color:#a21caf;font-size:10px;font-style:normal}.issues-panel article{display:flex;align-items:flex-start;gap:10px;padding:10px 0;border-top:1px solid var(--cpu-border-soft)}.issues-panel article div{display:flex;flex-direction:column;gap:3px}.issues-panel p{margin:0;color:var(--cpu-text-secondary);font-size:11px}.issues-panel small{color:#a21caf}.order-actions{display:flex;flex-wrap:wrap;gap:8px;padding-top:18px;border-top:1px solid var(--cpu-border-soft)}.timeline{padding-top:5px}.detail-empty{min-height:400px}.evidence-picker{display:grid;place-items:center;min-height:220px;border:1px dashed #c084fc;border-radius:12px;background:#fdf4ff;cursor:pointer}.evidence-picker input{display:none}.evidence-picker img{max-width:210px;max-height:210px;object-fit:contain}.evidence-picker span{color:#86198f;font-size:12px}@media(max-width:900px){.order-layout{grid-template-columns:1fr}.order-list{display:grid;grid-template-columns:repeat(2,1fr)}}@media(max-width:640px){.page-head,.order-summary,.files-panel header{flex-direction:column}.page-head>div:last-child{width:100%}.page-head .el-button{flex:1}.order-list{grid-template-columns:1fr}.order-detail{padding:16px}.payment-panel,.evidence-panel{grid-template-columns:1fr}.payment-panel>img,.evidence-panel>img{width:100%;height:auto;max-height:320px}.payment-panel dl,.evidence-panel dl,.files-panel>div{grid-template-columns:1fr}.amount{align-items:flex-start}}
.files-panel>div>article{display:grid;grid-template-columns:1fr auto;gap:3px 9px;padding:11px;border:1px solid var(--cpu-border-soft);border-radius:9px}.files-panel>div>article>b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px}.files-panel>div>article>span{color:var(--cpu-text-secondary);font-size:9px}.files-panel>div>article>div{grid-column:2;grid-row:1/3;display:flex;align-items:center;gap:8px}.files-panel>div>article a{padding:0;border:0;color:#a21caf;font-size:10px}.issue-thread{margin:8px 0;padding:8px;border-radius:8px;background:var(--cpu-surface-soft)}.issue-thread p{margin:3px 0!important}.issue-thread a{margin-left:5px;color:#a21caf}.issue-file-picker{display:block;margin-top:12px;padding:14px;border:1px dashed #c084fc;border-radius:10px;color:#86198f;cursor:pointer}.issue-file-picker input{display:none}
</style>
