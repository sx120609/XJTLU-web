<template>
  <section class="ehall-panel" v-loading="loading">
    <div class="panel-head">
      <div>
        <div class="title-row">
          <span class="portal-mark">西</span>
          <div>
            <h3>XJTLU 融合门户</h3>
            <p v-if="status.active">
              已连接{{ status.displayName ? ` · ${status.displayName}` : '' }}
            </p>
            <p v-else>站内账号已登录 · 融合门户待连接</p>
          </div>
        </div>
      </div>
      <div class="head-actions">
        <el-button plain @click="openOfficialPortal">打开官方门户</el-button>
        <el-button v-if="status.active" :loading="loading" @click="loadServices">刷新</el-button>
      </div>
    </div>

    <el-alert
      v-if="!loading && status.connecting"
      type="info"
      :closable="false"
      show-icon
      title="正在后台连接 XJTLU 融合门户"
      description="无需停留在登录页面，连接成功后服务列表会自动出现。"
    />

    <el-alert
      v-if="!loading && !status.active && !status.connecting"
      type="warning"
      :closable="false"
      show-icon
      title="站内账号已登录，但融合门户连接已失效"
      description="站内登录和学校融合门户是两层会话。重新完成一次学校认证即可恢复门户连接，不会先退出站内账号。"
    />

    <div v-if="!loading && !status.active && !status.connecting" class="relogin-row">
      <el-button type="primary" @click="reconnect">重新连接融合门户</el-button>
    </div>

    <template v-else-if="status.active">
      <div v-if="services.length" class="controls">
        <el-input v-model="keyword" clearable placeholder="搜索应用" class="search-input">
          <template #prefix><el-icon><Search /></el-icon></template>
        </el-input>
        <div class="category-list">
          <button type="button" :class="{ active: !category }" @click="category = ''">全部 {{ services.length }}</button>
          <button
            v-for="item in categories"
            :key="item.name"
            type="button"
            :class="{ active: category === item.name }"
            @click="category = item.name"
          >
            {{ item.name }} {{ item.count }}
          </button>
        </div>
      </div>

      <div v-if="filteredGroups.length" class="catalog-groups">
        <section
          v-for="group in filteredGroups"
          :key="group.name"
          class="catalog-group"
          :class="{ featured: group.featured }"
        >
          <h4>{{ group.name }} <span>{{ group.services.length }}</span></h4>
          <div class="service-grid">
            <button
              v-for="service in group.services"
              :key="service.id"
              type="button"
              class="service-card"
              :disabled="launchingId === service.id || !service.permission"
              :title="service.description || service.name"
              @click="launch(service)"
            >
              <span class="service-icon">
                <img v-if="service.icon" :src="service.icon" :alt="service.name" referrerpolicy="no-referrer" @error="hideBrokenImage" />
                <span v-else>{{ service.name.slice(0, 1) }}</span>
              </span>
              <span class="service-copy">
                <strong>{{ service.name }}</strong>
              </span>
              <span class="service-meta">
                <em v-if="service.favorite">已收藏</em>
                <el-icon v-if="launchingId === service.id" class="is-loading"><Loading /></el-icon>
                <el-icon v-else><Right /></el-icon>
              </span>
            </button>
          </div>
        </section>
      </div>

      <el-empty
        v-else-if="!loading && services.length"
        description="没有符合当前搜索条件的服务"
      />
      <el-empty
        v-else-if="!loading"
        description="融合门户暂未返回可用应用，可先在官方门户中查看完整应用目录"
      >
        <el-button type="primary" plain @click="openOfficialPortal">查看完整应用目录</el-button>
      </el-empty>
    </template>

    <el-alert v-if="error" type="error" :closable="false" show-icon :title="error" />
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { Loading, Right, Search } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import { useRouter } from "vue-router";
import { ehallApi, type EhallService, type EhallStatus } from "@/api/ehall";

