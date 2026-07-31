<template>
  <div class="profile" v-loading="profileLoading">
    <div v-if="profileLoadError" class="cpu-card profile-load-error">
      <el-empty :description="profileLoadError">
        <el-button type="primary" :loading="profileLoading" @click="loadProfilePage">{{ t("common.retry") }}</el-button>
      </el-empty>
    </div>

    <div class="cpu-card profile-card">
      <UserAvatar :size="80" class="avatar" :src="user?.avatar" :name="user?.nickname" :alt="isEnglish ? 'Profile image' : '用户头像'" />
      <div class="avatar-actions">
        <el-button size="small" plain :loading="avatarSaving" :disabled="avatarSaving" @click="pickAvatar">{{ isEnglish ? "Upload image" : "上传头像" }}</el-button>
        <el-button v-if="user?.avatar" size="small" text :loading="avatarSaving" :disabled="avatarSaving" @click="removeAvatar">{{ isEnglish ? "Remove image" : "移除头像" }}</el-button>
      </div>
      <h3 class="name">
        {{ user?.nickname }}
        <el-tag v-if="user?.role === 'admin'" size="small" type="danger">{{ isEnglish ? "Admin" : "管理员" }}</el-tag>
        <el-tag v-else-if="user?.role === 'mod'" size="small">{{ isEnglish ? "Moderator" : "论坛管理员" }}</el-tag>
      </h3>
      <p class="account-note">{{ user?.studentSso ? (isEnglish ? "Your student ID is used only for sign-in and verification and is never displayed publicly." : "学号仅用于登录和身份校验，不会公开展示") : (isEnglish ? "Your sign-in account is private and never displayed publicly." : "登录账号仅自己可见，不会公开展示") }}</p>
      <p class="bio">{{ user?.bio || (isEnglish ? "No bio yet" : "这个人很懒，什么都没写") }}</p>
      <ul class="kv">
        <li><span>{{ isEnglish ? "School" : "院系" }}</span><span>{{ user?.college || "—" }}</span></li>
        <li><span>{{ isEnglish ? "Major" : "专业" }}</span><span>{{ user?.major || "—" }}</span></li>
        <li><span>{{ isEnglish ? "Entry year" : "入学" }}</span><span>{{ user?.enrollYear || "—" }}</span></li>
        <li><span>{{ isEnglish ? "Posts" : "发帖" }}</span><span>{{ user?.postCount }}</span></li>
        <li><span>{{ isEnglish ? "Replies" : "回复" }}</span><span>{{ user?.replyCount }}</span></li>
        <li><span>{{ isEnglish ? "Reputation" : "声望" }}</span><span>{{ user?.reputation }}</span></li>
      </ul>
      <div class="profile-actions">
        <el-button type="primary" plain :disabled="saving || logoutBusy" @click="editing = true">{{ isEnglish ? "Edit profile" : "编辑资料" }}</el-button>
        <el-button plain :disabled="logoutBusy" @click="scrollToSection('trust')">{{ t("profile.identity") }}</el-button>
        <el-button plain :disabled="logoutBusy" @click="scrollToSection('favorites')">{{ t("profile.favorites") }}</el-button>
        <el-button v-if="!user?.studentSso" plain :disabled="savingPw || logoutBusy" @click="passwordDialog = true">{{ isEnglish ? "Change password" : "修改密码" }}</el-button>
        <el-button type="danger" plain :loading="logoutBusy" :disabled="logoutBusy" @click="onLogout">{{ t("common.logout") }}</el-button>
      </div>
    </div>

    <div class="cpu-card appearance-card">
      <div class="appearance-copy">
        <h3 class="cpu-section-title">{{ isEnglish ? "Appearance" : "外观偏好" }}</h3>
        <p>{{ isEnglish ? `Currently using ${appearance.isDark ? "dark" : "light"} mode.` : `当前为${appearance.modeLabel}，${appearance.isDark ? "正在使用深色界面。" : "正在使用浅色界面。"}` }}</p>
      </div>
      <div class="appearance-options" role="radiogroup" :aria-label="t('common.appearance')">
        <button
          v-for="item in appearanceOptions"
          :key="item.value"
          type="button"
          :class="{ active: appearance.mode === item.value }"
          :aria-checked="appearance.mode === item.value"
          role="radio"
          @click="appearance.setMode(item.value)"
        >
          <el-icon><component :is="item.icon" /></el-icon>
          <span>{{ item.label }}</span>
        </button>
      </div>
    </div>

    <div id="trust" class="cpu-card trust-card" v-if="user">
      <div class="trust-head">
        <div class="trust-copy">
          <h3 class="cpu-section-title">{{ t("profile.identity") }}</h3>
          <p class="trust-sub">{{ isEnglish ? "Identity, reputation, and trade performance belong to your account. Completion rate counts only public physical items that are for sale or sold. Positive rating defaults to 100% and can only be adjusted by admins after reviewing complaints." : "身份、信誉和成交表现属于个人账户能力。成交率只统计公开实物商品的在售与已售卖状态；好评率默认 100%，仅管理员可依据投诉核验结果调整。" }}</p>
          <div class="trust-inline-summary">
            <span>{{ isEnglish ? (user.studentSso ? "Campus identity verified" : "Campus identity not verified") : (trust?.identity.label || (user.studentSso ? "校园身份已核验" : "校园身份未核验")) }}</span>
            <span>{{ isEnglish ? "Reputation and points are independent" : "信誉与积分相互独立" }}</span>
            <span>{{ isEnglish ? "Anonymous posts and replies are free" : "匿名发帖与回复免费" }}</span>
          </div>
        </div>
        <div class="trust-score"><b>{{ trust?.score ?? user.reputation }}</b><small>{{ t("profile.trust") }}</small></div>
      </div>

      <div class="trust-grid">
        <div class="trust-item">
          <span>{{ isEnglish ? "Campus identity" : "校园身份" }}</span>
          <b>{{ trust?.identity.verified ? (isEnglish ? "Verified" : "已核验") : (isEnglish ? "Not verified" : "未核验") }}</b>
        </div>
        <div class="trust-item">
          <span>{{ isEnglish ? "Sold" : "已售卖" }}</span>
          <b>{{ trust?.physicalSoldItemCount ?? 0 }}</b>
        </div>
        <div class="trust-item">
          <span>{{ isEnglish ? "Completion rate" : "成交率" }}</span>
          <b>{{ trust?.completionRate ?? 0 }}%</b>
        </div>
        <div class="trust-item">
          <span>{{ isEnglish ? "Positive rating" : "好评率" }}</span>
          <b>{{ trust?.positiveRate ?? 100 }}%</b>
        </div>
      </div>

      <div class="account-assets">
        <div class="points-summary">
          <span>{{ isEnglish ? "Points balance" : "积分资产" }}</span>
          <strong>{{ trust?.points.points ?? user.points ?? 0 }}</strong>
          <small>{{ isEnglish ? "Points are used for promotion. They do not affect reputation and cannot be withdrawn." : "积分是流动的推流货币，不影响信誉值，也不能提现。" }}</small>
          <el-button type="primary" plain @click="router.push({ name: 'market-promotions', query: { mode: 'points' } })">{{ t("market.points") }}</el-button>
        </div>
        <div class="point-ledger">
          <b>{{ isEnglish ? "Recent points activity" : "最近积分流水" }}</b>
          <ol v-if="trust?.points.recentEntries?.length">
            <li v-for="entry in trust.points.recentEntries.slice(0, 6)" :key="entry.id">
              <span>{{ entry.reason }}</span>
              <strong :class="{ negative: entry.delta < 0 }">{{ entry.delta > 0 ? "+" : "" }}{{ entry.delta }}</strong>
              <time>{{ fmtDate(entry.createdAt, "MM-DD HH:mm") }}</time>
            </li>
          </ol>
          <p v-else>{{ isEnglish ? "Verified actions such as completed trades create traceable points activity." : "完成真实交易等行为会生成可追溯的积分流水。" }}</p>
        </div>
      </div>

      <div class="trust-preferences">
        <div>
          <b>{{ isEnglish ? "Wanted and item match alerts" : "求购与闲置匹配提醒" }}</b>
          <small>{{ isEnglish ? "Notify me when a strong match appears" : "出现高匹配度商品或求购时通知我" }}</small>
        </div>
        <el-switch v-model="marketPreferences.matchNotificationsEnabled" :loading="savingMarketPreferences" @change="saveMarketPreferences" />
      </div>

      <div v-if="trust?.restrictions?.length" class="trust-section">
        <div class="trust-section-title">信用处理与申诉</div>
        <div class="violation-list">
          <article v-for="violation in trust.restrictions" :key="violation.id">
            <div><b>{{ violation.reason }}</b><small>{{ violation.type }} · {{ violation.expiresAt ? `至 ${fmtDate(violation.expiresAt)}` : "长期有效" }}</small></div>
            <el-button v-if="!violation.appeals?.length" size="small" type="primary" plain @click="appealViolation(violation.id)">提交申诉</el-button>
            <el-tag v-else size="small">{{ appealStatus(violation.appeals[0].status) }}</el-tag>
          </article>
        </div>
      </div>
      <div v-else class="trust-section">
        <div class="trust-section-title">{{ isEnglish ? "Reputation status: normal" : "信用状态正常" }}</div>
        <p class="trust-section-tip">{{ isEnglish ? "There are no active Market restrictions. Normal posts, chats, and trades do not consume reputation." : "当前没有生效中的市集治理限制。普通发帖、私聊和交易不会消耗信誉值。" }}</p>
      </div>
    </div>

    <div id="favorites" class="cpu-card favorites-card">
      <div class="favorites-head">
        <div>
          <h3 class="cpu-section-title">{{ t("profile.favorites") }}</h3>
        </div>
        <span>{{ favoriteCounts.all }} {{ isEnglish ? "saved" : "项" }}</span>
      </div>
      <el-segmented v-model="favoriteType" :options="favoriteOptions" @change="loadFavorites(true)" />
      <div v-loading="favoritesLoading" class="favorite-list">
        <button v-for="favorite in favorites" :key="`${favorite.type}-${favorite.id}`" type="button" @click="router.push(favorite.href)">
          <span class="favorite-cover">
            <img v-if="favorite.cover" :src="favorite.cover" :alt="favorite.title" />
            <em v-else>{{ favoriteIcon(favorite.type) }}</em>
          </span>
          <span class="favorite-copy">
            <small>{{ favoriteTypeLabel(favorite.type) }} · {{ favorite.meta }}</small>
            <b>{{ favorite.title }}</b>
            <span>{{ favorite.description || (isEnglish ? "Open details" : "点击查看详情") }}</span>
          </span>
          <time>{{ fmtDate(favorite.savedAt, "MM-DD") }}</time>
        </button>
        <el-empty v-if="!favoritesLoading && !favorites.length" :description="isEnglish ? 'No favorites in this category' : '这个分类还没有收藏'" />
      </div>
      <el-button v-if="favoriteNextCursor" class="favorite-more" :loading="favoritesLoading" @click="loadFavorites(false)">{{ isEnglish ? "Load more" : "加载更多" }}</el-button>
    </div>

    <div class="cpu-card user-group-card">
      <div>
        <h3 class="cpu-section-title">{{ isEnglish ? "User community" : "加入用户 QQ 群" }}</h3>
        <p class="user-group-placeholder" :aria-label="isEnglish ? 'Details not available yet' : '群号暂未填写'">&nbsp;</p>
      </div>
    </div>

    <div class="cpu-card">
      <h3 class="cpu-section-title">{{ isEnglish ? "My posts" : "我发布的帖子" }}</h3>
      <el-empty v-if="!myTopics.length" :description="isEnglish ? 'You have not published a post' : '还没有发过帖子'" />
      <div
        v-for="t in myTopics"
        :key="t.id"
        class="topic-line"
        role="button"
        tabindex="0"
        @click="openMyTopic(t.id)"
        @keydown.enter.prevent="openMyTopic(t.id)"
        @keydown.space.prevent="openMyTopic(t.id)"
      >
        <span class="tag" :style="{ background: t.board?.color || '#168776' }">{{ t.board?.name }}</span>
        <span v-if="t.isAnonymous" class="anon-tag">{{ isEnglish ? "Anonymous" : "匿名" }}</span>
        <span class="title">{{ t.title }}</span>
        <span class="meta">{{ fmtRelative(t.createdAt) }}</span>
      </div>
    </div>

    <el-dialog v-model="editing" title="编辑资料" width="420" :close-on-click-modal="!saving" :close-on-press-escape="!saving" :show-close="!saving">
      <el-form label-position="top" :model="editForm">
        <el-form-item label="昵称">
          <el-input v-model="editForm.nickname" maxlength="20" show-word-limit :disabled="saving" />
        </el-form-item>
        <el-form-item label="一句话签名">
          <el-input v-model="editForm.bio" type="textarea" :rows="3" maxlength="120" show-word-limit :disabled="saving" />
        </el-form-item>
        <el-form-item label="院系">
          <el-input v-model="editForm.college" maxlength="40" :disabled="saving" />
        </el-form-item>
        <el-form-item label="专业">
          <el-input v-model="editForm.major" maxlength="80" :disabled="saving" />
        </el-form-item>
        <el-form-item label="入学年份">
          <el-input-number v-model="editForm.enrollYear" :min="2010" :max="2030" style="width:100%" :disabled="saving" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button :disabled="saving" @click="editing = false">取消</el-button>
        <el-button type="primary" :loading="saving" :disabled="saving" @click="saveEdit">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="passwordDialog" title="修改密码" width="420" :close-on-click-modal="false" :close-on-press-escape="!savingPw" :show-close="!savingPw">
      <el-form label-position="top" :model="pwForm" @keyup.enter="savePassword">
        <el-form-item label="原密码" required>
          <el-input v-model="pwForm.oldPassword" type="password" show-password autocomplete="current-password" :disabled="savingPw" />
        </el-form-item>
        <el-form-item label="新密码（至少 6 位）" required>
          <el-input v-model="pwForm.newPassword" type="password" show-password autocomplete="new-password" maxlength="64" :disabled="savingPw" />
        </el-form-item>
        <el-form-item label="再次输入新密码" required>
          <el-input v-model="pwForm.confirm" type="password" show-password autocomplete="new-password" maxlength="64" :disabled="savingPw" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button :disabled="savingPw" @click="passwordDialog = false">取消</el-button>
        <el-button type="primary" :loading="savingPw" :disabled="savingPw" @click="savePassword">保存</el-button>
      </template>
    </el-dialog>

    <input
      ref="avatarInputRef"
      class="hidden-file-input"
      type="file"
      accept="image/*"
      :disabled="avatarSaving"
      @change="onAvatarChange"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch } from "vue";
import { useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import { Moon, Sunny } from "@element-plus/icons-vue";
import { useAuthStore } from "@/stores/auth";
import { useAppearanceStore, type AppearanceMode } from "@/stores/appearance";
import { authApi } from "@/api/auth";
import { boardApi, type Board } from "@/api/board";
import { request } from "@/api/request";
import UserAvatar from "@/components/common/UserAvatar.vue";
import { fmtDate, fmtRelative } from "@/utils/format";
import { compressImageFile, normalizeImageUploadError } from "@/utils/imageUpload";
import {
  marketApi,
  type MarketPreference,
  type MarketTrustProfile,
} from "@/api/market";
import {
  profileApi,
  type ProfileFavorite,
  type ProfileFavoriteType,
} from "@/api/profile";
import { useLocale } from "@/i18n";

const auth = useAuthStore();
const appearance = useAppearanceStore();
const router = useRouter();
const { t, isEnglish } = useLocale();
const user = computed(() => auth.user);
const myTopics = ref<any[]>([]);
const boards = ref<Board[]>([]);
const editing = ref(false);
const saving = ref(false);
const logoutBusy = ref(false);
const avatarSaving = ref(false);
const avatarInputRef = ref<HTMLInputElement | null>(null);
const profileLoading = ref(false);
const profileLoadError = ref("");
const trust = ref<MarketTrustProfile | null>(null);
const marketPreferences = reactive<Pick<MarketPreference, "matchNotificationsEnabled">>({
  matchNotificationsEnabled: true,
});
const savingMarketPreferences = ref(false);
const favoriteType = ref<ProfileFavoriteType>("all");
const favorites = ref<ProfileFavorite[]>([]);
const favoritesLoading = ref(false);
const favoriteNextCursor = ref<string | null>(null);
const favoriteCounts = reactive<Record<ProfileFavoriteType, number>>({
  all: 0,
  topic: 0,
  market_item: 0,
  learning_material: 0,
});
let profileLoadSeq = 0;

const editForm = reactive({ nickname: "", bio: "", college: "", major: "", enrollYear: undefined as any });

const passwordDialog = ref(false);
const savingPw = ref(false);
const pwForm = reactive({ oldPassword: "", newPassword: "", confirm: "" });
const anonymousBoards = computed(() => boards.value.filter((board) => board.anonymousEnabled));
const anonymousStatusText = computed(() => {
  const state = user.value?.anonymousState;
  if (!state) return "—";
  if (state.frozen) return "已冻结";
  if (!state.eligible) return `未达门槛（${state.minReputation}）`;
  return "可用";
});
const anonymousResetText = computed(() => {
  const nextResetAt = user.value?.anonymousState?.nextResetAt;
  return nextResetAt ? fmtDate(nextResetAt, "MM-DD HH:mm") : "—";
});
const appearanceOptions = computed<Array<{ value: AppearanceMode; label: string; icon: unknown }>>(() => [
  { value: "light", label: t("common.light"), icon: Sunny },
  { value: "dark", label: t("common.dark"), icon: Moon },
]);
const favoriteOptions = computed(() => [
  { label: `${isEnglish.value ? "All" : "全部"} ${favoriteCounts.all}`, value: "all" },
  { label: `${isEnglish.value ? "Posts" : "帖子"} ${favoriteCounts.topic}`, value: "topic" },
  { label: `${isEnglish.value ? "Items" : "商品"} ${favoriteCounts.market_item}`, value: "market_item" },
  { label: `${isEnglish.value ? "Learning" : "学习资料"} ${favoriteCounts.learning_material}`, value: "learning_material" },
]);

watch(passwordDialog, (v) => {
  if (!v) { pwForm.oldPassword = ""; pwForm.newPassword = ""; pwForm.confirm = ""; }
});

onMounted(() => {
  void loadProfilePage();
});

watch(editing, (v) => {
  if (v && user.value) {
    editForm.nickname = user.value.nickname;
    editForm.bio = user.value.bio || "";
    editForm.college = user.value.college || "";
    editForm.major = user.value.major || "";
    editForm.enrollYear = user.value.enrollYear ?? undefined;
  }
});

async function loadProfilePage() {
  const seq = ++profileLoadSeq;
  profileLoading.value = true;
  profileLoadError.value = "";
  try {
    if (!auth.user) await auth.fetchMe();
    if (seq !== profileLoadSeq) return;
    if (!auth.user) {
      profileLoadError.value = isEnglish.value ? "Your session has expired. Please sign in again." : "登录状态已失效，请重新登录";
      return;
    }
    const [topicResult, boardResult] = await Promise.allSettled([
      request.get<any[]>(`/user/${auth.user.id}/topics`, undefined, { suppressErrorMessage: true }),
      boardApi.list({ suppressErrorMessage: true }),
    ]);
    if (seq !== profileLoadSeq) return;
    myTopics.value = topicResult.status === "fulfilled" ? topicResult.value : [];
    boards.value = boardResult.status === "fulfilled" ? boardResult.value : [];
    if (topicResult.status === "rejected" || boardResult.status === "rejected") {
      profileLoadError.value = isEnglish.value ? "Some profile data could not be loaded. Available content is shown." : "部分个人资料加载失败，已显示可用内容";
    }

    await Promise.all([
      loadTrustAndPreferences(),
      loadFavorites(true),
    ]);
  } catch (error) {
    if (seq !== profileLoadSeq) return;
    profileLoadError.value = normalizeProfileLoadError(error);
  } finally {
    if (seq === profileLoadSeq) profileLoading.value = false;
  }
}

async function loadTrustAndPreferences() {
  const [trustResult, preferenceResult] = await Promise.allSettled([
    profileApi.trust({ suppressErrorMessage: true }),
    marketApi.preferences({ suppressErrorMessage: true }),
  ]);
  if (trustResult.status === "fulfilled") trust.value = trustResult.value;
  if (preferenceResult.status === "fulfilled") Object.assign(marketPreferences, preferenceResult.value);
}

async function loadFavorites(reset: boolean) {
  if (favoritesLoading.value) return;
  favoritesLoading.value = true;
  try {
    const result = await profileApi.favorites({
      type: favoriteType.value,
      cursor: reset ? undefined : favoriteNextCursor.value || undefined,
      size: 20,
    }, { suppressErrorMessage: true });
    if (reset) favorites.value = result.list;
    else favorites.value.push(...result.list);
    favoriteNextCursor.value = result.nextCursor;
    Object.assign(favoriteCounts, result.counts);
  } catch {
    if (reset) {
      favorites.value = [];
      favoriteNextCursor.value = null;
    }
  } finally {
    favoritesLoading.value = false;
  }
}

async function saveMarketPreferences() {
  if (savingMarketPreferences.value) return;
  savingMarketPreferences.value = true;
  try {
    Object.assign(marketPreferences, await marketApi.updatePreferences(marketPreferences));
    ElMessage.success(isEnglish.value ? "Notification preference saved" : "提醒偏好已保存");
  } finally {
    savingMarketPreferences.value = false;
  }
}

async function appealViolation(violationId: number) {
  const { value } = await ElMessageBox.prompt("请说明申诉理由和可供核验的情况。", "提交信用申诉", {
    inputType: "textarea",
    inputValidator: (input) => input.trim().length >= 10 || "请至少填写 10 个字",
  });
  await marketApi.appealViolation(violationId, value.trim());
  ElMessage.success("申诉已提交");
  trust.value = await profileApi.trust({ suppressErrorMessage: true });
}

function appealStatus(value: string) {
  return ({ pending: "申诉处理中", approved: "申诉已通过", rejected: "申诉未通过" } as Record<string, string>)[value] || value;
}

function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function favoriteIcon(type: ProfileFavorite["type"]) {
  return isEnglish.value
    ? ({ topic: "P", market_item: "I", learning_material: "L" } as const)[type]
    : ({ topic: "帖", market_item: "物", learning_material: "学" } as const)[type];
}

function favoriteTypeLabel(type: ProfileFavorite["type"]) {
  return isEnglish.value
    ? ({ topic: "Post", market_item: "Item", learning_material: "Learning material" } as const)[type]
    : ({ topic: "帖子", market_item: "商品", learning_material: "学习资料" } as const)[type];
}

async function saveEdit() {
  if (saving.value) return;
  const nickname = editForm.nickname.trim();
  if (!nickname) {
    ElMessage.warning("昵称不能为空");
    return;
  }
  saving.value = true;
  try {
    const u = await authApi.updateMe({
      ...editForm,
      nickname,
      bio: editForm.bio.trim(),
      college: editForm.college.trim(),
      major: editForm.major.trim(),
    } as any);
    auth.user = u;
    ElMessage.success("已保存");
    editing.value = false;
  } finally { saving.value = false; }
}

async function savePassword() {
  if (savingPw.value) return;
  if (pwForm.newPassword.length < 6) { ElMessage.warning("新密码至少 6 位"); return; }
  if (pwForm.newPassword !== pwForm.confirm) { ElMessage.warning("两次输入的新密码不一致"); return; }
  if (pwForm.newPassword === pwForm.oldPassword) { ElMessage.warning("新密码不能与原密码相同"); return; }
  savingPw.value = true;
  try {
    await authApi.changePassword(pwForm.oldPassword, pwForm.newPassword);
    ElMessage.success("密码已修改");
    passwordDialog.value = false;
  } finally { savingPw.value = false; }
}

async function onLogout() {
  if (logoutBusy.value) return;
  const confirmed = await ElMessageBox.confirm("确认退出登录？", "提示")
    .then(() => true)
    .catch(() => false);
  if (!confirmed) return;
  logoutBusy.value = true;
  try {
    await auth.logout();
    router.push("/login");
  } finally {
    logoutBusy.value = false;
  }
}

function pickAvatar() {
  if (avatarSaving.value) return;
  avatarInputRef.value?.click();
}

async function onAvatarChange(event: Event) {
  const target = event.target as HTMLInputElement | null;
  const file = target?.files?.[0];
  if (!file) return;
  if (avatarSaving.value) {
    if (target) target.value = "";
    return;
  }

  avatarSaving.value = true;
  try {
    const avatar = await compressImageFile(file, {
      maxWidth: 320,
      maxHeight: 320,
      quality: 0.78,
      mimeType: "image/jpeg",
      maxBytes: 140 * 1024,
    });
    await auth.updateProfile({ avatar });
    ElMessage.success("头像已更新");
  } catch (error) {
    ElMessage.error(normalizeImageUploadError(error, "头像上传失败，请稍后重试"));
  } finally {
    avatarSaving.value = false;
    if (target) target.value = "";
  }
}

async function removeAvatar() {
  if (avatarSaving.value) return;
  avatarSaving.value = true;
  try {
    await auth.updateProfile({ avatar: null });
    ElMessage.success("头像已移除");
  } finally {
    avatarSaving.value = false;
  }
}

function openMyTopic(id: number) {
  router.push(`/forum/topic/${id}`);
}

function normalizeProfileLoadError(error: unknown, fallback = "个人中心加载失败，请稍后重试") {
  const status = (error as { response?: { status?: number; data?: { message?: string } } })?.response?.status;
  if (status === 401) return "登录状态已失效，请重新登录";
  if (status && status < 500) {
    return (error as { response?: { data?: { message?: string } } })?.response?.data?.message || fallback;
  }
  return fallback;
}
</script>

<style scoped>
.profile { display: flex; flex-direction: column; gap: 16px; }
.cpu-card { background: var(--cpu-card); border: 1px solid var(--cpu-border-soft); border-radius: 12px; padding: 20px 24px; box-shadow: var(--cpu-shadow-sm); }

.profile-card { text-align: center; }
.profile-load-error {
  padding: 18px;
}
.avatar { font-size: 28px; font-weight: 600; }
.avatar-actions {
  margin-top: 10px;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.name {
  margin: 12px 0 4px;
  font-size: 20px;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 8px;
}
.account-note { font-size: 12px; color: var(--cpu-text-muted); margin: 0 0 8px; }
.bio { font-size: 13px; color: var(--cpu-text-secondary); margin: 0 0 16px; }

.kv {
  list-style: none;
  padding: 0;
  margin: 0 auto 16px;
  max-width: 320px;
}
.kv li {
  display: flex;
  justify-content: space-between;
  padding: 8px 0;
  font-size: 13px;
  border-bottom: 1px dashed var(--cpu-border-soft);
}
.kv li:last-child { border-bottom: none; }
.kv li span:first-child { color: var(--cpu-text-secondary); }
.kv li span:last-child { color: var(--cpu-text); font-weight: 500; }
.profile-actions {
  display: flex;
  gap: 8px;
  justify-content: center;
  flex-wrap: wrap;
}
.profile-actions .el-button { flex: 1 1 auto; min-width: 100px; margin-left: 0 !important; }

.appearance-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.appearance-copy {
  min-width: 0;
}
.appearance-copy p {
  margin: 4px 0 0;
  color: var(--cpu-text-secondary);
  font-size: 13px;
  line-height: 1.6;
}
.appearance-options {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
  min-width: min(360px, 100%);
  padding: 4px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 12px;
  background: var(--cpu-surface-soft);
}
.appearance-options button {
  display: inline-flex;
  min-width: 0;
  min-height: 40px;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: var(--cpu-text-secondary);
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  font-weight: 650;
}
.appearance-options button.active {
  color: #05201c;
  background: var(--cpu-primary);
  box-shadow: 0 6px 18px rgba(20, 143, 123, 0.18);
}
.appearance-options button:not(.active):hover {
  color: var(--cpu-primary);
  background: rgba(20, 143, 123, 0.1);
}

.trust-card {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.trust-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.trust-copy {
  flex: 1;
  min-width: 0;
}

.trust-sub {
  margin: 4px 0 0;
  color: var(--cpu-text-secondary);
  font-size: 13px;
  line-height: 1.6;
}

.trust-inline-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}

.trust-inline-summary span {
  padding: 5px 10px;
  border-radius: 999px;
  background: var(--cpu-surface-subtle);
  color: var(--cpu-text-secondary);
  font-size: 12px;
  line-height: 1;
}

.trust-score {
  min-width: 72px;
  text-align: center;
  padding: 10px 14px;
  border-radius: 14px;
  background: linear-gradient(135deg, #4c1d95 0%, #7c3aed 100%);
  color: #fff;
  font-size: 24px;
  font-weight: 700;
}
.trust-score b,.trust-score small{display:block}.trust-score small{margin-top:2px;font-size:10px;font-weight:500;opacity:.82}

.trust-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.trust-item {
  padding: 12px 14px;
  border-radius: 12px;
  background: var(--cpu-surface-soft);
}

.trust-item span {
  display: block;
  color: var(--cpu-text-secondary);
  font-size: 12px;
  margin-bottom: 6px;
}

.trust-item b {
  color: var(--cpu-text);
  font-size: 18px;
}

.trust-section {
  padding: 14px;
  border-radius: 14px;
  border: 1px solid var(--cpu-border-soft);
  background: var(--cpu-surface-soft);
}

.trust-section-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.trust-section-title {
  color: var(--cpu-text);
  font-size: 14px;
  font-weight: 600;
}

.trust-section-tip {
  margin: 4px 0 0;
  color: var(--cpu-text-secondary);
  font-size: 12px;
  line-height: 1.6;
}

.trust-section-body {
  margin-top: 12px;
}

.trust-breakdown {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 16px;
}

.trust-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 10px;
  border-bottom: 1px dashed var(--cpu-border-soft);
  font-size: 13px;
}

.trust-row span {
  color: var(--cpu-text-secondary);
}

.trust-row b {
  color: var(--cpu-text);
}

.trust-next {
  margin: 0;
  color: #7c3aed;
  font-size: 13px;
  line-height: 1.6;
}

.trust-progress-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
}

.account-assets{display:grid;grid-template-columns:220px 1fr;gap:12px}.points-summary,.point-ledger{padding:16px;border:1px solid var(--cpu-border-soft);border-radius:14px;background:var(--cpu-surface-soft)}.points-summary{display:flex;flex-direction:column;align-items:flex-start;gap:8px}.points-summary>span,.points-summary>small{color:var(--cpu-text-secondary);font-size:12px}.points-summary>strong{font-size:32px;color:var(--cpu-primary)}.point-ledger>b{font-size:13px}.point-ledger ol{list-style:none;padding:0;margin:10px 0 0}.point-ledger li{display:grid;grid-template-columns:1fr auto auto;gap:12px;padding:7px 0;border-top:1px dashed var(--cpu-border-soft);font-size:12px}.point-ledger li span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.point-ledger li strong{color:var(--cpu-primary)}.point-ledger li strong.negative{color:var(--cpu-danger)}.point-ledger time,.point-ledger p{color:var(--cpu-text-secondary);font-size:11px}.trust-preferences{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px;border:1px solid var(--cpu-border-soft);border-radius:14px}.trust-preferences div{display:flex;flex-direction:column;gap:4px}.trust-preferences small{color:var(--cpu-text-secondary)}.violation-list{display:grid;gap:8px;margin-top:10px}.violation-list article{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px;border-radius:10px;background:var(--cpu-card)}.violation-list article>div{display:flex;flex-direction:column;gap:4px}.violation-list small{color:var(--cpu-text-secondary)}

.favorites-card{scroll-margin-top:20px}.favorites-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:14px}.favorites-head p{margin:4px 0 0;color:var(--cpu-text-secondary);font-size:13px}.favorites-head>span{color:var(--cpu-primary);font-weight:700}.favorite-list{display:grid;gap:8px;min-height:100px;margin-top:14px}.favorite-list>button{width:100%;display:grid;grid-template-columns:58px 1fr auto;align-items:center;gap:12px;padding:10px;border:1px solid var(--cpu-border-soft);border-radius:12px;background:var(--cpu-card);color:var(--cpu-text);text-align:left;cursor:pointer}.favorite-list>button:hover{border-color:var(--cpu-primary);background:var(--cpu-primary-soft)}.favorite-cover{width:58px;height:52px;display:grid;place-items:center;overflow:hidden;border-radius:10px;background:var(--cpu-surface-soft)}.favorite-cover img{width:100%;height:100%;object-fit:cover}.favorite-cover em{color:var(--cpu-primary);font-style:normal;font-size:18px;font-weight:800}.favorite-copy{min-width:0;display:flex;flex-direction:column;gap:3px}.favorite-copy small,.favorite-copy>span,.favorite-list time{overflow:hidden;color:var(--cpu-text-secondary);font-size:11px;text-overflow:ellipsis;white-space:nowrap}.favorite-copy b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.favorite-more{width:100%;margin-top:12px}

