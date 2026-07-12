<template>
  <div class="academic-page jwxt-page">
    <header class="page-head">
      <div>
        <div class="eyebrow">XJTLU e-Bridge</div>
        <h2><el-icon><School /></el-icon><span>教务数据</span></h2>
        <p>课表、成绩和考试安排均实时读取自学校 eBridge；页面框架会先显示，数据随后自动填充。</p>
      </div>
      <div class="head-actions">
        <a :href="OFFICIAL_URL" target="_blank" rel="noopener noreferrer">打开官方 eBridge</a>
        <el-button v-if="status.active" :loading="loading" @click="load()">刷新数据</el-button>
      </div>
    </header>

    <el-alert
      v-if="statusChecked && status.connecting"
      type="info"
      show-icon
      :closable="false"
      title="本站登录已完成，正在后台连接 XJTLU eBridge"
      description="课表缓存会先显示；学校连接建立后，成绩、考试和实时课表将自动更新。"
    />
    <el-alert
      v-if="statusChecked && !status.active && !status.connecting"
      type="warning"
      show-icon
      :closable="false"
      title="当前没有可用的 eBridge 教务会话"
      description="请退出后重新使用 XJTLU 账号登录一次，系统会同时建立融合门户和 eBridge 会话。"
    />
    <div v-if="statusChecked && !status.active && !status.connecting" class="relogin-row">
      <el-button type="primary" @click="relogin">退出并重新登录</el-button>
    </div>

    <template v-if="!statusChecked || status.active || status.connecting">
      <section class="identity-card session-info">
        <span class="identity-mark" aria-hidden="true"><el-icon><Reading /></el-icon></span>
        <div>
          <strong>{{ overview?.student.name || status.displayName || '正在连接学校教务系统' }}</strong>
          <small>{{ overview?.student.id ? `Student ID · ${overview.student.id}` : status.username || '实时会话检查中' }}</small>
        </div>
        <em>{{ loading ? '实时同步中' : '已连接' }}</em>
      </section>

      <section class="data-card cpu-card jwxt-tabs" :class="{ 'schedule-card': activeTab === 'schedule' }">
        <el-tabs v-model="activeTab">
          <el-tab-pane label="📅 课表" name="schedule">
            <el-alert
              v-if="scheduleError"
              type="error"
              show-icon
              :closable="false"
              :title="scheduleError"
            />
            <SchedulePane
              :data="scheduleData"
              :loading="loading && !scheduleData"
              source="ebridge"
              :auto-load="false"
              :cache-enabled="true"
            />
          </el-tab-pane>

          <el-tab-pane :label="`📊 成绩${overview ? ` ${overview.grades.length}` : ''}`" name="grades">
            <GradesPane :data="cpuGradesData" :loading="loading && !overview" source="ebridge" />
            <p class="data-note">成绩仅供本人查看；最终结果、升学和学位判定以学校正式记录为准。</p>
          </el-tab-pane>

          <el-tab-pane :label="`📝 考试${overview ? ` ${overview.exams.length}` : ''}`" name="exams">
            <div v-if="loading && !overview" class="exam-skeleton" aria-label="实时考试安排加载中">
              <span v-for="row in 4" :key="row" />
            </div>
            <div v-else-if="overview?.exams.length" class="exam-list">
              <article v-for="exam in overview.exams" :key="`${exam.moduleCode}-${exam.date}-${exam.startTime}`">
                <div class="exam-date">
                  <strong>{{ exam.date }}</strong>
                  <span>{{ exam.day }}</span>
                </div>
                <div class="exam-main">
                  <div><b>{{ exam.moduleCode }}</b><strong>{{ exam.moduleTitle }}</strong></div>
                  <p>{{ exam.startTime }} 开始 · {{ exam.duration }} · {{ exam.room }}</p>
                  <div class="exam-tags">
                    <span>入场 {{ exam.admissionTime || '—' }}</span>
                    <span>座位 {{ exam.seat || '待发布' }}</span>
                    <span v-if="exam.area">区域 {{ exam.area }}</span>
                    <span v-if="exam.entrance">{{ exam.entrance }}</span>
                  </div>
                </div>
              </article>
            </div>
            <el-empty v-else description="当前没有已发布的考试安排" />
            <p class="data-note">考试安排可能更新，考试前一天请再次在官方 eBridge 核对。</p>
          </el-tab-pane>
        </el-tabs>
      </section>
    </template>

    <el-alert v-if="error" type="error" show-icon :closable="false" :title="error" />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import {
  academicApi,
  type AcademicOverview,
  type AcademicSchedule,
  type AcademicStatus,
} from "@/api/academic";
import SchedulePane from "@/components/jwxt/SchedulePane.vue";
import GradesPane from "@/components/jwxt/GradesPane.vue";
import { useAuthStore } from "@/stores/auth";
import { Reading, School } from "@element-plus/icons-vue";

