<template>
  <div class="search-page" v-loading="loading">
    <div class="head">
      <h2>搜索 "{{ q }}"</h2>
      <div class="counts" v-if="result">
        共找到 {{ result.marketItems.length + result.wantedPosts.length + result.topics.length + result.services.length + result.merchants.length }} 条结果
      </div>
    </div>

    <div v-if="!q" class="cpu-card empty"><el-empty description="请输入搜索关键词" /></div>
    <div v-else-if="error && !loading" class="cpu-card empty">
      <el-empty :description="error">
        <el-button type="primary" @click="reload">重试</el-button>
      </el-empty>
    </div>

    <template v-else-if="result">
      <section v-if="result.marketItems.length" class="cpu-card">
        <h3 class="title">🛍️ 在售商品（{{ result.marketItems.length }}）</h3>
        <div class="market-results">
          <router-link v-for="item in result.marketItems" :key="item.id" :to="`/market/item/${item.id}`" class="market-result" @click="recordClick(item.promotions.pinned?.orderId)">
            <span class="market-cover"><img v-if="item.cover" :src="item.cover" :alt="item.title" /><b v-else>物</b></span>
            <span class="market-result-copy">
              <span><PromotionLabel v-if="item.promotions.pinned" label="置顶" kind="pin" /><b>{{ item.title }}</b></span>
              <small>{{ item.campus || '校内交易' }}<i v-if="item.negotiable">可议</i></small>
            </span>
            <strong>¥{{ item.price }}</strong>
          </router-link>
        </div>
      </section>

      <section v-if="result.wantedPosts.length" class="cpu-card">
        <h3 class="title">🔎 校园求购（{{ result.wantedPosts.length }}）</h3>
        <div class="market-results">
          <router-link v-for="post in result.wantedPosts" :key="post.id" :to="`/market/wanted/${post.id}`" class="market-result wanted-result" @click="recordClick(post.promotion.urgent?.orderId)">
            <span class="market-cover"><b>求</b></span>
            <span class="market-result-copy"><span><PromotionLabel v-if="post.promotion.urgent" label="加急" kind="urgent" /><em>求购</em><b>{{ post.title }}</b></span><small>{{ post.campus || '校内面交' }} · {{ post.responseCount }} 个响应</small></span>
            <strong>¥{{ post.budgetMin }}–{{ post.budgetMax }}</strong>
          </router-link>
        </div>
      </section>

      <section v-if="result.topics.length" class="cpu-card">
        <h3 class="title">💬 帖子（{{ result.topics.length }}）</h3>
        <TopicListItem v-for="t in result.topics" :key="t.id" :topic="t" />
      </section>

      <section v-if="result.services.length" class="cpu-card">
        <h3 class="title">🧭 服务（{{ result.services.length }}）</h3>
        <div
          v-for="s in result.services"
          :key="s.id"
          class="svc-row"
          role="button"
          tabindex="0"
          @click="open(s)"
          @keydown.enter.prevent="open(s)"
          @keydown.space.prevent="open(s)"
        >
          <span class="icon">{{ s.icon || "🔗" }}</span>
          <div>
            <div class="s-name">{{ s.name }}</div>
            <div class="s-desc">{{ s.owner }} · {{ s.description }}</div>
          </div>
          <el-icon><Right /></el-icon>
        </div>
      </section>

      <section v-if="result.merchants.length" class="cpu-card">
        <h3 class="title">🏪 合作商户（{{ result.merchants.length }}）</h3>
        <div class="market-results">
          <router-link v-for="merchant in result.merchants" :key="merchant.id" :to="`/market/merchant/${merchant.slug}`" class="market-result" @click="recordClick(merchant.promotion.homepage?.orderId)">
            <span class="market-cover"><img v-if="merchant.cover" :src="merchant.cover" :alt="merchant.name" /><b v-else>商</b></span>
            <span class="market-result-copy"><span><PromotionLabel label="合作商户" kind="merchant" /><b>{{ merchant.name }}</b></span><small>{{ merchant.category }} · {{ merchant.serviceArea }}</small></span>
            <strong>{{ merchant.priceRange }}</strong>
          </router-link>
        </div>
      </section>

      <div v-if="!hasResult" class="cpu-card empty">
        <el-empty description="什么也没找到。换个关键词试试？" />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { Right } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import TopicListItem from "@/components/forum/TopicListItem.vue";
import PromotionLabel from "@/components/market/PromotionLabel.vue";
import { marketApi } from "@/api/market";
import { searchApi, type SearchResult } from "@/api/search";

const route = useRoute();
const router = useRouter();
const q = ref((route.query.q as string) ?? "");
const result = ref<SearchResult | null>(null);
const loading = ref(false);
const error = ref("");
let searchSeq = 0;

const hasResult = computed(() =>
  result.value && (result.value.marketItems.length + result.value.wantedPosts.length + result.value.topics.length + result.value.services.length + result.value.merchants.length) > 0
);

watch(() => route.query.q, async (v) => {
  q.value = (v as string) ?? "";
  await reload();
}, { immediate: true });

