<template>
  <div class="support-page">
    <header class="support-head">
      <div><span>CONTENT SUPPORT</span><h1>资料问题反馈</h1><p>反馈与领取记录和资料版本绑定，便于创作者或平台定位问题。</p></div>
      <div><el-button @click="router.push({ name: 'market-learning-material-library' })">我的资料库</el-button><el-button @click="load">刷新</el-button></div>
    </header>

    <el-alert type="info" show-icon :closable="false" title="免费领取后可在这里反馈文件、内容、版本或版权问题；请勿填写手机号、微信、QQ 或其他私下联系方式。" />

    <div class="support-layout" v-loading="loading">
      <aside class="ticket-list cpu-card">
        <div class="aside-title"><b>反馈记录</b><span>{{ tickets.length }}</span></div>
        <button v-for="ticket in tickets" :key="ticket.id" type="button" :class="{ active: selected?.id === ticket.id }" @click="selectTicket(ticket.id)">
          <div><strong>{{ ticket.order?.item?.title || `领取记录 #${ticket.orderId}` }}</strong><em :class="`status-${ticket.status}`">{{ statusLabel(ticket.status) }}</em></div>
          <span>{{ categoryLabel(ticket.category) }} · {{ formatTime(ticket.updatedAt) }}</span>
        </button>
        <el-empty v-if="!tickets.length" :image-size="70" description="暂无资料反馈" />
      </aside>

      <main class="support-main cpu-card">
        <section v-if="showCreate" class="create-ticket">
          <span>NEW CONTENT FEEDBACK</span><h2>发起资料反馈</h2>
          <p>领取记录 #{{ orderId }}。请只描述与该资料相关的问题，不要填写手机号、微信、QQ 或外链。</p>
          <el-form label-position="top">
            <el-form-item label="问题类型" required><el-select v-model="createForm.category" placeholder="选择问题类型"><el-option v-for="option in meta.supportCategories" :key="option.value" :label="option.label" :value="option.value"><span>{{ option.label }}</span></el-option></el-select></el-form-item>
            <el-form-item label="问题描述" required><el-input v-model="createForm.message" type="textarea" :rows="7" maxlength="2000" show-word-limit placeholder="说明无法下载、文件缺失、内容与描述不符等具体情况" /></el-form-item>
            <el-button type="primary" :loading="submitting" @click="createTicket">提交反馈</el-button>
          </el-form>
        </section>

        <section v-else-if="selected" class="ticket-detail">
          <header>
            <div><span>{{ categoryLabel(selected.category) }}</span><h2>{{ selected.order?.item?.title || `领取记录 #${selected.orderId}` }}</h2><p>领取编号 {{ selected.order?.outTradeNo }} · {{ participantLabel }}</p></div>
            <el-tag effect="plain" :type="statusType(selected.status)">{{ statusLabel(selected.status) }}</el-tag>
          </header>
          <div class="ticket-facts"><span>反馈单 #{{ selected.id }}</span><span>创建于 {{ formatTime(selected.createdAt) }}</span><span v-if="selected.responseDueAt">创作者应于 {{ formatTime(selected.responseDueAt) }} 前回复</span></div>
          <div class="message-list">
            <article v-for="message in selected.messages || []" :key="message.id" :class="{ mine: message.senderId === auth.user?.id, system: message.kind === 'system' }">
              <template v-if="message.kind === 'system'"><span>{{ message.content }}</span></template>
              <template v-else><header><b>{{ message.sender?.nickname || message.sender?.username || '平台用户' }}</b><time>{{ formatTime(message.createdAt) }}</time></header><p>{{ message.content }}</p></template>
            </article>
          </div>
          <div v-if="selected.status !== 'closed'" class="composer">
            <el-input v-model="message" type="textarea" :rows="4" maxlength="2000" show-word-limit placeholder="继续说明问题或回复处理方案（禁止发送联系方式和外链）" />
            <div><span>所有消息都会作为问题定位与处理依据。</span><el-button type="primary" :loading="submitting" @click="sendMessage">发送回复</el-button></div>
          </div>
          <footer class="ticket-actions">
            <el-button v-if="selected.status === 'resolved' && isBuyer" @click="updateTicket('reopen')">问题仍未解决</el-button>
            <el-button v-if="selected.status !== 'resolved'" type="success" plain @click="updateTicket('resolve')">{{ isBuyer || isStaff ? '确认问题已解决' : '提交处理结果' }}</el-button>
            <el-button v-if="isBuyer && !['resolved','escalated','closed'].includes(selected.status)" type="danger" plain @click="updateTicket('escalate')">申请平台介入</el-button>
          </footer>
        </section>

        <el-empty v-else :description="sellerEntry ? '领取同学尚未就该资料发起反馈' : '从左侧选择反馈记录，或从资料库发起反馈'" />
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import { learningMaterialsApi, type LearningMaterialMeta, type LearningMaterialSupportTicket } from "@/api/learningMaterials";
import { useAuthStore } from "@/stores/auth";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const loading = ref(false);
const submitting = ref(false);
const tickets = ref<LearningMaterialSupportTicket[]>([]);
const selected = ref<LearningMaterialSupportTicket | null>(null);
const message = ref("");
const orderId = computed(() => Number(route.query.order || 0));
const ticketId = computed(() => Number(route.query.ticket || 0));
const sellerEntry = computed(() => route.query.side === "seller");
const showCreate = computed(() => Boolean(orderId.value) && !sellerEntry.value && !tickets.value.some((ticket) => ticket.orderId === orderId.value));
const isBuyer = computed(() => selected.value?.buyerId === auth.user?.id);
const isStaff = computed(() => ["admin", "mod"].includes(auth.user?.role || ""));
const participantLabel = computed(() => isBuyer.value ? `创作者：${selected.value?.seller?.nickname || selected.value?.seller?.username || "—"}` : `领取同学：${selected.value?.buyer?.nickname || selected.value?.buyer?.username || "—"}`);
const meta = reactive<LearningMaterialMeta>({ category: { id: 0, slug: "digital_goods", name: "电子资料", icon: "📚", description: "", fulfillmentType: "digital", imageRequired: false, enabled: true, sort: 0, itemCount: 0 }, semesters: [], formats: [], languages: [], originalityOptions: [], supportCategories: [], types: [], legacyIncompleteCount: 0 });
const createForm = reactive({ category: "", message: "" });

