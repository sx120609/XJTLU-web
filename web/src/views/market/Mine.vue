<template>
  <div class="mine-page">
    <header class="page-head">
      <div>
        <span>MY KAOPU TRADES</span>
        <h1>{{ t("market.myTrades") }}</h1>
        <p>{{ isEnglish ? "Manage physical items and wanted requests here. Chat and completion confirmation are handled in Trade Messages." : "这里只管理你的实物商品和求购需求；沟通与成交确认统一放在市集的“交易消息”。" }}</p>
      </div>
    </header>

    <el-tabs v-model="tab" class="market-tabs cpu-card" v-loading="loading" @tab-change="syncTab">
      <el-tab-pane :label="isEnglish ? 'My listings' : '我的发布'" name="selling">
        <div class="section-tools">
          <el-segmented v-model="sellingStatus" :options="sellingOptions" />
          <span>{{ filteredSelling.length }} {{ isEnglish ? "items" : "件" }}</span>
        </div>
        <div v-if="filteredSelling.length" class="record-list">
          <article v-for="item in filteredSelling" :key="item.id">
            <ItemCover :item="item" />
            <div class="record-copy">
              <div>
                <strong>{{ item.title }}</strong>
                <el-tag size="small" :type="itemStatusType(item.status)">{{ itemStatus(item.status) }}</el-tag>
              </div>
              <p>¥{{ item.price }} · {{ item.favoriteCount }} {{ isEnglish ? "favorites" : "收藏" }} · {{ item.offerCount }} {{ isEnglish ? "chats" : "个私聊" }}</p>
              <small>{{ item.campus || (isEnglish ? "Campus to be agreed" : "校区待协商") }} · {{ item.expiresAt ? `${isEnglish ? "Expires" : "有效期至"} ${formatDate(item.expiresAt)}` : fmtRelative(item.updatedAt) }}</small>
            </div>
            <div class="record-actions">
              <el-button size="small" @click="router.push(`/market/item/${item.id}`)">{{ t("common.view") }}</el-button>
              <el-button v-if="item.status === 'active'" size="small" type="primary" plain @click="openPointPromotion('market_item', item.id)">{{ t("market.points") }}</el-button>
              <el-button v-if="editableItemStatuses.includes(item.status)" size="small" @click="router.push(`/market/item/${item.id}/edit`)">{{ t("common.edit") }}</el-button>
              <el-button v-if="relistItemStatuses.includes(item.status)" size="small" @click="itemLifecycle(item, 'relist')">{{ isEnglish ? "Relist" : "重新上架" }}</el-button>
              <el-button v-if="['active','negotiating','expired'].includes(item.status)" size="small" type="danger" plain @click="itemLifecycle(item, 'withdraw')">{{ isEnglish ? "Take down" : "下架" }}</el-button>
            </div>
          </article>
        </div>
        <el-empty v-else :description="isEnglish ? 'No items in this category' : '当前分类没有商品'" />
      </el-tab-pane>

      <el-tab-pane :label="isEnglish ? 'Wanted requests' : '求购需求'" name="wanted">
        <el-alert class="tab-explanation" type="info" :closable="false" show-icon :title="isEnglish ? 'Expired requests are not automatically renewed. Review, edit, and publish them again to keep information accurate.' : '求购过期后不再“续期”；请检查原内容并编辑后重新发布，避免失效需求长期占位。'" />
        <div v-if="data.wantedPosts.length" class="record-list">
          <article v-for="post in data.wantedPosts" :key="post.id">
            <div class="wanted-mark">{{ isEnglish ? "W" : "求" }}</div>
            <div class="record-copy">
              <div>
                <strong>{{ post.title }}</strong>
                <el-tag size="small" :type="wantedStatusType(post.status)">{{ wantedStatus(post.status) }}</el-tag>
              </div>
              <p>{{ isEnglish ? "Budget" : "预算" }} ¥{{ post.budgetMin }}–{{ post.budgetMax }} · {{ post.responseCount }} {{ isEnglish ? "responses" : "个响应" }}</p>
              <small>{{ post.campus || (isEnglish ? "On campus" : "校内") }} · {{ isEnglish ? "Expires" : "有效期至" }} {{ formatDate(post.expiresAt) }}</small>
            </div>
            <div class="record-actions">
              <el-button size="small" @click="router.push(`/market/wanted/${post.id}`)">{{ isEnglish ? "View responses" : "查看响应" }}</el-button>
              <el-button v-if="['active','responded'].includes(post.status)" size="small" type="primary" plain @click="openPointPromotion('wanted_post', post.id)">{{ t("market.points") }}</el-button>
              <el-button v-if="['active','responded'].includes(post.status)" size="small" @click="router.push(`/market/wanted/${post.id}/edit`)">{{ t("common.edit") }}</el-button>
              <el-button v-if="post.status === 'expired'" size="small" type="primary" plain @click="router.push(`/market/wanted/${post.id}/edit`)">{{ isEnglish ? "Edit and republish" : "编辑后重新发布" }}</el-button>
              <el-button v-if="['active','responded'].includes(post.status)" size="small" type="danger" plain @click="wantedLifecycle(post, 'cancel')">{{ isEnglish ? "End" : "结束" }}</el-button>
            </div>
          </article>
        </div>
        <el-empty v-else :description="isEnglish ? 'You have not posted a wanted request' : '还没有发布求购'" />

        <section v-if="data.wantedResponses.length" class="sub-section">
          <h3>{{ isEnglish ? "Wanted requests I responded to" : "我响应的求购" }}</h3>
          <div class="record-list">
            <article v-for="response in data.wantedResponses" :key="response.id">
              <ItemCover :item="response.item" />
              <div class="record-copy">
                <div>
                  <strong>{{ response.wantedPost?.title }}</strong>
                  <el-tag size="small" :type="intentStatusType(response.status)">{{ intentStatus(response.status) }}</el-tag>
                </div>
                <p>{{ isEnglish ? "Offering" : "提供" }} {{ response.item.title }} · ¥{{ response.price }}</p>
                <small>{{ response.description }}</small>
              </div>
              <div class="record-actions">
                <el-button size="small" @click="router.push(`/market/wanted/${response.wantedPostId}`)">{{ t("common.view") }}</el-button>
                <el-button v-if="response.status === 'pending'" size="small" @click="handleWantedResponse(response.id, 'cancel')">{{ isEnglish ? "Withdraw" : "撤回" }}</el-button>
              </div>
            </article>
          </div>
        </section>
      </el-tab-pane>

    </el-tabs>
  </div>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, onMounted, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  marketApi,
  type MarketItem,
  type WantedPost,
  type WantedResponse,
  type WantedResponseAction,
} from "@/api/market";
import { fmtRelative } from "@/utils/format";
import { useLocale } from "@/i18n";