const OFFICIAL_PORTAL_URL = "https://ehall.xjtlu.edu.cn/default/index.html#/apps";
const FEATURED_CATEGORY = "热门应用";
const router = useRouter();
const status = ref<EhallStatus>({ active: false });
const services = ref<EhallService[]>([]);
const loading = ref(false);
const error = ref("");
const keyword = ref("");
const category = ref("");
const launchingId = ref("");
let connectionPollTimer = 0;

const isFeatured = (service: EhallService) => typeof service.featuredRank === "number";

const categories = computed(() => {
  const counts = new Map<string, number>();
  for (const service of services.value) {
    if (!service.category) continue;
    counts.set(service.category, (counts.get(service.category) || 0) + 1);
  }
  const featuredCount = services.value.filter(isFeatured).length;
  return [
    ...(featuredCount ? [{ name: FEATURED_CATEGORY, count: featuredCount }] : []),
    ...Array.from(counts, ([name, count]) => ({ name, count })),
  ];
});

const filtered = computed(() => {
  const query = keyword.value.trim().toLowerCase();
  return services.value.filter((service) => {
    if (category.value === FEATURED_CATEGORY && !isFeatured(service)) return false;
    if (category.value && category.value !== FEATURED_CATEGORY && service.category !== category.value) return false;
    if (!query) return true;
    return [service.name, service.description, service.department, service.category]
      .some((value) => value.toLowerCase().includes(query));
  });
});

const filteredGroups = computed(() => {
  const result: Array<{ name: string; services: EhallService[]; featured: boolean }> = [];
  if (!category.value || category.value === FEATURED_CATEGORY) {
    const featured = filtered.value
      .filter(isFeatured)
      .sort((left, right) => (left.featuredRank ?? Number.MAX_SAFE_INTEGER) - (right.featuredRank ?? Number.MAX_SAFE_INTEGER));
    if (featured.length) result.push({ name: FEATURED_CATEGORY, services: featured, featured: true });
  }
  if (category.value === FEATURED_CATEGORY) return result;
  const groups = new Map<string, EhallService[]>();
  for (const service of filtered.value) {
    const name = service.category || "其他";
    const entries = groups.get(name) || [];
    entries.push(service);
    groups.set(name, entries);
  }
  result.push(...Array.from(groups, ([name, services]) => ({ name, services, featured: false })));
  return result;
});

onMounted(load);

onBeforeUnmount(() => {
  window.clearTimeout(connectionPollTimer);
});

function pollConnectionStatus() {
  window.clearTimeout(connectionPollTimer);
  connectionPollTimer = window.setTimeout(() => void load(), 1200);
}

async function load() {
  loading.value = true;
  error.value = "";
  try {
    status.value = await ehallApi.status({ suppressErrorMessage: true });
    if (status.value.active) {
      window.clearTimeout(connectionPollTimer);
      await fetchServices();
    } else if (status.value.connecting) {
      pollConnectionStatus();
    }
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : "融合门户连接失败";
  } finally {
    loading.value = false;
  }
}

async function fetchServices() {
  const result = await ehallApi.services({ suppressErrorMessage: true });
  services.value = result.services || [];
}

async function loadServices() {
  loading.value = true;
  error.value = "";
  try {
    await fetchServices();
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : "融合门户应用加载失败";
  } finally {
    loading.value = false;
  }
}

async function reconnect() {
  await router.push({ name: "login", query: { redirect: "/services", reconnect: "ehall" } });
}

function openOfficialPortal() {
  window.open(OFFICIAL_PORTAL_URL, "_blank", "noopener,noreferrer");
}

async function launch(service: EhallService) {
  if (!service.permission || launchingId.value) return;
  const popup = window.open("about:blank", "_blank");
  if (popup) popup.opener = null;
  launchingId.value = service.id;
  try {
    const result = await ehallApi.launch(service, { suppressErrorMessage: true });
    if (popup) popup.location.href = result.url;
    else ElMessage.warning("浏览器阻止了新窗口，请允许弹窗后重试");
  } catch (reason) {
    popup?.close();
    ElMessage.error(reason instanceof Error ? reason.message : "无法打开该融合门户应用");
  } finally {
    launchingId.value = "";
  }
}

