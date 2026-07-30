<template>
  <div class="wanted-publish">
    <header class="page-head">
      <div><span>{{ isEnglish ? "SQUARE · WANTED" : "广场 · 求购需求" }}</span><h1>{{ editingId ? (isEnglish ? 'Edit wanted request' : '编辑求购需求') : (isEnglish ? 'Post wanted request' : '发布求购需求') }}</h1><p>{{ isEnglish ? "State your budget, acceptable condition, and preferred time. The request will appear in the Wanted channel in Square." : "把预算、成色和交易时间说清楚；发布后会直接进入广场的求购需求专区。" }}</p></div>
      <el-button @click="$router.push('/forum/b/wanted-demand')">{{ isEnglish ? "Back to Wanted" : "返回求购需求" }}</el-button>
    </header>

    <el-form label-position="top" class="wanted-form cpu-card" :class="{ 'learning-wanted-form': form.category === 'learning_materials' }" v-loading="loading">
      <aside class="publish-readiness" aria-live="polite">
        <div><span>{{ isEnglish ? "Completeness" : "信息完整度" }}</span><strong>{{ qualityScore }}%</strong></div>
        <small>{{ qualityHints.length ? (isEnglish ? `Consider adding: ${qualityHints.join(', ')}` : `建议补充：${qualityHints.join('、')}`) : (isEnglish ? 'Clear and ready to publish' : '需求清楚，可以发布') }}</small>
        <em>{{ draftSavedAt ? (isEnglish ? `Autosaved ${new Date(draftSavedAt).toLocaleTimeString(locale,{hour:'2-digit',minute:'2-digit'})}` : `已自动保存 ${new Date(draftSavedAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}`) : (isEnglish ? 'Saved automatically on this device' : '内容会自动保存在本机') }}</em>
      </aside>
      <section>
        <h2>{{ isEnglish ? "What do you need?" : "想要什么" }}</h2>
        <el-form-item :label="isEnglish ? 'Title' : '求购标题'" required><el-input v-model="form.title" maxlength="120" show-word-limit :placeholder="isEnglish ? 'For example: Looking for a second-hand monitor in good condition' : '例如：求一台成色良好的二手显示器'" /></el-form-item>
        <div class="two-cols">
          <el-form-item :label="isEnglish ? 'Category' : '求购分类'" required><el-select v-model="form.category"><el-option v-for="category in categories" :key="category.slug" :label="`${category.icon} ${category.name}${category.special ? (isEnglish ? ' · Special' : ' · 专区') : ''}`" :value="category.slug" /></el-select></el-form-item>
          <el-form-item :label="isEnglish ? 'Brand / model' : '品牌 / 型号'"><el-input v-model="form.brandModel" maxlength="160" :placeholder="isEnglish ? 'List multiple acceptable models if needed' : '可接受多个型号时也可以写在这里'" /></el-form-item>
        </div>
        <div class="two-cols">
          <el-form-item :label="isEnglish ? 'Minimum budget (CNY)' : '最低预算（元）'" required><el-input-number v-model="form.budgetMin" :min="0" :max="999999" :precision="2" :step="10" controls-position="right" /></el-form-item>
          <el-form-item :label="isEnglish ? 'Maximum budget (CNY)' : '最高预算（元）'" required><el-input-number v-model="form.budgetMax" :min="0" :max="999999" :precision="2" :step="10" controls-position="right" /></el-form-item>
        </div>
        <el-alert v-if="form.category === 'learning_materials'" type="success" :closable="false" show-icon :title="isEnglish ? 'This learning-material request uses a special label. Responders can link materials already published in Learning Materials.' : '这是学习资料求购，会以专区色标展示；响应者可关联自己已在学习资料专区上架的资料。'" />
        <el-form-item :label="isEnglish ? 'Requirements' : '需求说明'" required><el-input v-model="form.description" type="textarea" :rows="7" maxlength="5000" show-word-limit :placeholder="isEnglish ? 'Explain the use case, must-have conditions, unacceptable defects, and desired accessories. Do not include contact details.' : '说明用途、必须满足的条件、不能接受的瑕疵，以及希望附带的配件。请勿填写联系方式。'" /></el-form-item>
      </section>

      <section>
        <h2>{{ isEnglish ? "Trade preferences" : "交易要求" }}</h2>
        <div class="two-cols">
          <el-form-item :label="isEnglish ? 'Acceptable condition' : '可接受成色'"><el-input v-model="form.condition" maxlength="80" :placeholder="isEnglish ? 'For example: good condition or better' : '例如：使用良好及以上'" /></el-form-item>
          <el-form-item :label="isEnglish ? 'Preferred time' : '希望交易时间'"><el-input v-model="form.expectedTradeTime" maxlength="200" :placeholder="isEnglish ? 'For example: this week, after 18:00 on weekdays' : '例如：本周内，工作日 18:00 后'" /></el-form-item>
          <el-form-item :label="isEnglish ? 'Campus' : '校区'" required><el-select v-model="form.campus" :placeholder="isEnglish ? 'Select campus' : '请选择校区'" style="width:100%"><el-option v-for="campus in MARKET_CAMPUSES" :key="campus" :label="campus" :value="campus" /></el-select></el-form-item>
          <el-form-item :label="isEnglish ? 'Suggested meetup place' : '建议面交地点'" required><el-input v-model="form.location" maxlength="100" :placeholder="isEnglish ? 'Choose a public campus area' : '请选择校内公共区域'" /></el-form-item>
          <el-form-item :label="isEnglish ? 'Expires after' : '自动过期'"><el-select v-model="form.expiryDays"><el-option :label="isEnglish ? '7 days' : '7 天'" :value="7" /><el-option :label="isEnglish ? '14 days' : '14 天'" :value="14" /><el-option :label="isEnglish ? '30 days' : '30 天'" :value="30" /><el-option :label="isEnglish ? '60 days' : '60 天'" :value="60" /></el-select></el-form-item>
        </div>
        <el-checkbox v-model="form.allowSellerOffers">{{ isEnglish ? "Allow students to submit item responses" : "允许同学提交商品响应" }}</el-checkbox>
        <div class="anonymous-box" :class="{ disabled: !anonymousEnabledForForm }">
          <el-switch v-model="form.anonymous" :disabled="!anonymousEnabledForForm || Boolean(editingId)" />
          <div>
            <strong>{{ isEnglish ? "Post anonymously" : "匿名发布求购" }}</strong>
            <p>{{ anonymousHint }}</p>
          </div>
        </div>
        <el-alert class="rule-alert" type="info" :closable="false" show-icon :title="isEnglish ? 'Contact details are not public. Start a chat from a suitable response; both parties confirm after the real exchange.' : '联系方式不会公开。看到合适响应后可直接发起私聊；实际成交后由双方分别确认。'" />
      </section>

      <el-alert type="warning" :closable="false" show-icon :title="isEnglish ? 'Do not request illegal or prohibited items, accounts, prescription drugs, cheating materials, dangerous goods, or items of unknown origin.' : '禁止求购违法违规物品、账号、处方药、考试作弊资料、危险品或来源不明商品。'" />
      <footer><el-button @click="$router.push('/forum/b/wanted-demand')">{{ t("common.cancel") }}</el-button><el-button type="primary" :loading="submitting" @click="submit">{{ editingId ? (isEnglish ? 'Save changes' : '保存修改') : (isEnglish ? 'Publish to Wanted' : '发布到求购需求') }}</el-button></footer>
    </el-form>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { isMarketCampus, MARKET_CAMPUSES, marketApi, normalizeMarketCampus, type MarketCampus, type MarketCategoryOption, type WantedPostInput, type WantedPostPatch } from "@/api/market";