onMounted(load);

async function load() {
  loading.value = true;
  try {
    const [list, nextMeta] = await Promise.all([learningMaterialsApi.supportTickets({ suppressErrorMessage: true }), learningMaterialsApi.meta({ suppressErrorMessage: true })]);
    tickets.value = list;
    Object.assign(meta, nextMeta);
    if (!createForm.category) createForm.category = meta.supportCategories[0]?.value || "usage";
    const wanted = ticketId.value || tickets.value.find((ticket) => ticket.orderId === orderId.value)?.id || selected.value?.id || tickets.value[0]?.id;
    if (wanted) await selectTicket(wanted, false);
    else selected.value = null;
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "资料反馈加载失败");
  } finally { loading.value = false; }
}

async function selectTicket(id: number, updateRoute = true) {
  selected.value = await learningMaterialsApi.support(id, { suppressErrorMessage: true });
  if (updateRoute) await router.replace({ name: "market-learning-material-support", query: { ticket: String(id) } });
}

async function createTicket() {
  if (!orderId.value) return;
  if (!createForm.category || createForm.message.trim().length < 2) return ElMessage.warning("请选择问题类型并完整描述问题");
  submitting.value = true;
  try {
    const ticket = await learningMaterialsApi.createSupport(orderId.value, { category: createForm.category, message: createForm.message.trim() });
    createForm.message = "";
    ElMessage.success("资料反馈已创建，平台已通知创作者");
    await router.replace({ name: "market-learning-material-support", query: { ticket: String(ticket.id) } });
    await load();
  } finally { submitting.value = false; }
}

async function sendMessage() {
  if (!selected.value || !message.value.trim()) return ElMessage.warning("请填写回复内容");
  submitting.value = true;
  try {
    await learningMaterialsApi.sendSupportMessage(selected.value.id, message.value.trim());
    message.value = "";
    await selectTicket(selected.value.id, false);
  } finally { submitting.value = false; }
}

async function updateTicket(action: "resolve" | "reopen" | "escalate") {
  const copy = action === "escalate" ? "平台介入后，管理员将根据领取记录、资料版本与沟通记录核查处理。" : action === "resolve" ? "确认该问题已经解决？" : "确认重新开启资料反馈？";
  await ElMessageBox.confirm(copy, action === "escalate" ? "申请平台介入" : "确认操作", { type: action === "escalate" ? "warning" : "info" });
  if (!selected.value) return;
  selected.value = await learningMaterialsApi.updateSupport(selected.value.id, action);
  await load();
  ElMessage.success("反馈状态已更新");
}