const OFFICIAL_URL = "https://ebridge.xjtlu.edu.cn/urd/sits.urd/run/SIW_LGN";
const EBRIDGE_SCHEDULE_CACHE_PREFIX = "xjtlu-ebridge-schedule-v1";
const EBRIDGE_SCHEDULE_CACHE_MAX_AGE = 30 * 24 * 60 * 60 * 1000;
const router = useRouter();
const auth = useAuthStore();
const status = ref<AcademicStatus>({ active: false });
const overview = ref<AcademicOverview | null>(null);
const scheduleData = ref<AcademicSchedule | null>(null);
const scheduleError = ref("");
const loading = ref(false);
const error = ref("");
const activeTab = ref("schedule");
const statusChecked = ref(false);
let connectionPollTimer = 0;

const cpuGradesData = computed(() => {
  if (!overview.value) return null;
  const list = overview.value.grades.map((grade) => {
    const semester = [grade.academicYear, grade.period].filter(Boolean).join(" · ");
    const credits = Number.parseFloat(grade.credit);
    return {
      semester: semester || overview.value?.academicYear || "未知学期",
      courseCode: grade.moduleCode,
      courseName: grade.moduleTitle,
      score: grade.mark,
      scoreNum: Number.isFinite(Number.parseFloat(grade.mark)) ? Number.parseFloat(grade.mark) : null,
      credits: Number.isFinite(credits) ? credits : undefined,
      courseAttr: grade.additionalLearning ? "附加学习" : "正式课程",
      grade: grade.grade,
      attempt: grade.attempt,
      components: grade.components,
    };
  });
  const semesterLabels = Array.from(new Set(list.map((item) => item.semester)));
  return {
    parsed: {
      semesters: semesterLabels.map((label) => ({ value: label, label })),
      currentSemester: semesterLabels[0] || "",
      list,
    },
  };
});

onMounted(() => {
  restoreScheduleCache(auth.user?.username);
  void load();
});

onBeforeUnmount(() => {
  window.clearTimeout(connectionPollTimer);
});

function pollConnectionStatus() {
  window.clearTimeout(connectionPollTimer);
  connectionPollTimer = window.setTimeout(() => void load(), 1200);
}

function scheduleCacheKey(username?: string | null) {
  const account = username?.trim().toLowerCase();
  return account ? `${EBRIDGE_SCHEDULE_CACHE_PREFIX}:${encodeURIComponent(account)}` : "";
}

function restoreScheduleCache(username?: string | null) {
  if (scheduleData.value) return;
  const key = scheduleCacheKey(username);
  if (!key) return;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return;
    const cached = JSON.parse(raw) as { savedAt?: number; data?: AcademicSchedule };
    if (!cached.savedAt || Date.now() - cached.savedAt > EBRIDGE_SCHEDULE_CACHE_MAX_AGE) {
      localStorage.removeItem(key);
      return;
    }
    if (!cached.data?.parsed || !cached.data?.calendar || !cached.data?.source) return;
    scheduleData.value = cached.data;
  } catch {
    localStorage.removeItem(key);
  }
}

function saveScheduleCache(username: string | undefined, data: AcademicSchedule) {
  const key = scheduleCacheKey(username);
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), data }));
  } catch {
    /* Browsers may reject storage in private mode or when the quota is full. */
  }
}