function hideBrokenImage(event: Event) {
  (event.currentTarget as HTMLImageElement).style.display = "none";
}
</script>

<style scoped>
.ehall-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 14px;
  background: var(--cpu-card);
  box-shadow: 0 8px 26px rgba(15, 23, 42, 0.05);
}
.panel-head,
.title-row,
.head-actions,
.controls,
.service-card,
.service-meta {
  display: flex;
  align-items: center;
}
.panel-head { justify-content: space-between; gap: 16px; }
.title-row { gap: 12px; }
.portal-mark {
  width: 48px;
  height: 48px;
  display: grid;
  place-items: center;
  border-radius: 13px;
  color: white;
  font-size: 23px;
  font-weight: 700;
  background: linear-gradient(145deg, #10145d, #7c1dac);
}
.panel-head h3 { margin: 0; font-size: 18px; }
.panel-head p { margin: 4px 0 0; color: var(--cpu-text-secondary); font-size: 12px; }
.head-actions { gap: 8px; }
.relogin-row { display: flex; justify-content: flex-end; }
.controls { align-items: flex-start; gap: 12px; flex-direction: column; }
.search-input { width: min(100%, 360px); }
.category-list { display: flex; gap: 8px; flex-wrap: wrap; }
.category-list button {
  padding: 6px 11px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 999px;
  color: var(--cpu-text-secondary);
  background: var(--cpu-card);
  cursor: pointer;
}
.category-list button.active { color: white; border-color: #4c1d95; background: #4c1d95; }
.catalog-groups { display: flex; flex-direction: column; gap: 22px; }
.catalog-group h4 { margin: 0 0 11px; color: var(--cpu-text); font-size: 15px; }
.catalog-group h4 span { margin-left: 5px; color: var(--cpu-text-secondary); font-size: 12px; font-weight: 500; }
.catalog-group.featured {
  padding: 17px;
  border: 1px solid #fecdd3;
  border-radius: 16px;
  background: #fff1f2;
}
.catalog-group.featured h4 { color: #be123c; }
.catalog-group.featured h4 span { color: #e11d48; }
.catalog-group.featured .service-card { background: rgba(255, 255, 255, .9); }
.service-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 260px), 1fr)); gap: 10px; }
.service-card {
  min-width: 0;
  gap: 12px;
  padding: 13px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 12px;
  color: var(--cpu-text);
  background: var(--cpu-card);
  cursor: pointer;
  text-align: left;
  transition: border-color .16s, transform .16s, box-shadow .16s;
}
.service-card:hover:not(:disabled) { border-color: #6d28d9; transform: translateY(-1px); box-shadow: 0 8px 18px rgba(76, 29, 149, .1); }
.service-card:disabled { cursor: not-allowed; opacity: .58; }
.service-icon {
  width: 44px;
  height: 44px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  overflow: hidden;
  border-radius: 11px;
  color: #4c1d95;
  font-weight: 700;
  background: #f2edff;
}
.service-icon img { width: 34px; height: 34px; object-fit: contain; }
.service-copy { min-width: 0; flex: 1; }
.service-copy strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; }
.service-meta { gap: 7px; color: #6d28d9; }
.service-meta em { padding: 2px 6px; border-radius: 999px; color: #b45309; background: #fef3c7; font-size: 10px; font-style: normal; }
.service-meta em.guide-only { color: #475569; background: #e2e8f0; }
@media (max-width: 700px) {
  .ehall-panel { padding: 15px; border-radius: 12px; }
  .panel-head { align-items: flex-start; flex-direction: column; }
  .head-actions { width: 100%; }
  .head-actions .el-button { flex: 1; margin-left: 0; }
  .category-list { flex-wrap: nowrap; width: 100%; overflow-x: auto; padding-bottom: 2px; }
  .category-list button { flex: 0 0 auto; }
  .service-grid { grid-template-columns: 1fr; }
  .catalog-group.featured { padding: 13px; border-radius: 13px; }
}
</style>
