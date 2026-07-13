<template>
  <div class="forum-index">
    <template v-if="auth.canAccessForum">
      <div class="page-heading">
        <div>
          <h2 class="page-title">校园论坛</h2>
          <p>按主题进入板块交流，也可以直接查看最新内容。</p>
        </div>
        <el-button type="primary" @click="$router.push('/post')">发布帖子</el-button>
      </div>

      <div v-if="error && !loading" class="cpu-card forum-error">
        <el-empty :description="error">
          <el-button type="primary" @click="loadBoards">重试</el-button>
        </el-empty>
      </div>

      <template v-else>
        <button type="button" class="latest-entry cpu-card" @click="$router.push('/forum/latest')">
          <div class="latest-entry-icon">🆕</div>
          <div class="latest-entry-body">
            <div class="latest-entry-title">最新内容</div>
            <div class="latest-entry-desc">按时间看看最近有哪些新帖子和新回复</div>
          </div>
          <span class="latest-entry-arrow">查看全部 →</span>
        </button>

        <div v-loading="loading" class="boards-content">
          <div v-for="section in forumSections" :key="section.key" class="cluster">
            <h3 class="cluster-title"><span>{{ section.icon }}</span>{{ section.title }}</h3>
            <div class="grid">
              <div
                v-for="b in section.boards"
                :key="b.slug"
                class="board-card"
                role="button"
                tabindex="0"
                @click="openBoard(b.slug)"
                @keydown.enter.prevent="openBoard(b.slug)"
                @keydown.space.prevent="openBoard(b.slug)"
              >
                <div class="icon" :style="{ background: b.color || '#6d5ce7' }">{{ b.icon || section.icon }}</div>
                <div class="body">
                  <div class="name">{{ b.name }}</div>
                  <div class="desc">{{ b.description }}</div>
                  <div class="meta"><span>{{ b.topicCount }} 帖</span><span>{{ boardAction(b) }}</span></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>

      <div class="footer-tip">
        <el-icon><InfoFilled /></el-icon>
        <span>查看学校官方公告？<router-link to="/announcements">→ 校园公告</router-link></span>
      </div>
    </template>

    <template v-else>
      <section class="gate-card">
        <div class="gate-head">
          <span class="gate-badge">XJTLU 校园社区</span>
          <h2>登录后进入校园论坛</h2>
        </div>
        <p class="gate-intro">
          使用学校账号登录后即可浏览板块、发布帖子和参与回复，不再需要额外手动开启。
        </p>
        <div class="gate-points">
          <div>💬 综合讨论：校园广场、失物招领、新生专区与问答互助</div>
          <div>📚 学习交流：课程学习、科研实习、雅思留学与课程点评</div>
          <div>🎈 生活社交：校园生活、社团活动、树洞与交友扩列</div>
          <div>🕳️ 树洞支持匿名发布，所有学习板块均可自由发帖交流</div>
        </div>
        <div class="gate-actions">
          <el-button type="primary" size="large" @click="goLogin">学校账号登录</el-button>
          <el-button plain size="large" @click="$router.push('/announcements')">
            先看校园公告
          </el-button>
        </div>
        <PrivacyPolicyNotice v-if="!auth.isLoggedIn" align="left" />
      </section>

      <div class="footer-tip">
        <el-icon><InfoFilled /></el-icon>
        <span>暂不登录也可浏览 <router-link to="/announcements">校园公告</router-link> 与 <router-link to="/services">校园服务</router-link></span>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { InfoFilled } from "@element-plus/icons-vue";
import { boardApi, type Board } from "@/api/board";
import { useAuthStore } from "@/stores/auth";
import { resolveSafeRedirect } from "@/utils/redirect";
import PrivacyPolicyNotice from "@/components/common/PrivacyPolicyNotice.vue";

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const all = ref<Board[]>([]);
const loading = ref(false);
const error = ref("");
let disposed = false;
let boardLoadSeq = 0;

watch(() => auth.canAccessForum, async (enabled) => {
  if (enabled) {
    await loadBoards();
  } else {
    boardLoadSeq += 1;
    all.value = [];
    error.value = "";
    loading.value = false;
  }
}, { immediate: true });