type MineData = {
  selling: MarketItem[];
  wantedPosts: WantedPost[];
  wantedResponses: WantedResponse[];
};

const route = useRoute();
const router = useRouter();
const { t, isEnglish, locale } = useLocale();
const validTabs = new Set(["selling", "wanted"]);
const initialTab = String(route.query.tab || "selling");
const tab = ref(validTabs.has(initialTab) ? initialTab : "selling");
const sellingStatus = ref("all");
const loading = ref(false);
const data = reactive<MineData>({ selling: [], wantedPosts: [], wantedResponses: [] });
const sellingOptions = computed(() => [
  { label: isEnglish.value ? "All" : "全部", value: "all" },
  { label: isEnglish.value ? "For sale" : "在售", value: "active" },
  { label: isEnglish.value ? "Sold" : "已售出", value: "sold" },
  { label: isEnglish.value ? "Drafts" : "草稿", value: "draft" },
  { label: isEnglish.value ? "Taken down" : "已下架", value: "withdrawn" },
]);
const inactiveItemStatuses = ["withdrawn", "expired", "hidden", "reviewing"];
const editableItemStatuses = ["active", "draft", "expired", "withdrawn", "sold"];
const relistItemStatuses = ["expired", "withdrawn", "sold"];
const filteredSelling = computed(() => data.selling.filter((item) => {
  if (sellingStatus.value === "all") return true;
  if (sellingStatus.value === "withdrawn") return inactiveItemStatuses.includes(item.status);
  return item.status === sellingStatus.value;
}));
const ItemCover = defineComponent({
  name: "ItemCover",
  props: { item: { type: Object as () => MarketItem, required: true } },
  setup(props) {
    return () => h("div", { class: "item-cover" }, props.item.cover
      ? h("img", { src: props.item.cover, alt: props.item.title })
      : h("span", "📦"));
  },
});

onMounted(load);

function syncTab() {
  void router.replace({ query: { ...route.query, tab: tab.value } });
}

async function load() {
  loading.value = true;
  try {
    const result = await marketApi.mine({ suppressErrorMessage: true });
    data.selling = result.selling;
    data.wantedPosts = result.wantedPosts;
    data.wantedResponses = result.wantedResponses;
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : (isEnglish.value ? "Could not load trade data" : "交易数据加载失败"));
  } finally {
    loading.value = false;
  }
}

function openPointPromotion(targetType: "market_item" | "wanted_post", targetId: number) {
  void router.push({
    name: "market-promotions",
    query: { mode: "points", targetType, targetId: String(targetId) },
  });
}

async function itemLifecycle(item: MarketItem, action: "withdraw" | "relist") {
  if (action === "withdraw") {
    await ElMessageBox.confirm(
      isEnglish.value ? "The item will no longer be public, but chat history will remain. Continue?" : "下架后商品不再公开展示，历史私聊仍会保留。确定继续？",
      isEnglish.value ? "Take down item" : "下架商品",
      { type: "warning" },
    );
  }
  await marketApi.updateItemLifecycle(item.id, action);
  ElMessage.success(action === "withdraw"
    ? (isEnglish.value ? "Item taken down" : "商品已下架")
    : (isEnglish.value ? "Item relisted" : "商品已重新上架"));
  await load();
}

