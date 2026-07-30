<template>
  <div class="market-chat-page cpu-page">
    <header class="chat-head">
      <div>
        <el-button text @click="router.push({ name: 'market' })">← 返回市集</el-button>
        <h1>交易消息</h1>
        <p>有意向直接私聊；双方自行沟通和交付，只有双方都确认后系统才认定成交并发放积分。</p>
      </div>
      <el-tag :type="realtimeConnected ? 'success' : 'info'" effect="plain">{{ realtimeConnected ? "实时连接" : "自动同步" }}</el-tag>
    </header>

    <section class="chat-shell" v-loading="loading">
      <aside :class="{ hidden: selectedId && mobileConversation }">
        <div class="aside-title">
          <b>会话</b>
          <el-badge :value="totalUnread" :hidden="!totalUnread" />
        </div>
        <div class="conversation-tools">
          <el-input v-model="search" clearable placeholder="搜索用户、商品或消息" />
          <el-segmented v-model="filter" :options="filterOptions" />
        </div>
        <button
          v-for="conversation in conversations"
          :key="conversation.id"
          class="conversation"
          :class="{ active: conversation.id === selectedId }"
          @click="selectConversation(conversation.id)"
        >
          <el-badge :value="conversation.unreadCount" :hidden="!conversation.unreadCount">
            <el-avatar :size="42" :src="conversation.counterpart?.avatar || ''">{{ userInitial(conversation.counterpart) }}</el-avatar>
          </el-badge>
          <span>
            <strong>{{ conversation.counterpart?.nickname || "校园用户" }}</strong>
            <small>{{ conversation.item?.title }} · {{ conversationStatus(conversation) }}</small>
            <em>{{ lastMessageText(conversation) }}</em>
          </span>
          <time>{{ shortTime(conversation.lastMessageAt) }}</time>
        </button>
        <el-empty v-if="!loading && !conversations.length" description="当前筛选没有交易会话" />
      </aside>

      <main v-if="activeConversation" class="messages">
        <div class="message-head">
          <el-button class="mobile-back" text @click="mobileConversation = false">←</el-button>
          <img v-if="activeConversation.item?.cover" :src="activeConversation.item.cover" alt="" />
          <div>
            <strong>{{ activeConversation.item?.title }}</strong>
            <small>与 {{ activeConversation.counterpart?.nickname || "校园用户" }} 沟通 · {{ conversationStatus(activeConversation) }}</small>
          </div>
          <el-dropdown trigger="click">
            <el-button>更多</el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item @click="router.push({ name: 'market-item', params: { id: activeConversation!.itemId } })">查看商品</el-dropdown-item>
                <el-dropdown-item :class="{ danger: !activeConversation.blockedByMe }" divided @click="toggleBlock">
                  {{ activeConversation.blockedByMe ? "解除屏蔽" : "屏蔽对方" }}
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>

        <section class="trade-confirmation" :class="{ completed: tradeCompleted, closed: tradeClosedWithoutCompletion }">
          <div class="confirmation-copy">
            <b>{{ confirmationHeadline }}</b>
            <span>{{ confirmationDescription }}</span>
          </div>
          <div class="party-confirmations" aria-label="买卖双方成交确认状态">
            <span :class="{ confirmed: buyerConfirmed }">买家 {{ buyerConfirmed ? "已确认" : "待确认" }}</span>
            <span :class="{ confirmed: sellerConfirmed }">卖家 {{ sellerConfirmed ? "已确认" : "待确认" }}</span>
          </div>
          <el-button v-if="canConfirm" type="success" :loading="confirming" @click="confirmCompleted">确认实际成交</el-button>
        </section>

        <div ref="messageList" class="message-list">
          <div class="history-loader">
            <el-button v-if="nextCursor" text type="primary" :loading="loadingOlder" @click="loadOlder">加载更早消息</el-button>
            <span v-else-if="messages.length">已经到最早一条</span>
          </div>
          <template v-for="message in messages" :key="message.clientMessageId || message.id">
            <div v-if="message.kind === 'system'" class="system-message">
              <span>{{ message.content }}</span><time>{{ fullTime(message.createdAt) }}</time>
            </div>
            <div v-else class="bubble-row" :class="{ mine: message.senderId === auth.user?.id, failed: message._state === 'failed' }">
              <el-avatar :size="32" :src="message.sender?.avatar || ''">{{ userInitial(message.sender) }}</el-avatar>
              <div>
                <div v-if="message.attachments?.length" class="message-images">
                  <button v-for="attachment in message.attachments" :key="attachment.id || attachment.url" type="button" @click="openImage(attachment.url)">
                    <img :src="attachment.url" alt="私聊图片" />
                  </button>
                </div>
                <p v-if="message.content">{{ message.content }}</p>
                <footer>
                  <time>{{ fullTime(message.createdAt) }}</time>
                  <span v-if="message._state === 'sending'">发送中</span>
                  <button v-else-if="message._state === 'failed'" type="button" @click="retryMessage(message)">发送失败，重试</button>
                  <span v-else-if="message.senderId === auth.user?.id">{{ message.readAt ? "已读" : "已发送" }}</span>
                  <button v-else type="button" @click="reportMessage(message)">举报</button>
                </footer>
              </div>
            </div>
          </template>
          <el-empty v-if="!messages.length" description="发送第一条消息，确认价格、地点和时间" />
        </div>

        <div v-if="tradeCompleted" class="blocked-tip completed-tip">
          双方已确认成交并完成积分发放，本次私聊已关闭；历史消息仍可查看。
        </div>
        <div v-else-if="activeConversation.blockedByMe || activeConversation.blockedByCounterpart" class="blocked-tip">
          {{ activeConversation.blockedByMe ? "你已屏蔽对方，解除后才能继续发送。" : "当前会话暂时无法继续发送消息。" }}
        </div>
        <form v-else class="composer" @submit.prevent="send">
          <div v-if="pendingAttachments.length" class="pending-images">
            <span v-for="(attachment, index) in pendingAttachments" :key="attachment.url">
              <img :src="attachment.url" alt="待发送图片" />
              <button type="button" @click="pendingAttachments.splice(index, 1)">×</button>
            </span>
          </div>
          <div class="composer-row">
            <label class="image-upload" :class="{ disabled: uploading }">
              <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple :disabled="uploading" @change="uploadImages" />
              {{ uploading ? `${uploadProgress}%` : "图片" }}
            </label>
            <el-input v-model="draft" maxlength="2000" show-word-limit type="textarea" :autosize="{ minRows: 2, maxRows: 5 }" placeholder="输入消息；请勿发送验证码、密码或提前转账" @keydown.ctrl.enter.prevent="send" />
            <el-button type="primary" native-type="submit" :loading="sending" :disabled="!canSend">发送</el-button>
          </div>
          <small>Ctrl + Enter 发送，单次最多 6 张图片</small>
        </form>
      </main>
      <main v-else class="empty-chat"><el-empty description="选择一个会话开始沟通" /></main>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  createMarketClientMessageId,
  marketApi,
  type MarketConversation,
  type MarketConversationFilter,
  type MarketMessage,
  type MarketUser,
} from "@/api/market";
import { uploadApi } from "@/api/topic";
import { useAuthStore } from "@/stores/auth";
import { optimizePublishImage } from "@/utils/publishImage";

