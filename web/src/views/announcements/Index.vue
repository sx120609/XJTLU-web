<template>
  <div class="announce-page">
    <header class="page-head">
      <h1 class="title">📢 {{ isEnglish ? "Campus Announcements" : "校园公告" }}</h1>
      <p class="sub">{{ isEnglish ? "A shared view of eHall notices and public university announcement channels" : "汇总融合门户通知与学校公开公告渠道" }}</p>
    </header>

    <section class="official-section">
      <div class="section-head">
        <div>
          <div class="section-title-row">
            <span class="official-mark">X</span>
            <h2>{{ isEnglish ? "XJTLU eHall Notices" : "XJTLU 融合门户通知" }}</h2>
            <span v-if="noticeState === 'ready'" class="live-badge">{{ isEnglish ? "Scheduled sync" : "定时同步" }}</span>
          </div>
          <p>{{ isEnglish ? "Synced and stored through an authorized backend account; everyone reads the same announcement dataset" : "由后台授权账号统一同步并保存，所有人读取同一份公告数据" }}<span v-if="syncedAt"> · {{ isEnglish ? "Updated" : "更新于" }} {{ fmtRelative(syncedAt) }}</span>。</p>
        </div>
        <div class="section-actions">
          <el-button text :loading="noticesLoading" @click="loadNotices">{{ isEnglish ? "Refresh" : "刷新" }}</el-button>
          <a href="https://ehall.xjtlu.edu.cn/default/index.html#/homeXS" target="_blank" rel="noopener noreferrer">{{ isEnglish ? "Official page" : "官方页面" }}</a>
        </div>
      </div>

      <div v-if="noticesLoading" class="notice-skeletons">
        <el-skeleton v-for="index in 3" :key="index" animated :rows="1" />
      </div>
      <div v-else-if="noticeState === 'disconnected'" class="notice-state">
        <div>
          <strong>{{ isEnglish ? "Announcement sync is not enabled" : "公告同步尚未启用" }}</strong>
          <span>{{ isEnglish ? "An administrator must authorize a university account in the Announcements panel." : "请管理员在后台“公告”页授权一个学校账号。" }}</span>
        </div>
      </div>
      <el-alert v-else-if="noticesError" :title="noticesError" type="warning" :closable="false" show-icon>
        <template #default>
          <el-button text type="warning" @click="loadNotices">{{ isEnglish ? "Try again" : "重试" }}</el-button>
        </template>
      </el-alert>
      <el-empty v-else-if="!notices.length" :description="isEnglish ? 'No new eHall notices' : '当前没有新的融合门户通知'" :image-size="72" />
      <div v-else class="notice-list">
        <a
          v-for="notice in notices"
          :key="notice.id"
          :href="notice.url"
          target="_blank"
          rel="noopener noreferrer"
          class="notice-row"
        >
          <time class="notice-date">
            <strong>{{ noticeDay(notice.publishedAt) }}</strong>
            <span>{{ noticeMonth(notice.publishedAt) }}</span>
          </time>
          <span class="notice-copy">
            <strong>{{ notice.title }}</strong>
            <small>
              <span>{{ notice.category || (isEnglish ? 'Notice' : '通知') }}</span>
              <span v-if="notice.author">{{ notice.author }}</span>
              <span v-if="noticeTime(notice.publishedAt)">{{ noticeTime(notice.publishedAt) }}</span>
            </small>
          </span>
          <el-icon class="arrow"><Right /></el-icon>
        </a>
      </div>
    </section>

    <div v-loading="loading" class="cluster">
      <!-- 错误态：网络失败 / 后端 5xx -->
      <el-empty v-if="!loading && error" :description="error">
        <el-button type="primary" @click="reload">{{ isEnglish ? "Try again" : "重试" }}</el-button>
      </el-empty>
      <!-- 空态 -->
      <el-empty v-else-if="!loading && !boards.length" :description="isEnglish ? 'No announcement sources' : '暂无公告来源'" />
      <!-- 列表：router-link 直接跳转，避免 div+click 在移动端偶尔不响应 -->
      <router-link
        v-for="b in boards"
        :key="b.slug"
        :to="`/forum/b/${b.slug}`"
        class="board-card"
      >
        <div class="icon" :style="{ background: b.color || '#1d4d8a' }">{{ b.icon || '📢' }}</div>
        <div class="body">
          <div class="name-row">
            <span class="name">{{ b.name }}</span>
            <span class="count">{{ b.topicCount }} {{ isEnglish ? "items" : "条" }}</span>
          </div>
          <div class="desc" v-if="b.description">{{ b.description }}</div>
          <div class="meta">
            <span v-if="b.feedSource?.homepage">{{ isEnglish ? "Synced from" : "同步自" }} {{ shortHost(b.feedSource.homepage) }}</span>
            <span v-if="b.feedSource?.lastRunAt" class="time">· {{ isEnglish ? "Last updated" : "最近更新" }} {{ fmtRelative(b.feedSource.lastRunAt) }}</span>
          </div>
        </div>
        <el-icon class="arrow"><Right /></el-icon>
      </router-link>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { Right } from "@element-plus/icons-vue";