function categoryLabel(value: string) { return meta.supportCategories.find((option) => option.value === value)?.label || value; }
function statusLabel(value: string) { return ({ waiting_seller: "等待创作者", waiting_buyer: "等待领取者", escalated: "平台介入", resolved: "已解决", closed: "已关闭" } as Record<string, string>)[value] || value; }
function statusType(value: string) { if (value === "resolved") return "success"; if (value === "escalated") return "danger"; if (value === "waiting_seller") return "warning"; return "info"; }
function formatTime(value?: string | null) { return value ? new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"; }
</script>

<style scoped>
.support-page{max-width:1180px;margin:0 auto;display:flex;flex-direction:column;gap:17px}.support-head{display:flex;align-items:flex-end;justify-content:space-between;gap:20px}.support-head>div:last-child{display:flex;gap:8px}.support-head span,.create-ticket>span{color:#a21caf;font-size:9px;font-weight:800;letter-spacing:.16em}.support-head h1{margin:5px 0;font-size:30px}.support-head p,.create-ticket>p{margin:0;color:var(--cpu-text-secondary);font-size:11px}.support-layout{display:grid;grid-template-columns:310px minmax(0,1fr);gap:15px;min-height:600px}.ticket-list{padding:10px}.aside-title{display:flex;justify-content:space-between;padding:8px 9px 13px}.aside-title span{color:var(--cpu-text-secondary)}.ticket-list button{width:100%;padding:12px;border:0;border-radius:10px;background:transparent;color:inherit;text-align:left;cursor:pointer}.ticket-list button+button{margin-top:4px}.ticket-list button:hover,.ticket-list button.active{background:var(--cpu-primary-soft)}.ticket-list button div{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}.ticket-list strong{overflow:hidden;font-size:11px;text-overflow:ellipsis;white-space:nowrap}.ticket-list em{flex:none;padding:2px 5px;border-radius:5px;background:var(--cpu-surface-soft);font-size:8px;font-style:normal}.ticket-list button>span{display:block;margin-top:6px;color:var(--cpu-text-secondary);font-size:8px}.support-main{padding:22px}.create-ticket{max-width:650px;margin:15px auto}.create-ticket h2{margin:7px 0}.create-ticket>p{margin-bottom:22px;line-height:1.7}.create-ticket small{float:right;color:#dc2626}.ticket-detail>header{display:flex;align-items:flex-start;justify-content:space-between;gap:15px;padding-bottom:14px;border-bottom:1px solid var(--cpu-border-soft)}.ticket-detail>header span{color:#a21caf;font-size:9px}.ticket-detail h2{margin:5px 0;font-size:20px}.ticket-detail header p{margin:0;color:var(--cpu-text-secondary);font-size:9px}.ticket-facts{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}.ticket-facts span{padding:4px 7px;border-radius:6px;background:var(--cpu-surface-soft);color:var(--cpu-text-secondary);font-size:8px}.message-list{display:flex;flex-direction:column;gap:9px;min-height:250px;padding:15px 0}.message-list article{align-self:flex-start;max-width:78%;padding:10px 12px;border-radius:3px 12px 12px 12px;background:var(--cpu-surface-soft)}.message-list article.mine{align-self:flex-end;border-radius:12px 3px 12px 12px;background:var(--cpu-primary-soft)}.message-list article.system{align-self:center;max-width:90%;padding:5px 9px;border-radius:20px;color:var(--cpu-text-secondary);font-size:8px;text-align:center}.message-list header{display:flex;justify-content:space-between;gap:20px}.message-list b{font-size:9px}.message-list time{color:var(--cpu-text-secondary);font-size:8px}.message-list p{margin:6px 0 0;white-space:pre-wrap;font-size:10px;line-height:1.7}.composer{padding-top:14px;border-top:1px solid var(--cpu-border-soft)}.composer>div{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:8px}.composer span{color:var(--cpu-text-secondary);font-size:8px}.ticket-actions{display:flex;justify-content:flex-end;gap:7px;margin-top:15px}@media(max-width:760px){.support-head{align-items:flex-start;flex-direction:column}.support-layout{grid-template-columns:1fr}.ticket-list{max-height:280px;overflow:auto}.support-main{padding:15px}.message-list article{max-width:90%}}
</style>