type MessageAttachmentInput = {
  id: number;
  url: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
  sort: number;
};
type ChatMessage = MarketMessage & {
  _state?: "sending" | "failed";
  _retry?: {
    content: string;
    clientMessageId: string;
    attachments: Array<{ url: string; mimeType: MessageAttachmentInput["mimeType"] }>;
  };
};

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const conversations = ref<MarketConversation[]>([]);
const messages = ref<ChatMessage[]>([]);
const selectedId = ref(0);
const loading = ref(false);
const loadingOlder = ref(false);
const sending = ref(false);
const confirming = ref(false);
const uploading = ref(false);
const uploadProgress = ref(0);
const draft = ref("");
const search = ref("");
const filter = ref<MarketConversationFilter>("all");
const pendingAttachments = ref<MessageAttachmentInput[]>([]);
const nextCursor = ref<number | null>(null);
const messageList = ref<HTMLElement | null>(null);
const mobileConversation = ref(false);
const realtimeConnected = ref(false);
const filterOptions = [
  { label: "全部", value: "all" },
  { label: "未读", value: "unread" },
  { label: "待确认", value: "pending_confirmation" },
  { label: "已成交", value: "completed" },
];
let pollTimer = 0;
let searchTimer = 0;
let realtimeTimer = 0;
let polling = false;
let messageRequestId = 0;
let eventSource: EventSource | null = null;