onBeforeUnmount(() => {
  disposed = true;
  boardLoadSeq += 1;
});

const sectionMeta = [
  { key: "general", title: "综合讨论", icon: "💬" },
  { key: "study", title: "学习交流", icon: "📚" },
  { key: "social", title: "生活社交", icon: "🎈" },
] as const;

const forumSections = computed(() => sectionMeta.map((section) => ({
  ...section,
  boards: all.value.filter((board) => board.section === section.key),
})));

async function loadBoards() {
  if (disposed) return;
  const seq = ++boardLoadSeq;
  loading.value = true;
  error.value = "";
  try {
    const next = await boardApi.list({ suppressErrorMessage: true });
    if (disposed || seq !== boardLoadSeq) return;
    all.value = next;
  } catch (e) {
    if (disposed || seq !== boardLoadSeq) return;
    all.value = [];
    error.value = normalizeBoardListError(e);
  } finally {
    if (!disposed && seq === boardLoadSeq) loading.value = false;
  }
}

function normalizeBoardListError(error: unknown) {
  const status = (error as { response?: { status?: number; data?: { message?: string } } })?.response?.status;
  if (status && status < 500) {
    return (error as { response?: { data?: { message?: string } } })?.response?.data?.message || "板块列表加载失败";
  }
  return "板块列表加载失败，请稍后再试";
}

function goLogin() {
  const redirect = resolveSafeRedirect(route.query.redirect, "/forum");
  router.push({ name: "login", query: { redirect } });
}

function openBoard(slug: string) {
  const board = all.value.find((item) => item.slug === slug);
  if (board?.type === "market") {
    router.push("/market");
    return;
  }
  router.push(`/forum/b/${slug}`);
}

function boardAction(board: Board) {
  if (board.type === "market") return "进入商城 →";
  return "进入板块 →";
}

</script>

<style scoped>
.forum-index { display: flex; flex-direction: column; gap: 24px; }
.page-title { margin: 0; font-size: 22px; }
.page-heading { display: flex; justify-content: space-between; align-items: center; gap: 16px; }
.page-heading p { margin: 5px 0 0; color: var(--cpu-text-secondary); font-size: 13px; }
.cluster-title { margin: 0 0 12px; font-size: 16px; color: var(--cpu-text); font-weight: 600; display: flex; align-items: center; gap: 8px; }
.cpu-card {
  background: var(--cpu-card);
  border-radius: 14px;
  border: 1px solid var(--cpu-border-soft);
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.04);
}
.boards-content {
  display: flex;
  flex-direction: column;
  gap: 24px;
  min-height: 120px;
}
.forum-error {
  padding: 24px 16px;
}
.latest-entry {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px 18px;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s ease, transform 0.15s ease, box-shadow 0.15s ease;
}
.latest-entry:hover {
  border-color: var(--cpu-primary);
  transform: translateY(-1px);
  box-shadow: 0 10px 28px rgba(22, 135, 118, 0.08);
}
.latest-entry-icon {
  width: 46px;
  height: 46px;
  border-radius: 14px;
  display: grid;
  place-items: center;
  background: rgba(16, 185, 129, 0.14);
  border: 1px solid rgba(16, 185, 129, 0.22);
  font-size: 24px;
  flex-shrink: 0;
}
.latest-entry-body {
  flex: 1;
  min-width: 0;
}
.latest-entry-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--cpu-text);
}
.latest-entry-desc {
  margin-top: 4px;
  font-size: 13px;
  color: var(--cpu-text-secondary);
  line-height: 1.55;
}
.latest-entry-arrow {
  color: var(--cpu-primary);
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
}

.gate-card {
  background: linear-gradient(135deg, var(--cpu-card) 0%, var(--cpu-surface-subtle) 100%);
  border: 1px solid var(--cpu-border);
  border-radius: 16px;
  padding: 24px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.05);
}

.gate-head {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 14px;
}

.gate-head h2 {
  margin: 0;
  font-size: 24px;
  color: var(--cpu-text);
}

.gate-badge {
  width: fit-content;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(239, 68, 68, 0.14);
  color: #b91c1c;
  font-size: 12px;
  font-weight: 700;
}

.gate-intro {
  margin: 0;
  font-size: 14px;
  line-height: 1.8;
  color: var(--cpu-text-secondary);
}