import { useAuthStore } from "@/stores/auth";
import { clearPublishDraft, readPublishDraft, savePublishDraft } from "@/utils/publishDraft";
import { useLocale } from "@/i18n";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const { t, isEnglish, locale } = useLocale();
const editingId = Number(route.params.id || 0);
const categories = ref<MarketCategoryOption[]>([]);
const loading = ref(false);
const submitting = ref(false);
const form = reactive<{ title: string; category: string; budgetMin: number; budgetMax: number; brandModel: string; condition: string; expectedTradeTime: string; campus: MarketCampus | ""; location: string; description: string; allowSellerOffers: boolean; anonymous: boolean; expiryDays: number }>({ title: "", category: "other", budgetMin: 0, budgetMax: 0, brandModel: "", condition: "", expectedTradeTime: "", campus: "", location: "", description: "", allowSellerOffers: true, anonymous: false, expiryDays: 30 });
const draftReady = ref(false);
const draftSavedAt = ref(0);
let draftTimer = 0;
const qualityHints = computed(() => {
  const hints: string[] = [];
  if (form.title.trim().length < 8) hints.push(isEnglish.value ? "a more specific title" : "更具体的标题");
  if (form.description.trim().length < 40) hints.push(isEnglish.value ? "more detail" : "详细需求");
  if (form.budgetMax <= 0 || form.budgetMax < form.budgetMin) hints.push(isEnglish.value ? "a valid budget" : "合理预算");
  if (!form.condition.trim()) hints.push(isEnglish.value ? "acceptable condition" : "可接受成色");
  if (!form.expectedTradeTime.trim()) hints.push(isEnglish.value ? "preferred time" : "交易时间");
  if (!form.campus.trim() || !form.location.trim()) hints.push(isEnglish.value ? "meetup location" : "面交地点");
  return hints;
});
const qualityScore = computed(() => Math.round(((6 - qualityHints.value.length) / 6) * 100));
const anonymousEnabledForForm = computed(() => {
  return true;
});
const anonymousHint = computed(() => {
  if (editingId) return form.anonymous
    ? (isEnglish.value ? "This request remains anonymous; editing does not reveal your identity." : "这条求购会继续匿名展示，编辑不会公开真实身份。")
    : (isEnglish.value ? "A published request cannot be changed to anonymous while editing." : "已发布的求购不能在编辑时改为匿名。");
  return isEnglish.value ? "Anonymous publishing is free and uses no points. The platform retains necessary safety review controls." : "匿名发布免费，不消耗积分；平台仍保留必要的安全审核能力。";
});
watch(anonymousEnabledForForm, (enabled) => {
  if (!enabled && !editingId) form.anonymous = false;
}, { immediate: true });
watch(form, () => {
  if (!draftReady.value || editingId) return;
  window.clearTimeout(draftTimer);
  draftTimer = window.setTimeout(() => {
    draftSavedAt.value = savePublishDraft("market-wanted", JSON.parse(JSON.stringify(form)), auth.user?.id);
  }, 500);
}, { deep: true });
onBeforeUnmount(() => window.clearTimeout(draftTimer));