const activeConversation = computed(() => conversations.value.find((conversation) => conversation.id === selectedId.value) || null);
const totalUnread = computed(() => conversations.value.reduce((sum, conversation) => sum + conversation.unreadCount, 0));
const activeOrder = computed(() => activeConversation.value?.order || null);
const buyerConfirmed = computed(() => Boolean(activeOrder.value?.buyerConfirmedAt));
const sellerConfirmed = computed(() => Boolean(activeOrder.value?.sellerConfirmedAt));
const tradeCompleted = computed(() => activeOrder.value?.status === "completed" && buyerConfirmed.value && sellerConfirmed.value);
const tradeClosedWithoutCompletion = computed(() => Boolean(
  activeOrder.value
  && ["cancelled", "no_show"].includes(activeOrder.value.status)
  && !tradeCompleted.value,
));
const viewerIsBuyer = computed(() => activeOrder.value?.buyerId === auth.user?.id);
const myConfirmed = computed(() => viewerIsBuyer.value ? buyerConfirmed.value : sellerConfirmed.value);
const counterpartConfirmed = computed(() => viewerIsBuyer.value ? sellerConfirmed.value : buyerConfirmed.value);
const canConfirm = computed(() => {
  const order = activeOrder.value;
  if (!order || !["negotiating", "reserved", "paid", "delivering"].includes(order.status)) return false;
  return order.buyerId === auth.user?.id ? !order.buyerConfirmedAt : !order.sellerConfirmedAt;
});
const confirmationHeadline = computed(() => {
  if (tradeCompleted.value) return "双方已确认，交易完成";
  if (tradeClosedWithoutCompletion.value) return "本次沟通未确认成交";
  if (myConfirmed.value) return "你已确认，正在等待对方";
  if (counterpartConfirmed.value) return "对方已确认，等待你确认";
  return "实际成交后，请买卖双方分别确认";
});
const confirmationDescription = computed(() => {
  if (tradeCompleted.value) return "成交积分已分别发放，可用于后续积分推流。";
  if (tradeClosedWithoutCompletion.value) return "由于没有完成双方确认，系统不会发放成交积分。";
  return "任意一方未确认都不会发放积分；平台不介入付款、交付或退款。";
});
const canSend = computed(() => Boolean(
  selectedId.value
  && !tradeCompleted.value
  && !sending.value
  && !uploading.value
  && (draft.value.trim() || pendingAttachments.value.length),
));

watch([search, filter], () => {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => void loadConversations(), 250);
});

function userInitial(user?: MarketUser) {
  return (user?.nickname || "?").slice(0, 1).toUpperCase();
}