async function load() {
  loading.value = true;
  error.value = "";
  scheduleError.value = "";
  try {
    const nextStatus = await academicApi.status({
      suppressErrorMessage: true,
    });
    statusChecked.value = true;
    if (nextStatus.active) {
      window.clearTimeout(connectionPollTimer);
      status.value = nextStatus;
      restoreScheduleCache(nextStatus.username || auth.user?.username);
      const [overviewResult, scheduleResult] = await Promise.allSettled([
        academicApi.overview({ refresh: true, suppressErrorMessage: true }),
        academicApi.schedule({ refresh: true, suppressErrorMessage: true }),
      ]);
      if (overviewResult.status === "fulfilled") {
        overview.value = overviewResult.value;
      } else {
        overview.value = null;
        error.value = errorMessage(overviewResult.reason, "学业记录和考试安排加载失败");
      }
      if (scheduleResult.status === "fulfilled") {
        scheduleData.value = scheduleResult.value;
        saveScheduleCache(nextStatus.username || auth.user?.username, scheduleResult.value);
      } else {
        scheduleError.value = errorMessage(scheduleResult.reason, "个人课表加载失败");
      }
    } else if (nextStatus.connecting) {
      status.value = nextStatus;
      restoreScheduleCache(nextStatus.username || auth.user?.username);
      pollConnectionStatus();
    } else {
      status.value = nextStatus;
      overview.value = null;
      scheduleData.value = null;
    }
  } catch (reason) {
    statusChecked.value = true;
    error.value = reason instanceof Error ? reason.message : "eBridge 教务数据加载失败";
  } finally {
    loading.value = false;
  }
}