.anonymous-board-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.user-group-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.user-group-card p {
  margin: 4px 0 8px;
  color: var(--cpu-text-secondary);
  font-size: 13px;
  line-height: 1.6;
}
.user-group-placeholder { min-height: 20px; }

.topic-line {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 4px;
  border-bottom: 1px dashed var(--cpu-border-soft);
  cursor: pointer;
  border-radius: 6px;
  min-width: 0;
  overflow: hidden;
}
.topic-line:last-child { border-bottom: none; }
.topic-line:hover { background: var(--cpu-surface-soft); }
.topic-line:focus-visible {
  outline: 2px solid rgba(22, 135, 118, 0.35);
  outline-offset: 2px;
  background: var(--cpu-surface-soft);
}
.tag { color: #fff; font-size: 11px; padding: 2px 6px; border-radius: 4px; flex-shrink: 0; }
.anon-tag { color: #7c3aed; font-size: 12px; font-weight: 600; }
.title { font-size: 14px; flex: 1; min-width: 0; overflow-wrap: anywhere; }
.meta { font-size: 12px; color: var(--cpu-text-muted); flex-shrink: 0; }

.cpu-section-title { font-size: 16px; font-weight: 600; margin: 0 0 12px; }
.hidden-file-input { display: none; }

@media (max-width: 640px) {
  .cpu-card {
    border-radius: 10px;
    padding: 14px;
  }

  .profile-actions {
    gap: 6px;
  }
  .profile-actions .el-button {
    flex: 1 1 calc(50% - 4px);
    min-width: 0;
  }

  .appearance-card {
    align-items: stretch;
    flex-direction: column;
  }

  .appearance-options {
    width: 100%;
    min-width: 0;
  }

  .appearance-options button {
    min-height: 42px;
    font-size: 12px;
  }

  .avatar-actions {
    gap: 6px;
  }

  .trust-head {
    flex-direction: column;
  }

  .trust-inline-summary {
    gap: 6px;
  }

  .trust-score {
    min-width: 0;
    width: 100%;
  }

  .trust-grid,
  .trust-breakdown {
    grid-template-columns: 1fr;
  }

  .account-assets{grid-template-columns:1fr}.favorite-list>button{grid-template-columns:50px 1fr}.favorite-cover{width:50px;height:48px}.favorite-list time{display:none}.favorites-card .el-segmented{width:100%;overflow:auto}

  .trust-section-head {
    flex-direction: column;
  }

  .user-group-card {
    align-items: stretch;
    flex-direction: column;
  }

  .topic-line {
    align-items: flex-start;
    flex-wrap: wrap;
    gap: 8px;
    padding: 12px 2px;
  }

  .title {
    flex-basis: 100%;
    order: 3;
    white-space: normal;
    line-height: 1.45;
  }

  .meta {
    margin-left: auto;
  }
}
</style>