async function reload() {
  const keyword = q.value.trim();
  if (!keyword) {
    searchSeq += 1;
    result.value = null;
    error.value = "";
    loading.value = false;
    return;
  }
  const seq = ++searchSeq;
  loading.value = true;
  error.value = "";
  try {
    const next = await searchApi.search(keyword, { suppressErrorMessage: true });
    if (seq === searchSeq) {
      result.value = next;
      const orderIds = new Set<number>();
      for (const item of next.marketItems) if (item.promotions.pinned) orderIds.add(item.promotions.pinned.orderId);
      for (const post of next.wantedPosts) if (post.promotion.urgent) orderIds.add(post.promotion.urgent.orderId);
      for (const merchant of next.merchants) if (merchant.promotion.homepage) orderIds.add(merchant.promotion.homepage.orderId);
      for (const orderId of orderIds) void marketApi.recordPromotionEvent(orderId, "impression", { suppressErrorMessage: true });
    }
  } catch (searchError) {
    if (seq === searchSeq) {
      result.value = null;
      error.value = normalizeSearchError(searchError);
    }
  } finally {
    if (seq === searchSeq) loading.value = false;
  }
}

function normalizeSearchError(searchError: unknown) {
  const status = (searchError as { response?: { status?: number; data?: { message?: string } } })?.response?.status;
  if (status && status < 500) {
    return (searchError as { response?: { data?: { message?: string } } })?.response?.data?.message || "搜索失败";
  }
  return "搜索失败，请稍后再试";
}

function recordClick(orderId?: number) {
  if (orderId) void marketApi.recordPromotionEvent(orderId, "click", { suppressErrorMessage: true });
}

function open(s: any) {
  const url = typeof s?.url === "string" ? s.url.trim() : "";
  if (!url) {
    ElMessage.warning("该服务暂未配置链接");
    return;
  }
  if (url.startsWith("/")) {
    router.push(url);
    return;
  }
  if (url.startsWith("tel:") || url.startsWith("mailto:")) {
    window.location.href = url;
    return;
  }
  if (/^https?:\/\//i.test(url)) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  ElMessage.warning("该服务链接格式暂不支持");
}

</script>

<style scoped>
.search-page { display: flex; flex-direction: column; gap: 16px; }
.head h2 { margin: 0; font-size: 20px; }
.counts { font-size: 12px; color: var(--cpu-text-muted); margin-top: 4px; }
.cpu-card {
  background: var(--cpu-card);
  border: 1px solid var(--cpu-border-soft);
  border-radius: 12px;
  padding: 16px 20px;
  box-shadow: 0 2px 12px rgba(0,0,0,0.04);
  color: var(--cpu-text);
}
.title { margin: 0 0 10px; font-size: 15px; }
.market-results{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.market-result{display:flex;align-items:center;gap:10px;min-width:0;padding:9px;border:1px solid var(--cpu-border-soft);border-radius:10px;color:var(--cpu-text);text-decoration:none}.market-result:hover{border-color:var(--cpu-primary);background:var(--cpu-surface-soft)}.market-cover{display:grid;place-items:center;flex:0 0 54px;width:54px;height:54px;overflow:hidden;border-radius:9px;color:var(--cpu-primary);background:var(--cpu-primary-soft)}.market-cover img{width:100%;height:100%;object-fit:cover}.market-result-copy{display:flex;min-width:0;flex:1;flex-direction:column;gap:5px}.market-result-copy>span{display:flex;align-items:center;gap:5px;min-width:0}.market-result-copy b{overflow:hidden;font-size:12px;text-overflow:ellipsis;white-space:nowrap}.market-result-copy em,.market-result-copy i{padding:2px 4px;border-radius:4px;color:#b45309;background:#fef3c7;font-size:8px;font-style:normal}.market-result-copy small{display:flex;gap:5px;color:var(--cpu-text-secondary);font-size:9px}.market-result>strong{flex:0 0 auto;color:#ef4444;font-size:12px}

.svc-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 4px;
  cursor: pointer;
  border-radius: 6px;
  border-bottom: 1px dashed var(--cpu-border-soft);
  min-width: 0;
  overflow: hidden;
}
.svc-row:last-child { border-bottom: none; }
.svc-row:hover { background: var(--cpu-surface-subtle); }
.svc-row:focus-visible {
  outline: 2px solid var(--cpu-primary);
  outline-offset: 2px;
}
.svc-row > div { flex: 1; min-width: 0; }
.svc-row > .el-icon { flex: 0 0 auto; }
.s-name { font-size: 14px; color: var(--cpu-text); overflow-wrap: anywhere; }
.s-desc { font-size: 12px; color: var(--cpu-text-secondary); margin-top: 2px; overflow-wrap: anywhere; }
.icon { font-size: 20px; }

.empty { text-align: center; }

@media (max-width: 640px) {
  .market-results{grid-template-columns:1fr}.market-result{padding:8px}.market-result>strong{font-size:11px}
  .head h2 {
    font-size: 18px;
    line-height: 1.4;
    word-break: break-word;
  }

  .cpu-card {
    border-radius: 10px;
    padding: 14px 12px;
  }

  .svc-row {
    align-items: flex-start;
    gap: 10px;
    padding: 12px 2px;
  }

  .s-desc {
    line-height: 1.5;
  }
}
</style>