.gate-points {
  margin-top: 16px;
  display: grid;
  gap: 10px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--cpu-text-secondary);
}

.gate-points > div {
  padding: 12px 14px;
  border-radius: 12px;
  background: var(--cpu-surface-subtle);
  border: 1px solid var(--cpu-border-soft);
}

.gate-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 20px;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 260px), 1fr));
  gap: 12px;
}

.board-card {
  background: var(--cpu-card);
  border: 1px solid var(--cpu-border-soft);
  border-radius: 12px;
  padding: 14px;
  cursor: pointer;
  display: flex;
  gap: 12px;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.board-card:hover {
  border-color: var(--cpu-primary);
  box-shadow: 0 4px 14px rgba(22, 135, 118, 0.08);
}

.board-card:focus-visible {
  outline: 2px solid var(--cpu-primary);
  outline-offset: 2px;
}

.board-card.readonly { background: linear-gradient(135deg, var(--cpu-card) 0%, rgba(16, 185, 129, 0.08) 100%); }

.footer-tip {
  margin-top: 8px;
  padding: 10px 14px;
  background: var(--cpu-surface-subtle);
  border-radius: 10px;
  font-size: 13px;
  color: var(--cpu-text-secondary);
  display: flex;
  align-items: center;
  gap: 6px;
}

.footer-tip a {
  color: var(--cpu-primary);
  text-decoration: none;
  font-weight: 500;
}

.footer-tip a:hover { text-decoration: underline; }

.forum-notice {
  max-height: min(52dvh, 520px);
  overflow: auto;
  padding-right: 4px;
  color: var(--cpu-text-secondary);
}

.forum-notice p {
  margin: 0 0 12px;
  font-size: 14px;
  line-height: 1.75;
}

.forum-notice-disclaimer {
  margin-top: 16px;
  padding: 14px 16px;
  border-radius: 12px;
  background: rgba(245, 158, 11, 0.12);
  border: 1px solid rgba(245, 158, 11, 0.34);
}

.forum-notice-disclaimer h3 {
  margin: 0 0 10px;
  font-size: 15px;
  color: #9a3412;
}

.forum-notice-disclaimer p:last-child,
.forum-notice p:last-child {
  margin-bottom: 0;
}

.confirm-form {
  margin-top: 16px;
}

.dialog-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.dialog-actions {
  display: flex;
  gap: 8px;
}

.read-hint {
  font-size: 12px;
  color: var(--cpu-text-secondary);
}

.icon {
  width: 42px;
  height: 42px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  font-size: 20px;
  flex-shrink: 0;
  color: #fff;
}

.body { flex: 1; min-width: 0; }
.name { font-size: 15px; font-weight: 600; color: var(--cpu-text); overflow-wrap: anywhere; }

.desc {
  font-size: 12px;
  color: var(--cpu-text-secondary);
  margin-top: 2px;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow-wrap: anywhere;
}

.meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 11px;
  color: #9ca3af;
  margin-top: 4px;
  overflow-wrap: anywhere;
}

@media (max-width: 640px) {
  .forum-index {
    gap: 18px;
  }

  .page-title {
    font-size: 20px;
  }

  .latest-entry {
    align-items: flex-start;
    padding: 14px;
    gap: 12px;
  }

  .latest-entry-arrow {
    display: none;
  }

  .gate-card {
    border-radius: 12px;
    padding: 18px 14px;
  }

  .gate-head h2 {
    font-size: 21px;
    line-height: 1.4;
  }

  .gate-actions {
    display: grid;
    grid-template-columns: 1fr;
  }

  .dialog-footer {
    align-items: stretch;
    flex-direction: column;
  }

  .dialog-actions {
    display: grid;
    grid-template-columns: 1fr;
  }

  .grid {
    grid-template-columns: 1fr;
  }

  .board-card {
    border-radius: 10px;
    padding: 12px;
  }

  .desc {
    -webkit-line-clamp: 2;
  }

  .dialog-footer {
    align-items: stretch;
    flex-direction: column;
  }

  .dialog-actions {
    width: 100%;
    display: grid;
    grid-template-columns: 1fr 1fr;
  }
}
</style>