onMounted(async () => {
  loading.value = true;
  try {
    const meta = await marketApi.meta({ suppressErrorMessage: true });
    categories.value = meta.wantedCategories || meta.categories.filter((item) => item.fulfillmentType === "physical");
    if (!editingId) {
      const localDraft = readPublishDraft<Record<string, unknown>>("market-wanted", auth.user?.id);
      if (localDraft) {
        Object.assign(form, localDraft.value);
        form.campus = normalizeMarketCampus(form.campus);
        draftSavedAt.value = localDraft.savedAt;
        ElMessage.info(isEnglish.value ? "Restored an unpublished draft from this device" : "已恢复本机未提交的求购内容");
      }
    }
    if (!categories.value.some((item) => item.slug === form.category) && categories.value.length) form.category = categories.value[0].slug;
    if (!editingId) return;
    const post = await marketApi.wantedPost(editingId);
    if (!post.mine) {
      ElMessage.error(isEnglish.value ? "You cannot edit this request" : "无权编辑该求购");
      await router.replace(`/market/wanted/${editingId}`);
      return;
    }
    Object.assign(form, { title: post.title, category: post.category, budgetMin: Number(post.budgetMin), budgetMax: Number(post.budgetMax), brandModel: post.brandModel, condition: post.condition, expectedTradeTime: post.expectedTradeTime, campus: post.campus, location: post.location, description: post.description, allowSellerOffers: post.allowSellerOffers, anonymous: post.isAnonymous });
    form.campus = normalizeMarketCampus(form.campus);
  } finally { draftReady.value = true; loading.value = false; }
});

function validate() {
  if (form.title.trim().length < 2) return ElMessage.warning(isEnglish.value ? "Enter a clear title" : "请填写明确的求购标题"), false;
  if (!form.category) return ElMessage.warning(isEnglish.value ? "Select a category" : "请选择物品分类"), false;
  if (form.budgetMin < 0 || form.budgetMax < form.budgetMin) return ElMessage.warning(isEnglish.value ? "Maximum budget cannot be lower than minimum budget" : "最高预算不能低于最低预算"), false;
  if (!form.description.trim()) return ElMessage.warning(isEnglish.value ? "Describe what you need" : "请填写需求说明"), false;
  if (!isMarketCampus(form.campus) || !form.location.trim()) return ElMessage.warning(isEnglish.value ? "Select SIP or TC and enter a suggested meetup place" : "请选择 SIP 或 TC 校区，并填写建议面交地点"), false;
  if (!form.expectedTradeTime.trim()) return ElMessage.warning(isEnglish.value ? "Enter your preferred trade time" : "请填写希望交易时间"), false;
  return true;
}