function shortTime(value?: string | null) {
  if (!value) return "";
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function fullTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function conversationStatus(conversation: MarketConversation) {
  const status = conversation.order?.status || "";
  return ({ negotiating: "沟通中", reserved: "待双方确认", delivering: "待双方确认", paid: "待双方确认", completed: "已成交", cancelled: "未成交", disputed: "已投诉", no_show: "未成交" } as Record<string, string>)[status] || status;
}

function lastMessageText(conversation: MarketConversation) {
  const message = conversation.lastMessage;
  if (!message) return "开始沟通交易细节";
  if (message.kind === "image" && !message.content) return "[图片]";
  return message.content || `[${message.attachments?.length || 0} 张图片]`;
}

async function scrollBottom() {
  await nextTick();
  if (messageList.value) messageList.value.scrollTop = messageList.value.scrollHeight;
}

async function loadConversations(silent = false) {
  try {
    const list = await marketApi.conversations(
      { q: search.value || undefined, filter: filter.value },
      { suppressErrorMessage: true },
    );
    conversations.value = list;
    const queryId = Number(route.query.conversation || 0);
    const selectedExists = list.some((item) => item.id === selectedId.value);
    if (!selectedExists) {
      selectedId.value = (queryId && list.some((item) => item.id === queryId) ? queryId : list[0]?.id) || 0;
      messages.value = [];
      nextCursor.value = null;
    }
  } catch (error) {
    if (!silent) ElMessage.error(error instanceof Error ? error.message : "会话加载失败");
  }
}

async function loadMessages(silent = false) {
  if (!selectedId.value) return;
  const conversationId = selectedId.value;
  const requestId = ++messageRequestId;
  try {
    const result = await marketApi.messages(conversationId, { limit: 50 }, { suppressErrorMessage: true });
    if (requestId !== messageRequestId || conversationId !== selectedId.value) return;
    const changed = result.list.length !== messages.value.filter((message) => !message._state).length
      || result.list.at(-1)?.id !== messages.value.filter((message) => !message._state).at(-1)?.id;
    const failed = messages.value.filter((message) => message._state === "failed");
    messages.value = [...result.list, ...failed];
    nextCursor.value = result.nextCursor;
    if (changed) await scrollBottom();
    await marketApi.markConversationRead(conversationId).catch(() => null);
  } catch (error) {
    if (!silent) ElMessage.error(error instanceof Error ? error.message : "消息加载失败");
  }
}

async function loadOlder() {
  if (!selectedId.value || !nextCursor.value || loadingOlder.value) return;
  const oldHeight = messageList.value?.scrollHeight || 0;
  loadingOlder.value = true;
  try {
    const result = await marketApi.messages(selectedId.value, { before: nextCursor.value, limit: 50 }, { suppressErrorMessage: true });
    messages.value = [...result.list, ...messages.value];
    nextCursor.value = result.nextCursor;
    await nextTick();
    if (messageList.value) messageList.value.scrollTop = messageList.value.scrollHeight - oldHeight;
  } finally {
    loadingOlder.value = false;
  }
}

async function selectConversation(id: number) {
  selectedId.value = id;
  messageRequestId += 1;
  mobileConversation.value = true;
  messages.value = [];
  nextCursor.value = null;
  pendingAttachments.value = [];
  await router.replace({ query: { ...route.query, conversation: String(id) } });
  await loadMessages();
  await loadConversations(true);
}

async function uploadImages(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files || []).slice(0, 6 - pendingAttachments.value.length);
  if (!files.length) return;
  uploading.value = true;
  try {
    for (let index = 0; index < files.length; index += 1) {
      const optimized = await optimizePublishImage(files[index]);
      const result = await uploadApi.media(optimized, optimized.name, {
        onProgress: (state) => {
          uploadProgress.value = Math.round(((index + state.percent / 100) / files.length) * 100);
        },
      });
      if (result.kind !== "image") throw new Error("私聊仅支持图片");
      pendingAttachments.value.push({
        id: -(Date.now() + index),
        url: result.url,
        mimeType: normalizeImageMime(result.mimeType || optimized.type),
        sort: pendingAttachments.value.length,
      });
    }
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "图片上传失败");
  } finally {
    uploading.value = false;
    uploadProgress.value = 0;
    input.value = "";
  }
}

function normalizeImageMime(value: string): MessageAttachmentInput["mimeType"] {
  return ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(value)
    ? value as MessageAttachmentInput["mimeType"]
    : "image/jpeg";
}