import { boardApi, type Board } from "@/api/board";
import { ehallApi, type EhallNotice } from "@/api/ehall";
import { fmtRelative } from "@/utils/format";
import { useLocale } from "@/i18n";

const all = ref<Board[]>([]);
const { isEnglish } = useLocale();
const loading = ref(false);
const error = ref("");
const notices = ref<EhallNotice[]>([]);
const noticesLoading = ref(false);
const noticesError = ref("");
const noticeState = ref<"idle" | "ready" | "disconnected">("idle");
const syncedAt = ref("");
const hiddenAnnouncementSlugs = new Set(["xinli-notice"]);
let loadSeq = 0;
let noticeLoadSeq = 0;

onMounted(() => {
  void reload();
  void loadNotices();
});

async function reload() {
  const seq = ++loadSeq;
  loading.value = true;
  error.value = "";
  try {
    const next = await boardApi.list({ suppressErrorMessage: true });
    if (seq !== loadSeq) return;
    all.value = next;
  } catch (error_) {
    if (seq !== loadSeq) return;
    error.value = normalizeAnnouncementsError(error_);
    all.value = [];
  } finally {
    if (seq === loadSeq) loading.value = false;
  }
}

async function loadNotices() {
  const seq = ++noticeLoadSeq;
  noticesLoading.value = true;
  noticesError.value = "";
  try {
    const result = await ehallApi.sharedNotices({
      suppressErrorMessage: true,
      suppressAuthMessage: true,
      suppressAuthRedirect: true,
    });
    if (seq !== noticeLoadSeq) return;
    notices.value = result.notices;
    syncedAt.value = result.syncedAt || "";
    noticeState.value = result.active ? "ready" : "disconnected";
  } catch {
    if (seq !== noticeLoadSeq) return;
    notices.value = [];
    noticeState.value = "idle";
    noticesError.value = isEnglish.value ? "eHall notices are temporarily unavailable. Please try again later." : "融合门户通知暂时无法加载，请稍后重试";
  } finally {
    if (seq === noticeLoadSeq) noticesLoading.value = false;
  }
}

const boards = computed(() => all.value.filter((b) =>
  b.type === "announce" &&
  !hiddenAnnouncementSlugs.has(b.slug) &&
  !b.name.includes("心理动态")
));

function shortHost(url?: string) {
  if (!url) return "";
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "");
  } catch { return url; }
}

function noticeDateParts(value: string) {
  const match = value.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T]+(\d{1,2}:\d{2}))?/);
  return match ? { month: Number(match[2]), day: Number(match[3]), time: match[4] || "" } : null;
}

function noticeDay(value: string) {
  return String(noticeDateParts(value)?.day ?? "--").padStart(2, "0");
}

function noticeMonth(value: string) {
  const month = noticeDateParts(value)?.month;
  return month ? (isEnglish.value ? new Date(2000, month - 1, 1).toLocaleString("en-US", { month: "short" }) : `${String(month).padStart(2, "0")}月`) : (isEnglish.value ? "Date" : "日期");
}

function noticeTime(value: string) {
  return noticeDateParts(value)?.time || "";
}

function normalizeAnnouncementsError(error_: unknown) {
  const status = (error_ as { response?: { status?: number; data?: { message?: string } } })?.response?.status;
  if (status && status < 500) {
    return (error_ as { response?: { data?: { message?: string } } })?.response?.data?.message || (isEnglish.value ? "Failed to load announcement sources" : "公告来源加载失败");
  }
  return isEnglish.value ? "Failed to load announcement sources. Please try again later." : "公告来源加载失败，请稍后再试";
}
</script>

<style scoped>
.announce-page { display: flex; flex-direction: column; gap: 18px; }
.page-head { display: flex; flex-direction: column; gap: 4px; }
.title { margin: 0; font-size: 22px; color: var(--cpu-text); }
.sub { margin: 0; font-size: 12px; color: var(--cpu-text-secondary); }

