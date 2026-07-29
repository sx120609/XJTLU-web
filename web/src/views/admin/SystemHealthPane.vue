<template>
  <section class="health-pane">
    <header class="pane-head">
      <div>
        <span class="eyebrow">发布与排障</span>
        <h2>运行健康</h2>
        <p>查看数据库连通性、服务资源和后台任务最近一次执行结果。</p>
      </div>
      <el-button :loading="loading" @click="load">刷新状态</el-button>
    </header>

    <el-alert v-if="error" type="warning" :closable="false" show-icon :title="error" />

    <div v-if="snapshot" class="summary-grid" v-loading="loading">
      <article class="summary-card" :class="snapshot.database.ok ? 'ok' : 'bad'">
        <span>数据库</span>
        <strong>{{ snapshot.database.ok ? "连接正常" : "连接异常" }}</strong>
        <small>{{ snapshot.database.latencyMs }} ms</small>
      </article>
      <article class="summary-card">
        <span>服务运行</span>
        <strong>{{ duration(snapshot.process.uptimeMs) }}</strong>
        <small>启动于 {{ dateTime(snapshot.process.startedAt) }}</small>
      </article>
      <article class="summary-card">
        <span>堆内存</span>
        <strong>{{ bytes(snapshot.process.memory.heapUsedBytes) }}</strong>
        <small>上限 {{ bytes(snapshot.process.memory.heapTotalBytes) }}</small>
      </article>
      <article class="summary-card" :class="failedJobs ? 'bad' : 'ok'">
        <span>后台任务</span>
        <strong>{{ failedJobs ? `${failedJobs} 项异常` : "当前正常" }}</strong>
        <small>{{ snapshot.jobs.length }} 项已登记</small>
      </article>
      <article class="summary-card" :class="snapshot.cache.lookups && snapshot.cache.hitRate < 20 ? 'bad' : 'ok'">
        <span>缓存命中率</span>
        <strong>{{ snapshot.cache.hitRate }}%</strong>
        <small>{{ snapshot.cache.hits }} 命中 / {{ snapshot.cache.lookups }} 查询</small>
      </article>
      <article class="summary-card">
        <span>最慢接口 P95</span>
        <strong>{{ snapshot.http.slowestRoutes[0]?.p95Ms ?? 0 }} ms</strong>
        <small>{{ snapshot.http.retainedRouteCount }} 条路由有采样</small>
      </article>
    </div>

    <section v-if="snapshot" class="performance-card">
      <header><div><strong>接口性能采样</strong><p>按规范化路由保留最近 240 个样本，重点观察列表和后台聚合接口的 P95。</p></div><small>进程内窗口，服务重启后重新累计</small></header>
      <div class="performance-table-wrap">
        <table>
          <thead><tr><th>路由</th><th>请求</th><th>P50</th><th>P95</th><th>最大</th><th>5xx</th></tr></thead>
          <tbody><tr v-for="route in snapshot.http.slowestRoutes.slice(0, 10)" :key="route.route"><td>{{ route.route }}</td><td>{{ route.requests }}</td><td>{{ route.p50Ms }} ms</td><td><b>{{ route.p95Ms }} ms</b></td><td>{{ route.maxMs }} ms</td><td>{{ route.errors }}</td></tr></tbody>
        </table>
      </div>
      <el-empty v-if="!snapshot.http.slowestRoutes.length" description="等待接口性能样本" />
    </section>

    <div v-if="snapshot" class="job-list">
      <article v-for="job in snapshot.jobs" :key="job.key" class="job-card">
        <div class="job-main">
          <div class="job-title">
            <strong>{{ job.label }}</strong>
            <el-tag size="small" :type="tagType(job.status)">{{ statusLabel(job.status) }}</el-tag>
          </div>
          <p v-if="job.lastError" class="job-error">{{ job.lastError }}</p>
          <p v-else>{{ job.lastSucceededAt ? `最近成功 ${dateTime(job.lastSucceededAt)}` : "等待首次执行" }}</p>
        </div>
        <dl>
          <div><dt>运行</dt><dd>{{ job.runs }}</dd></div>
          <div><dt>失败</dt><dd>{{ job.failures }}</dd></div>
          <div><dt>耗时</dt><dd>{{ job.lastDurationMs == null ? "—" : `${job.lastDurationMs} ms` }}</dd></div>
          <div><dt>跳过重叠</dt><dd>{{ job.skippedOverlaps }}</dd></div>
        </dl>
      </article>
      <el-empty v-if="!snapshot.jobs.length" description="后台任务尚未启动" />
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { adminApi, type SystemHealthSnapshot } from "@/api/admin";