async function send() {
  const content = draft.value.trim();
  const attachments = pendingAttachments.value.map(({ url, mimeType }) => ({ url, mimeType }));
  if ((!content && !attachments.length) || !selectedId.value || sending.value) return;
  draft.value = "";
  pendingAttachments.value = [];
  await sendPayload({ content, attachments, clientMessageId: createMarketClientMessageId() });
}

async function sendPayload(payload: NonNullable<ChatMessage["_retry"]>) {
  if (!selectedId.value) return;
  const conversationId = selectedId.value;
  const optimistic: ChatMessage = {
    id: -Date.now(),
    conversationId,
    senderId: auth.user!.id,
    content: payload.content,
    kind: payload.attachments.length && !payload.content ? "image" : "text",
    clientMessageId: payload.clientMessageId,
    attachments: payload.attachments.map((attachment, index) => ({ id: -(Date.now() + index), sort: index, ...attachment })),
    createdAt: new Date().toISOString(),
    sender: auth.user as MarketUser,
    _state: "sending",
    _retry: payload,
  };
  messages.value.push(optimistic);
  await scrollBottom();
  sending.value = true;
  try {
    const sent = await marketApi.sendMessage(conversationId, payload);
    const index = messages.value.findIndex((message) => message.clientMessageId === payload.clientMessageId);
    if (index >= 0) messages.value[index] = sent;
    await loadConversations(true);
  } catch {
    const failed = messages.value.find((message) => message.clientMessageId === payload.clientMessageId);
    if (failed) failed._state = "failed";
  } finally {
    sending.value = false;
  }
}

async function retryMessage(message: ChatMessage) {
  if (!message._retry || sending.value) return;
  messages.value = messages.value.filter((entry) => entry !== message);
  await sendPayload(message._retry);
}

async function confirmCompleted() {
  const conversation = activeConversation.value;
  if (!conversation?.order || confirming.value) return;
  await ElMessageBox.confirm("请仅在商品已经实际交付、双方自行结清款项后确认。确认后不可由你自行撤回；只有对方也确认，系统才会认定成交并分别发放积分。", "确认实际成交", { type: "warning", confirmButtonText: "我确认已成交" });
  confirming.value = true;
  try {
    const result = await marketApi.confirmConversationCompletion(conversation.id);
    ElMessage.success(result.completed ? "双方已确认，成交积分已发放" : "你已确认；对方确认前不会发放积分");
    await refreshActiveConversation();
  } finally {
    confirming.value = false;
  }
}

async function toggleBlock() {
  if (!activeConversation.value) return;
  const wasBlocked = activeConversation.value.blockedByMe;
  if (!wasBlocked) {
    await ElMessageBox.confirm("屏蔽后双方都不能继续在该会话发送消息，历史记录仍保留。", "屏蔽对方", { type: "warning" });
  }
  const result = await marketApi.toggleConversationBlock(activeConversation.value.id);
  ElMessage.success(result.blocked ? "已屏蔽对方" : "已解除屏蔽");
  await loadConversations(true);
}

async function reportMessage(message: ChatMessage) {
  if (!activeConversation.value) return;
  const { value } = await ElMessageBox.prompt("请说明这条消息存在的问题。", "举报消息", {
    inputPlaceholder: "例如：骚扰、诈骗、发送违禁内容",
    inputValidator: (input) => input.trim().length >= 2 || "请至少填写 2 个字",
  });
  await marketApi.reportMessage(activeConversation.value.id, message.id, { reason: value.trim(), detail: "" });
  ElMessage.success("举报已提交");
}