function toWantedPatch({ anonymous: _anonymous, ...patch }: WantedPostInput): WantedPostPatch {
  return patch;
}

async function submit() {
  if (!validate() || submitting.value) return;
  submitting.value = true;
  try {
    const campus = normalizeMarketCampus(form.campus);
    if (!campus) return void ElMessage.warning(isEnglish.value ? "Select SIP or TC" : "请选择 SIP 或 TC 校区");
    const payload: WantedPostInput = { ...form, campus, anonymous: form.anonymous };
    const post = editingId
      ? await marketApi.updateWantedPost(editingId, toWantedPatch(payload))
      : await marketApi.createWantedPost(payload);
    if (!editingId && form.anonymous) await auth.fetchMe();
    clearPublishDraft("market-wanted", auth.user?.id);
    ElMessage.success(editingId
      ? (isEnglish.value ? "Wanted request updated" : "求购需求已更新")
      : (isEnglish.value ? "Wanted request published to Square" : "求购需求已发布到广场"));
    await router.replace({ path: post.topicUrl || `/forum/b/wanted-demand`, query: { published: "1" } });
  } finally { submitting.value = false; }
}
</script>

<style scoped>
.wanted-publish{display:flex;max-width:960px;margin:0 auto;flex-direction:column;gap:18px}.page-head{display:flex;align-items:flex-end;justify-content:space-between;gap:16px}.page-head span{color:var(--cpu-primary);font-size:10px;letter-spacing:.14em}.page-head h1{margin:5px 0;font-size:28px}.page-head p{margin:0;color:var(--cpu-text-secondary);font-size:12px}.wanted-form{padding:26px}.wanted-form section+section{margin-top:26px;padding-top:22px;border-top:1px solid var(--cpu-border-soft)}.wanted-form h2{margin:0 0 14px;font-size:17px}.two-cols{display:grid;grid-template-columns:1fr 1fr;gap:18px}.rule-alert{margin-top:14px}.wanted-form footer{display:flex;justify-content:flex-end;gap:8px;margin-top:22px;padding-top:20px;border-top:1px solid var(--cpu-border-soft)}@media(max-width:680px){.page-head{align-items:flex-start;flex-direction:column}.wanted-form{padding:16px}.two-cols{grid-template-columns:1fr}.wanted-form footer .el-button{flex:1}}
.publish-readiness{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:5px 14px;margin-bottom:22px;padding:14px 16px;border:1px solid color-mix(in srgb,var(--cpu-primary) 24%,var(--cpu-border-soft));border-radius:13px;background:var(--cpu-primary-soft)}.publish-readiness>div{display:flex;align-items:baseline;gap:8px}.publish-readiness span,.publish-readiness small,.publish-readiness em{color:var(--cpu-text-secondary);font-size:11px}.publish-readiness strong{color:var(--cpu-primary);font-size:19px}.publish-readiness em{font-size:10px;font-style:normal;white-space:nowrap}@media(max-width:680px){.publish-readiness{grid-template-columns:1fr}.wanted-form footer{position:sticky;z-index:5;bottom:calc(66px + env(safe-area-inset-bottom));margin:22px -16px -16px;padding:12px 16px;background:var(--cpu-card);box-shadow:0 -8px 20px rgba(15,23,42,.06)}}
.anonymous-box{display:flex;align-items:flex-start;gap:12px;margin-top:14px;padding:13px 15px;border:1px solid color-mix(in srgb,var(--cpu-primary) 25%,var(--cpu-border-soft));border-radius:12px;background:color-mix(in srgb,var(--cpu-primary) 7%,var(--cpu-card))}.anonymous-box.disabled{border-color:var(--cpu-border-soft);background:var(--cpu-surface-subtle)}.anonymous-box strong{display:block;color:var(--cpu-text);font-size:13px}.anonymous-box p{margin:4px 0 0;color:var(--cpu-text-secondary);font-size:11px;line-height:1.55}
.wanted-form.learning-wanted-form{border-color:#c084fc;box-shadow:0 8px 28px rgba(147,51,234,.09)}
</style>