function errorMessage(reason: unknown, fallback: string) {
  const responseMessage = (reason as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
  if (typeof responseMessage === "string" && responseMessage) return responseMessage;
  return reason instanceof Error && reason.message ? reason.message : fallback;
}

async function relogin() {
  await auth.logout();
  await router.push({ name: "login", query: { redirect: "/academic" } });
}
</script>

<style scoped>
.academic-page { display: flex; flex-direction: column; gap: 18px; }
.page-head,
.head-actions,
.identity-card,
.summary-grid,
.exam-list article,
.exam-main > div,
.exam-tags { display: flex; align-items: center; }
.page-head { justify-content: space-between; gap: 18px; }
.eyebrow { margin-bottom: 4px; color: var(--cpu-primary); font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
.page-head h2 { display: flex; align-items: center; gap: 8px; margin: 0; color: var(--cpu-text); font-size: 24px; }
.page-head h2 .el-icon { color: var(--cpu-primary); font-size: 23px; }
.page-head p { margin: 6px 0 0; color: var(--cpu-text-secondary); font-size: 13px; }
.head-actions { gap: 10px; }
.head-actions a { color: var(--cpu-primary); font-size: 13px; font-weight: 600; text-decoration: none; }
.head-actions a:hover { color: var(--cpu-primary-light); }
.relogin-row { display: flex; justify-content: flex-end; }
.identity-card,
.data-card { padding: 20px; border: 1px solid var(--cpu-border-soft); border-radius: 14px; background: var(--cpu-card); }
.cpu-card { box-shadow: var(--cpu-shadow-sm); }
.identity-card { gap: 13px; }
.identity-card.session-info { border-color: color-mix(in srgb, var(--cpu-primary) 30%, var(--cpu-border-soft)); background: var(--cpu-primary-soft); }
.identity-mark { width: 48px; height: 48px; display: grid; place-items: center; border-radius: 14px; color: var(--cpu-primary); background: var(--cpu-card); border: 1px solid color-mix(in srgb, var(--cpu-primary) 28%, var(--cpu-border-soft)); font-size: 25px; }
.identity-card > div { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 4px; }
.identity-card strong { font-size: 16px; }
.identity-card small { color: var(--cpu-text-secondary); }
.identity-card em { padding: 4px 9px; border-radius: 999px; color: var(--cpu-primary); background: var(--cpu-card); border: 1px solid color-mix(in srgb, var(--cpu-primary) 24%, var(--cpu-border-soft)); font-size: 11px; font-style: normal; }
.summary-grid { align-items: stretch; display: grid; grid-template-columns: repeat(4, 1fr); gap: 11px; }
.summary-grid article { min-width: 0; padding: 15px; border: 1px solid var(--cpu-border-soft); border-radius: 12px; background: var(--cpu-card); }
.summary-grid span,
.summary-grid small { display: block; color: var(--cpu-text-secondary); font-size: 11px; }
.summary-grid strong { display: block; margin: 7px 0 4px; font-size: 24px; }
.summary-grid.is-loading article,
.table-skeleton span,
.exam-skeleton span {
  position: relative;
  overflow: hidden;
}
.summary-grid.is-loading article::after,
.table-skeleton span::after,
.exam-skeleton span::after {
  position: absolute;
  inset: 0;
  content: "";
  background: linear-gradient(100deg, transparent 20%, rgba(148, 163, 184, .18) 45%, transparent 70%);
  transform: translateX(-100%);
  animation: academic-shimmer 1.25s linear infinite;
}
.data-card { min-width: 0; }
.schedule-card { padding-bottom: 8px; }
.jwxt-tabs :deep(.el-tabs__header) { margin-bottom: 14px; }
.jwxt-tabs :deep(.el-tabs__item) { font-weight: 600; }
.records-toolbar { display: flex; align-items: center; justify-content: flex-end; gap: 9px; margin-bottom: 4px; color: var(--cpu-text-secondary); font-size: 12px; }
.year-select { width: 125px; }
.table-wrap { width: 100%; overflow-x: auto; }
.table-skeleton { display: grid; gap: 9px; padding: 8px 0 4px; }
.table-skeleton span { height: 42px; border-radius: 8px; background: var(--cpu-surface-subtle); }
.exam-skeleton { display: grid; gap: 10px; }
.exam-skeleton span { height: 76px; border-radius: 12px; background: var(--cpu-surface-subtle); }
.mark { color: var(--cpu-primary); }
.data-note { margin: 14px 0 0; color: var(--cpu-text-secondary); font-size: 11px; line-height: 1.6; }
.exam-list { display: flex; flex-direction: column; gap: 10px; }
.exam-list article { align-items: stretch; gap: 15px; padding: 14px; border: 1px solid var(--cpu-border-soft); border-radius: 12px; }
.exam-date { width: 112px; flex: 0 0 auto; display: flex; flex-direction: column; justify-content: center; gap: 5px; padding-right: 14px; border-right: 1px solid var(--cpu-border-soft); }
.exam-date strong { font-size: 14px; }
.exam-date span { color: var(--cpu-text-secondary); font-size: 11px; }
.exam-main { min-width: 0; flex: 1; }
.exam-main > div { gap: 9px; }
.exam-main b { color: var(--cpu-primary); font-size: 12px; }
.exam-main strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; }
.exam-main p { margin: 7px 0; color: var(--cpu-text-secondary); font-size: 12px; }
.exam-tags { gap: 7px; flex-wrap: wrap; }
.exam-tags span { padding: 3px 7px; border-radius: 999px; color: var(--cpu-text-secondary); background: var(--cpu-surface-subtle); font-size: 10px; }
@keyframes academic-shimmer { to { transform: translateX(100%); } }
@media (max-width: 850px) {
  .summary-grid { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 700px) {
  .page-head { align-items: flex-start; flex-direction: column; }
  .head-actions { width: 100%; justify-content: space-between; }
  .identity-card,
  .data-card { padding: 15px; border-radius: 12px; }
  .summary-grid { grid-template-columns: 1fr 1fr; }
  .summary-grid article { padding: 12px; }
  .summary-grid strong { font-size: 20px; }
  .jwxt-tabs { margin: 0 -6px; padding: 10px 8px 12px; }
  .jwxt-tabs :deep(.el-tabs__nav-wrap::after),
  .jwxt-tabs :deep(.el-tabs__active-bar) { display: none; }
  .jwxt-tabs :deep(.el-tabs__nav) { gap: 8px; }
  .jwxt-tabs :deep(.el-tabs__item) { height: 34px; padding: 0 12px; border-radius: 999px; background: var(--cpu-surface-subtle); }
  .jwxt-tabs :deep(.el-tabs__item.is-active) { color: white; background: linear-gradient(135deg, var(--cpu-primary), var(--cpu-primary-dark)); }
  .exam-list article { flex-direction: column; }
  .exam-date { width: auto; padding: 0 0 10px; border-right: 0; border-bottom: 1px solid var(--cpu-border-soft); }
}
</style>