function openImage(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

async function refreshActiveConversation() {
  await Promise.all([loadConversations(true), loadMessages(true)]);
}

function scheduleRealtimeRefresh() {
  window.clearTimeout(realtimeTimer);
  realtimeTimer = window.setTimeout(() => void refreshActiveConversation(), 120);
}

function connectRealtime() {
  eventSource?.close();
  eventSource = new EventSource("/api/market/conversations/events", { withCredentials: true });
  eventSource.addEventListener("ready", () => { realtimeConnected.value = true; });
  for (const event of ["conversation", "message", "read", "trade"]) {
    eventSource.addEventListener(event, scheduleRealtimeRefresh);
  }
  eventSource.onerror = () => { realtimeConnected.value = false; };
}

async function poll() {
  if (polling) return;
  polling = true;
  try {
    await refreshActiveConversation();
  } finally {
    polling = false;
  }
}

onMounted(async () => {
  loading.value = true;
  try {
    await loadConversations();
    await loadMessages();
    connectRealtime();
  } finally {
    loading.value = false;
  }
  pollTimer = window.setInterval(() => { if (!realtimeConnected.value) void poll(); }, 8000);
});

onBeforeUnmount(() => {
  window.clearInterval(pollTimer);
  window.clearTimeout(searchTimer);
  window.clearTimeout(realtimeTimer);
  eventSource?.close();
});
</script>

<style scoped>
.market-chat-page{max-width:1280px;margin:0 auto;padding:28px 20px 48px}.chat-head{display:flex;align-items:flex-end;justify-content:space-between;gap:18px}.chat-head h1{margin:4px 0;font-size:28px}.chat-head p{margin:0 0 20px;color:var(--cpu-text-secondary)}.chat-shell{display:grid;grid-template-columns:360px 1fr;height:min(760px,calc(100vh - 210px));min-height:560px;background:var(--cpu-card);border:1px solid var(--cpu-border-soft);border-radius:18px;overflow:hidden}.chat-shell aside{border-right:1px solid var(--cpu-border-soft);overflow:auto}.aside-title{display:flex;justify-content:space-between;padding:18px 16px 10px}.conversation-tools{display:grid;gap:9px;padding:0 12px 12px;border-bottom:1px solid var(--cpu-border-soft)}.conversation-tools .el-segmented{width:100%;overflow:auto}.conversation{position:relative;width:100%;display:grid;grid-template-columns:44px 1fr auto;gap:10px;padding:15px 14px;border:0;border-bottom:1px solid var(--cpu-border-soft);background:var(--cpu-card);color:var(--cpu-text);text-align:left;cursor:pointer}.conversation:hover,.conversation.active{background:var(--cpu-primary-soft)}.conversation>span{min-width:0;display:flex;flex-direction:column;gap:3px}.conversation strong,.conversation small,.conversation em{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.conversation small{color:var(--cpu-primary)}.conversation em{font-style:normal;color:var(--cpu-text-secondary);font-size:12px}.conversation time{font-size:11px;color:var(--cpu-text-secondary)}.messages{display:grid;grid-template-rows:auto auto 1fr auto;min-width:0;min-height:0}.message-head{height:72px;display:flex;align-items:center;gap:12px;padding:10px 18px;border-bottom:1px solid var(--cpu-border-soft)}.message-head img{width:46px;height:46px;object-fit:cover;border-radius:10px}.message-head>div{flex:1;min-width:0;display:flex;flex-direction:column}.message-head strong,.message-head small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.message-head small{color:var(--cpu-text-secondary)}.trade-confirmation{display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:14px;padding:12px 18px;border-bottom:1px solid #fde68a;background:#fffbeb}.trade-confirmation.completed{border-color:#a7f3d0;background:#ecfdf5}.trade-confirmation.closed{border-color:var(--cpu-border-soft);background:var(--cpu-surface-soft)}.confirmation-copy{display:flex;min-width:0;flex-direction:column;gap:2px}.confirmation-copy b{font-size:13px}.confirmation-copy span{color:var(--cpu-text-secondary);font-size:10px;line-height:1.45}.party-confirmations{display:flex;gap:6px}.party-confirmations span{padding:5px 8px;border:1px solid #fbbf24;border-radius:999px;color:#92400e;background:#fff;font-size:10px;white-space:nowrap}.party-confirmations span.confirmed{border-color:#34d399;color:#047857;background:#f0fdf4}.message-list{min-height:0;padding:14px 20px 24px;overflow-y:auto;background:var(--cpu-surface-soft)}.history-loader{height:32px;display:grid;place-items:center;color:var(--cpu-text-secondary);font-size:11px}.bubble-row{display:flex;gap:10px;align-items:flex-start;margin-bottom:16px}.bubble-row>div{max-width:70%}.bubble-row p{margin:0;padding:10px 13px;background:var(--cpu-card);border:1px solid var(--cpu-border-soft);border-radius:4px 14px 14px 14px;white-space:pre-wrap;word-break:break-word}.bubble-row footer{display:flex;gap:8px;margin-top:4px;color:var(--cpu-text-secondary);font-size:11px}.bubble-row footer button{padding:0;border:0;background:none;color:var(--cpu-primary);font-size:11px;cursor:pointer}.bubble-row.mine{flex-direction:row-reverse}.bubble-row.mine>div{text-align:right}.bubble-row.mine p{color:#fff;background:var(--cpu-primary);border-color:var(--cpu-primary);border-radius:14px 4px 14px 14px;text-align:left}.bubble-row.mine footer{justify-content:flex-end}.bubble-row.failed p{border-color:var(--cpu-danger)}.message-images{display:grid;grid-template-columns:repeat(2,minmax(90px,180px));gap:5px;margin-bottom:5px}.message-images button{padding:0;border:0;border-radius:10px;overflow:hidden;background:none;cursor:pointer}.message-images img{display:block;width:100%;max-height:220px;object-fit:cover}.system-message{display:flex;align-items:center;justify-content:center;gap:8px;margin:12px 0;color:var(--cpu-text-secondary);font-size:11px}.system-message span{padding:5px 10px;border-radius:999px;background:var(--cpu-card);border:1px solid var(--cpu-border-soft)}.system-message time{font-size:10px}.composer{display:grid;gap:8px;padding:12px 14px;border-top:1px solid var(--cpu-border-soft)}.composer-row{display:flex;align-items:flex-end;gap:10px}.composer-row .el-textarea{flex:1}.composer>small{padding-left:58px;color:var(--cpu-text-secondary);font-size:10px}.image-upload{height:34px;display:grid;place-items:center;padding:0 10px;border:1px solid var(--cpu-border-soft);border-radius:7px;color:var(--cpu-primary);font-size:12px;cursor:pointer}.image-upload input{display:none}.image-upload.disabled{opacity:.5;cursor:not-allowed}.pending-images{display:flex;gap:8px;overflow:auto;padding-left:58px}.pending-images span{position:relative;flex:0 0 54px;height:54px}.pending-images img{width:100%;height:100%;object-fit:cover;border-radius:8px}.pending-images button{position:absolute;right:-5px;top:-5px;width:18px;height:18px;padding:0;border:0;border-radius:50%;background:#1f2937;color:#fff;cursor:pointer}.blocked-tip{padding:16px;text-align:center;color:var(--cpu-text-secondary);border-top:1px solid var(--cpu-border-soft)}.completed-tip{color:#047857;background:#ecfdf5}.empty-chat{display:grid;place-items:center}.mobile-back{display:none}:deep(.danger){color:var(--cpu-danger)}
@media(max-width:760px){.market-chat-page{padding:10px}.chat-head{align-items:flex-start}.chat-shell{grid-template-columns:1fr;height:calc(100vh - 150px);min-height:500px}.chat-shell aside{border:0}.chat-shell aside.hidden{display:none}.messages{grid-column:1}.empty-chat{display:none}.mobile-back{display:inline-flex}.message-head{padding:8px}.message-head img{display:none}.trade-confirmation{grid-template-columns:1fr auto;padding:9px}.confirmation-copy{grid-column:1/-1}.party-confirmations{overflow:auto}.trade-confirmation .el-button{padding:7px}.bubble-row>div{max-width:84%}.composer{padding:8px}.composer-row{gap:6px}.composer-row .el-button{height:54px}.message-images{grid-template-columns:repeat(2,minmax(70px,130px))}.pending-images,.composer>small{padding-left:0}.conversation-tools .el-segmented{font-size:11px}}
</style>