.official-section {
  padding: 18px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 14px;
  background: var(--cpu-card);
}
.section-head,
.section-title-row,
.section-actions,
.notice-state,
.notice-row,
.notice-copy small { display: flex; align-items: center; }
.section-head { justify-content: space-between; gap: 16px; margin-bottom: 14px; }
.section-title-row { gap: 9px; }
.section-title-row h2 { margin: 0; color: var(--cpu-text); font-size: 17px; }
.section-head p { margin: 5px 0 0; color: var(--cpu-text-secondary); font-size: 12px; }
.official-mark {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  border-radius: 9px;
  color: #fff;
  background: linear-gradient(135deg, #168776, #6d28d9);
  font-weight: 700;
}
.live-badge {
  padding: 2px 7px;
  border-radius: 999px;
  color: #137566;
  background: #e7f7f3;
  font-size: 10px;
}
.section-actions { gap: 6px; flex: 0 0 auto; }
.section-actions a { padding: 7px 10px; color: #6d28d9; font-size: 12px; text-decoration: none; }
.notice-skeletons { display: grid; gap: 13px; padding: 8px 2px; }
.notice-state { justify-content: space-between; gap: 16px; padding: 14px; border-radius: 10px; background: var(--cpu-surface-soft); }
.notice-state > div { display: flex; flex-direction: column; gap: 4px; }
.notice-state strong { font-size: 13px; }
.notice-state span { color: var(--cpu-text-secondary); font-size: 12px; }
.notice-list { display: flex; flex-direction: column; }
.notice-row {
  gap: 14px;
  min-width: 0;
  padding: 13px 4px;
  border-top: 1px solid var(--cpu-border-soft);
  color: inherit;
  text-decoration: none;
}
.notice-row:first-child { border-top: 0; }
.notice-row:hover .notice-copy > strong { color: var(--cpu-primary); }
.notice-date {
  width: 50px;
  min-width: 50px;
  padding: 7px 4px;
  border-radius: 9px;
  background: var(--cpu-surface-soft);
  text-align: center;
  font-style: normal;
}
.notice-date strong,
.notice-date span { display: block; }
.notice-date strong { color: var(--cpu-primary); font-size: 18px; line-height: 1; }
.notice-date span { margin-top: 3px; color: var(--cpu-text-muted); font-size: 10px; }
.notice-copy { min-width: 0; flex: 1; }
.notice-copy > strong {
  display: block;
  overflow: hidden;
  color: var(--cpu-text);
  font-size: 14px;
  line-height: 1.45;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: color 0.15s;
}
.notice-copy small { gap: 8px; margin-top: 6px; color: var(--cpu-text-muted); font-size: 11px; }
.notice-copy small span + span::before { margin-right: 8px; content: "·"; }

.cluster { display: flex; flex-direction: column; gap: 10px; }

.board-card {
  background: linear-gradient(135deg, var(--cpu-card) 0%, var(--cpu-surface-soft) 100%);
  border: 1px solid var(--cpu-border-soft);
  border-radius: 12px;
  padding: 14px 16px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 14px;
  transition: border-color 0.15s, box-shadow 0.15s, transform 0.15s;
  color: inherit;
  text-decoration: none;
}
.board-card:hover {
  border-color: var(--cpu-primary);
  box-shadow: 0 4px 14px rgba(22, 135, 118, 0.08);
}
.board-card:active { transform: scale(0.99); }

.icon {
  width: 46px;
  height: 46px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  font-size: 22px;
  flex-shrink: 0;
  color: #fff;
}

.body { flex: 1; min-width: 0; }
.name-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.name { font-size: 15px; font-weight: 600; color: var(--cpu-text); }
.count { font-size: 12px; color: var(--cpu-text-secondary); }
.desc {
  font-size: 12px;
  color: var(--cpu-text-secondary);
  margin-top: 2px;
  line-height: 1.5;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.meta {
  font-size: 11px;
  color: var(--cpu-text-muted);
  margin-top: 4px;
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}
.meta .time { color: var(--cpu-text-muted); }

.arrow { color: var(--cpu-text-muted); flex-shrink: 0; font-size: 16px; }

@media (max-width: 640px) {
  .announce-page { gap: 14px; }
  .title { font-size: 20px; }
  .official-section { padding: 14px; border-radius: 12px; }
  .section-head { align-items: flex-start; flex-direction: column; }
  .section-actions { width: 100%; justify-content: space-between; }
  .notice-state { align-items: flex-start; flex-direction: column; }
  .notice-state .el-button { width: 100%; }
  .notice-row { gap: 10px; padding: 12px 0; }
  .notice-date { width: 44px; min-width: 44px; }
  .notice-copy > strong { white-space: normal; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
  .notice-copy small { align-items: flex-start; flex-wrap: wrap; gap: 4px; }
  .notice-copy small span + span::before { margin-right: 4px; }
  .board-card {
    padding: 12px 14px;
    border-radius: 10px;
  }
  .icon { width: 40px; height: 40px; font-size: 20px; border-radius: 10px; }
}
</style>