const loading = ref(false);
const error = ref("");
const snapshot = ref<SystemHealthSnapshot | null>(null);
const failedJobs = computed(() => snapshot.value?.jobs.filter((job) => job.status === "failed").length ?? 0);

onMounted(load);

async function load() {
  loading.value = true;
  error.value = "";
  try {
    snapshot.value = await adminApi.systemHealth({ suppressErrorMessage: true });
  } catch (reason) {
    error.value = requestMessage(reason) || "运行状态加载失败，请稍后重试";
  } finally {
    loading.value = false;
  }
}

function requestMessage(error: unknown) {
  if (typeof error !== "object" || error === null) return "";
  const message = (
    error as { response?: { data?: { message?: unknown } } }
  ).response?.data?.message;
  if (typeof message === "string") return message;
  return error instanceof Error ? error.message : "";
}

function statusLabel(status: SystemHealthSnapshot["jobs"][number]["status"]) {
  return ({ waiting: "等待", running: "执行中", healthy: "正常", failed: "异常" } as const)[status];
}

function tagType(status: SystemHealthSnapshot["jobs"][number]["status"]) {
  return status === "failed" ? "danger" : status === "healthy" ? "success" : status === "running" ? "primary" : "info";
}

function bytes(value: number) {
  if (!Number.isFinite(value) || value < 0) return "—";
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function duration(ms: number) {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时 ${minutes % 60} 分`;
  return `${Math.floor(hours / 24)} 天 ${hours % 24} 小时`;
}

function dateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(value));
}
</script>

<style scoped>
.health-pane { display: grid; gap: 18px; padding: 20px; }
.pane-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; }
.eyebrow { color: var(--cpu-primary); font-size: 12px; font-weight: 700; letter-spacing: .08em; }
h2 { margin: 5px 0 6px; color: var(--cpu-text); font-size: 24px; }
.pane-head p, .job-main p { margin: 0; color: var(--cpu-text-secondary); font-size: 13px; }
.summary-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.summary-card { display: grid; gap: 5px; padding: 16px; border: 1px solid var(--cpu-border-soft); border-radius: 14px; background: var(--cpu-card); }
.summary-card span, .summary-card small { color: var(--cpu-text-secondary); }
.summary-card strong { color: var(--cpu-text); font-size: 19px; }
.summary-card.ok { border-color: color-mix(in srgb, var(--cpu-success) 34%, var(--cpu-border-soft)); }
.summary-card.bad { border-color: color-mix(in srgb, var(--cpu-danger) 45%, var(--cpu-border-soft)); }
.job-list { display: grid; gap: 10px; }
.performance-card { display: grid; gap: 12px; padding: 16px; border: 1px solid var(--cpu-border-soft); border-radius: 14px; background: var(--cpu-card); }
.performance-card header { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; }
.performance-card header p { margin: 4px 0 0; color: var(--cpu-text-secondary); font-size: 12px; }
.performance-card header small { color: var(--cpu-text-secondary); font-size: 11px; }
.performance-table-wrap { overflow-x: auto; }
.performance-card table { width: 100%; min-width: 620px; border-collapse: collapse; font-size: 12px; }
.performance-card th, .performance-card td { padding: 9px 8px; border-top: 1px solid var(--cpu-border-soft); text-align: right; }
.performance-card th:first-child, .performance-card td:first-child { max-width: 360px; text-align: left; overflow-wrap: anywhere; }
.job-card { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 18px; align-items: center; padding: 15px 16px; border: 1px solid var(--cpu-border-soft); border-radius: 14px; background: var(--cpu-card); }
.job-title { display: flex; align-items: center; gap: 9px; margin-bottom: 5px; color: var(--cpu-text); }
.job-error { color: var(--cpu-danger) !important; overflow-wrap: anywhere; }
dl { display: grid; grid-template-columns: repeat(4, minmax(62px, auto)); gap: 8px; margin: 0; }
dl div { display: grid; gap: 3px; }
dt { color: var(--cpu-text-secondary); font-size: 11px; }
dd { margin: 0; color: var(--cpu-text); font-size: 13px; font-weight: 650; }
@media (max-width: 900px) {
  .summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .job-card { grid-template-columns: 1fr; }
}
@media (max-width: 560px) {
  .health-pane { padding: 14px; }
  .pane-head { align-items: stretch; flex-direction: column; }
  .summary-grid { grid-template-columns: 1fr; }
  .performance-card header { align-items: flex-start; flex-direction: column; }
  dl { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