async function wantedLifecycle(post: WantedPost, action: "cancel" | "complete") {
  if (action === "cancel") {
    await ElMessageBox.confirm(
      isEnglish.value ? "Ending this request will also close pending responses. Continue?" : "结束后未处理响应会一并关闭，确定继续？",
      isEnglish.value ? "End wanted request" : "结束求购",
      { type: "warning" },
    );
  }
  await marketApi.updateWantedLifecycle(post.id, action);
  ElMessage.success(isEnglish.value ? "Wanted request ended" : "求购已结束");
  await load();
}

async function handleWantedResponse(id: number, action: WantedResponseAction) {
  await marketApi.updateWantedResponse(id, action);
  ElMessage.success(isEnglish.value ? "Done" : "操作成功");
  await load();
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString(locale.value);
}

function itemStatus(value: string) {
  if (isEnglish.value) return ({
    active: "For sale", sold: "Sold", draft: "Draft", withdrawn: "Taken down",
    expired: "Expired", hidden: "Removed by platform", reviewing: "Under review", negotiating: "Chatting",
  } as Record<string, string>)[value] || value;
  return ({
    active: "在售",
    sold: "已售出",
    draft: "草稿",
    withdrawn: "已下架",
    expired: "已过期",
    hidden: "平台下架",
    reviewing: "审核中",
    negotiating: "洽谈中",
  } as Record<string, string>)[value] || value;
}

function itemStatusType(value: string) {
  return value === "active" ? "success" : value === "sold" ? "info" : value === "reviewing" ? "warning" : "info";
}

function wantedStatus(value: string) {
  if (isEnglish.value) return ({
    active: "Open", responded: "Responses received", completed: "Completed", cancelled: "Ended",
    expired: "Expired", reviewing: "Under review", removed: "Removed",
  } as Record<string, string>)[value] || value;
  return ({
    active: "求购中",
    responded: "已有响应",
    completed: "已完成",
    cancelled: "已结束",
    expired: "已过期",
    reviewing: "审核中",
    removed: "已下架",
  } as Record<string, string>)[value] || value;
}

function wantedStatusType(value: string) {
  return value === "active" ? "success" : value === "responded" ? "warning" : "info";
}

function intentStatus(value: string) {
  if (isEnglish.value) return ({ pending: "Pending", accepted: "Chat started", rejected: "Not selected", cancelled: "Withdrawn", expired: "Expired" } as Record<string, string>)[value] || value;
  return ({ pending: "待处理", accepted: "已发起私聊", rejected: "未采用", cancelled: "已撤回", expired: "已过期" } as Record<string, string>)[value] || value;
}

function intentStatusType(value: string) {
  return value === "accepted" ? "success" : value === "pending" ? "warning" : "info";
}

</script>

<style scoped>
.mine-page{max-width:1180px;margin:0 auto;padding:28px 20px 56px}.page-head{margin-bottom:22px}.page-head>div:first-child>span{color:var(--cpu-primary);font-size:10px;font-weight:800;letter-spacing:.16em}.page-head h1{margin:8px 0 4px;font-size:34px}.page-head p{margin:0;color:var(--cpu-text-secondary)}.market-tabs{padding:16px 28px 28px;border-radius:18px}.section-tools{display:flex;align-items:center;justify-content:space-between;margin:8px 0 20px}.record-list{display:grid;gap:12px}.record-list article{display:flex;align-items:center;gap:18px;padding:16px;border:1px solid var(--cpu-border-soft);border-radius:14px;background:var(--cpu-card)}.record-copy{flex:1;min-width:0}.record-copy>div{display:flex;align-items:center;gap:10px}.record-copy strong{font-size:16px}.record-copy p{margin:8px 0;color:var(--cpu-text)}.record-copy small{display:block;color:var(--cpu-text-secondary)}.record-actions{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap}.record-actions .el-button{margin-left:0}.item-cover{width:88px;height:72px;flex:0 0 auto;display:grid;place-items:center;overflow:hidden;border-radius:12px;background:var(--cpu-surface-soft);font-size:30px}.item-cover img{width:100%;height:100%;object-fit:cover}.wanted-mark{width:54px;height:54px;display:grid;place-items:center;border-radius:16px;background:var(--cpu-primary-soft);color:var(--cpu-primary);font-size:22px;font-weight:800}.tab-explanation{margin:8px 0 16px}.sub-section{margin-top:28px}.sub-section h3{margin:0 0 12px}@media(max-width:800px){.mine-page{padding:16px 10px}.market-tabs{padding:10px}.section-tools{align-items:flex-start;gap:10px;overflow:auto}.record-list article{align-items:flex-start;flex-wrap:wrap}.record-copy{min-width:calc(100% - 124px)}.record-actions{width:100%}}
</style>
