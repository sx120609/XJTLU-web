<template>
  <div class="features-pane">
    <el-alert type="warning" :closable="false" show-icon class="warn">
      <template #title>
        紧急下架开关 —— 默认全开
      </template>
      <div style="font-size:13px;line-height:1.7;margin-top:4px">
        关闭某项后：导航栏入口会立刻消失，普通用户访问对应路由会被引导回首页，发帖接口拒绝写入。
        <b>已发布的内容不会被删除</b>（关闭只是不可见、不可发新）。<br>
        admin / mod 角色仍能进入这些路由查看历史内容，便于在敏感期间复审 / 清理。
      </div>
    </el-alert>

    <el-alert
      v-if="loadError"
      type="error"
      :closable="false"
      show-icon
      class="pane-alert"
      :title="loadError"
    >
      <template #default>
        <el-button size="small" :loading="loading || configLoading" @click="reload">重试</el-button>
      </template>
    </el-alert>

    <section class="settings-card" v-loading="configLoading">
      <div class="section-head">
        <div>
          <h3 class="section-title">基础配置</h3>
          <p class="section-desc">把常用配置单独放前面，避免一进来就被大段 AI 表单淹没。</p>
        </div>
      </div>

      <div class="site-config">
        <div class="config-copy">
          <div class="card-title">站点名称</div>
          <div class="desc">用于页头、首页、登录页、浏览器标题、启动页、页脚和分享卡片。留空时恢复为“靠浦”。</div>
        </div>
        <div class="config-form">
          <el-input
            v-model="siteName"
            clearable
            maxlength="40"
            show-word-limit
            placeholder="靠浦"
            :disabled="savingConfig || configLoading || Boolean(loadError)"
            @keyup.enter="saveSiteConfig"
          />
          <el-button type="primary" :loading="savingConfig" :disabled="savingConfig || configLoading || Boolean(loadError)" @click="saveSiteConfig">保存</el-button>
        </div>
      </div>

      <div class="site-config">
        <div class="config-copy">
          <div class="card-title">站点副标题</div>
          <div class="desc">显示在页头主标题下方，并用于登录页和应用描述。留空时恢复默认副标题。</div>
        </div>
        <div class="config-form">
          <el-input
            v-model="siteSubtitle"
            clearable
            maxlength="80"
            show-word-limit
            placeholder="重塑校园生活的可能"
            :disabled="savingConfig || configLoading || Boolean(loadError)"
            @keyup.enter="saveSiteConfig"
          />
          <el-button type="primary" :loading="savingConfig" :disabled="savingConfig || configLoading || Boolean(loadError)" @click="saveSiteConfig">保存</el-button>
        </div>
      </div>

      <div class="site-config">
        <div class="config-copy">
          <div class="card-title">站点 Logo</div>
          <div class="desc">建议上传正方形 PNG、JPG、WebP 或 GIF。用于页头、登录页、启动页和浏览器图标；清空后恢复紫底白云默认标识。</div>
        </div>
        <div class="config-form logo-config-form">
          <div class="logo-preview" :class="{ empty: !siteLogoUrl }">
            <img v-if="siteLogoUrl" :src="siteLogoUrl" alt="站点 Logo 预览" />
            <img v-else src="/brand/kaopu-mark.svg" alt="靠浦默认 Logo" />
          </div>
          <el-input v-model="siteLogoUrl" clearable maxlength="2048" placeholder="上传图片或填写 https://..." :disabled="savingConfig || configLoading || uploadingLogo || Boolean(loadError)" />
          <input ref="logoFileInput" class="logo-file-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif" @change="uploadLogo" />
          <el-button :loading="uploadingLogo" :disabled="savingConfig || configLoading || Boolean(loadError)" @click="logoFileInput?.click()">上传</el-button>
          <el-button v-if="siteLogoUrl" plain :disabled="savingConfig || uploadingLogo" @click="siteLogoUrl = ''">清空</el-button>
          <el-button type="primary" :loading="savingConfig" :disabled="savingConfig || configLoading || uploadingLogo || Boolean(loadError)" @click="saveSiteConfig">保存</el-button>
        </div>
      </div>

      <div class="site-config">
        <div class="config-copy">
          <div class="card-title">网站域名</div>
          <div class="desc">用于生成 iOS / Android 小组件 API 地址。留空时会回退到当前请求的 Host，开发环境可能显示 127.0.0.1。</div>
        </div>
        <div class="config-form">
          <el-input
            v-model="siteOrigin"
            clearable
            maxlength="240"
            placeholder="https://cpu.example.com"
            :disabled="savingConfig || configLoading || Boolean(loadError)"
            @keyup.enter="saveSiteConfig"
          />
          <el-button type="primary" :loading="savingConfig" :disabled="savingConfig || configLoading || Boolean(loadError)" @click="saveSiteConfig">保存</el-button>
        </div>
      </div>

      <div class="site-config">
        <div class="config-copy">
          <div class="card-title">备案号</div>
          <div class="desc">显示在全站底部。通常填写类似“苏 ICP 备 2024000000 号-1”的备案编号，留空则不显示。</div>
        </div>
        <div class="config-form">
          <el-input
            v-model="siteFilingNumber"
            clearable
            maxlength="120"
            placeholder="苏ICP备2024000000号-1"
            :disabled="savingConfig || configLoading || Boolean(loadError)"
            @keyup.enter="saveSiteConfig"
          />
          <el-button type="primary" :loading="savingConfig" :disabled="savingConfig || configLoading || Boolean(loadError)" @click="saveSiteConfig">保存</el-button>
        </div>
      </div>

      <button type="button" class="section-toggle" :class="{ expanded: trustConfigExpanded }" @click="trustConfigExpanded = !trustConfigExpanded">
        <div class="section-toggle-copy">
          <div class="section-toggle-top">
            <h3 class="section-title">匿名与信誉规则</h3>
            <span class="toggle-pill on">5 级规则</span>
          </div>
          <p class="section-desc">默认收起。需要时再展开调整匿名门槛、周额度、信誉积分公式和等级门槛，避免基础配置区太长。</p>
          <div class="summary-row">
            <span class="summary-pill">匿名门槛 {{ anonymousMinReputation }}</span>
            <span class="summary-pill">论坛加成 {{ forumEnabledBonus }}</span>
            <span class="summary-pill">Lv.5 {{ reputationLevels[4]?.minReputation ?? 0 }}</span>
          </div>
        </div>
        <span class="toggle-arrow" aria-hidden="true">▾</span>
      </button>

      <div v-if="trustConfigExpanded" class="site-config trust-config">
        <div class="config-copy">
          <div class="card-title">匿名与信誉规则</div>
          <div class="desc">匿名最低信誉、周额度档位、信誉积分公式和 5 级信誉等级都可以在这里调整。匿名楼主在自己的匿名帖下匿名回复时会自动免扣点。</div>
        </div>
        <div class="trust-config-form">
          <div class="trust-grid">
            <div class="trust-field">
              <span class="field-label">匿名最低信誉</span>
              <el-input-number v-model="anonymousMinReputation" :min="0" :max="9999" />
            </div>
            <div class="trust-field">
              <span class="field-label">论坛资历加成</span>
              <el-input-number v-model="forumEnabledBonus" :min="0" :max="9999" />
            </div>
            <div class="trust-field">
              <span class="field-label">注册步长（天）</span>
              <el-input-number v-model="accountAgeDaysPerStep" :min="1" :max="3650" />
            </div>
            <div class="trust-field">
              <span class="field-label">注册每档积分</span>
              <el-input-number v-model="accountAgePointsPerStep" :min="0" :max="999" />
            </div>
            <div class="trust-field">
              <span class="field-label">注册积分上限</span>
              <el-input-number v-model="accountAgePointsCap" :min="0" :max="9999" />
            </div>
            <div class="trust-field">
              <span class="field-label">每帖积分</span>
              <el-input-number v-model="postPointsPerTopic" :min="0" :max="999" />
            </div>
            <div class="trust-field">
              <span class="field-label">发帖积分上限</span>
              <el-input-number v-model="postPointsCap" :min="0" :max="9999" />
            </div>
            <div class="trust-field">
              <span class="field-label">每回复积分</span>
              <el-input-number v-model="replyPointsPerReply" :min="0" :max="999" />
            </div>
            <div class="trust-field">
              <span class="field-label">回复积分上限</span>
              <el-input-number v-model="replyPointsCap" :min="0" :max="9999" />
            </div>
          </div>

          <div class="trust-subcard">
            <div class="subcard-title">匿名周额度档位</div>
            <div class="tier-grid">
              <div v-for="(tier, index) in anonymousTiers" :key="`tier-${index}`" class="tier-row">
                <span class="field-label">档位 {{ index + 1 }}</span>
                <el-input-number v-model="tier.reputation" :min="0" :max="9999" />
                <span class="field-inline-label">周额度</span>
                <el-input-number v-model="tier.quota" :min="0" :max="999" />
              </div>
            </div>
          </div>

          <div class="trust-subcard">
            <div class="subcard-title">信誉等级（5 级）</div>
            <div class="level-grid">
              <div v-for="(level, index) in reputationLevels" :key="`level-${index}`" class="level-row">
                <span class="field-label">Lv.{{ index + 1 }}</span>
                <el-input v-model="level.name" maxlength="20" placeholder="等级名称" />
                <span class="field-inline-label">门槛</span>
                <el-input-number v-model="level.minReputation" :min="0" :max="9999" />
              </div>
            </div>
          </div>

          <div class="actions-row">
            <el-button type="primary" :loading="savingConfig" :disabled="savingConfig || configLoading || Boolean(loadError)" @click="saveTrustConfig">保存匿名与信誉规则</el-button>
          </div>
        </div>
      </div>
    </section>

    <section class="settings-card" v-loading="loading">
      <div class="section-head">
        <div>
          <h3 class="section-title">功能开启 / 关闭</h3>
          <p class="section-desc">按模块开关，移动端下改成卡片堆叠，开关和说明不会再挤成一团。</p>
        </div>
        <div class="section-meta">当前开启 {{ enabledFeatureCount }} / {{ featureMeta.length }}</div>
      </div>

      <div class="feature-grid">
        <div v-for="f in featureMeta" :key="f.key" class="feature-row">
          <div class="feature-head">
            <div class="left">
              <div class="card-title">
                <span class="icon">{{ f.icon }}</span> {{ f.title }}
              </div>
              <div class="desc">{{ f.desc }}</div>
            </div>
            <el-switch
              :model-value="features[f.key]"
              :loading="pendingKey === f.key"
              size="large"
              inline-prompt
              active-text="开"
              inactive-text="关"
              :disabled="loading || Boolean(loadError) || pendingKey !== null"
              @change="(v: boolean | string | number) => toggle(f.key, Boolean(v))"
            />
          </div>
          <div class="paths">影响入口：<code>{{ f.paths.join(" · ") }}</code></div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, onMounted } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { adminApi } from "@/api/admin";
import { uploadApi } from "@/api/topic";
import { useSiteStore } from "@/stores/site";

type FKey = "forum" | "market" | "coursereview" | "electric" | "sponsor" | "promotion";

const site = useSiteStore();
const loading = ref(false);
const configLoading = ref(false);
const loadError = ref("");
const savingConfig = ref(false);
const pendingKey = ref<FKey | null>(null);
const trustConfigExpanded = ref(false);
const siteName = ref("靠浦");
const siteSubtitle = ref("重塑校园生活的可能");
const siteLogoUrl = ref("/brand/kaopu-mark.svg");
const logoFileInput = ref<HTMLInputElement | null>(null);
const uploadingLogo = ref(false);
const siteOrigin = ref("");
const siteFilingNumber = ref("");
const anonymousMinReputation = ref(30);
const accountAgeDaysPerStep = ref(14);
const accountAgePointsPerStep = ref(2);
const accountAgePointsCap = ref(36);
const postPointsPerTopic = ref(4);
const postPointsCap = ref(48);
const replyPointsPerReply = ref(2);
const replyPointsCap = ref(48);
const forumEnabledBonus = ref(6);
const anonymousTiers = ref([
  { reputation: 30, quota: 1 },
  { reputation: 60, quota: 2 },
  { reputation: 90, quota: 3 },
  { reputation: 120, quota: 4 },
]);
const reputationLevels = ref([
  { level: 1, name: "初来乍到", minReputation: 0 },
  { level: 2, name: "渐入佳境", minReputation: 30 },
  { level: 3, name: "活跃同学", minReputation: 60 },
  { level: 4, name: "资深成员", minReputation: 90 },
  { level: 5, name: "校园传说", minReputation: 120 },
]);
const features = reactive<Record<FKey, boolean>>({
  forum: true, market: true, coursereview: true, electric: true, sponsor: true, promotion: true,
});
const enabledFeatureCount = computed(() => featureMeta.filter((item) => features[item.key]).length);
let featureLoadSeq = 0;

const featureMeta: { key: FKey; icon: string; title: string; desc: string; paths: string[] }[] = [
  {
    key: "forum", icon: "💬", title: "论坛（通用板块 + 发帖）",
    desc: "综合讨论、学习交流和生活社交全部板块的可见与自由发帖。",
    paths: ["/forum", "/post", "/forum/topic/:id"],
  },
  {
    key: "coursereview", icon: "📝", title: "课程点评",
    desc: "课程点评板块、课程评分聚合和课程点评发帖入口。",
    paths: ["/forum/board/course-review", "boards type=coursereview"],
  },
  {
    key: "market", icon: "🛒", title: "市集",
    desc: "XJTLU 校内实体闲置与求购信息撮合，买卖双方见面验货并直接结算。",
    paths: ["/market", "boards type=market"],
  },
  {
    key: "promotion", icon: "📣", title: "推广与合作商户展示",
    desc: "独立关闭商业展示、新推广申请和商户公开主页，不影响学生实体交易、求购与付费学习资料；历史订单和人工核验记录会保留。",
    paths: ["/market/promotions", "/market/merchants", "首页推广位"],
  },
  {
    key: "electric", icon: "💡", title: "宿舍电费查询",
    desc: "首页与校园服务页的电费快捷卡片；如果隧道不通、不想暴露这个功能时关掉。",
    paths: ["/api/services/dorm-electric", "首页电费卡片"],
  },
  {
    key: "sponsor", icon: "💳", title: "赞助入口",
    desc: "个人中心的赞助入口和下单接口。关闭后不影响已完成赞助金额展示。",
    paths: ["/profile", "/api/payments/sponsor/orders"],
  },
];

onMounted(reload);

async function reload() {
  const seq = ++featureLoadSeq;
  loading.value = true;
  configLoading.value = true;
  loadError.value = "";
  try {
    const [r, config] = await Promise.all([
      adminApi.features({ suppressErrorMessage: true }),
      adminApi.siteConfig({ suppressErrorMessage: true }),
    ]);
    if (seq !== featureLoadSeq) return;
    Object.assign(features, r);
    site.apply(r);
    siteName.value = config.siteName;
    siteSubtitle.value = config.siteSubtitle;
    siteLogoUrl.value = config.siteLogoUrl;
    siteOrigin.value = config.siteOrigin;
    siteFilingNumber.value = config.siteFilingNumber;
    anonymousMinReputation.value = config.anonymousMinReputation;
    accountAgeDaysPerStep.value = config.accountAgeDaysPerStep;
    accountAgePointsPerStep.value = config.accountAgePointsPerStep;
    accountAgePointsCap.value = config.accountAgePointsCap;
    postPointsPerTopic.value = config.postPointsPerTopic;
    postPointsCap.value = config.postPointsCap;
    replyPointsPerReply.value = config.replyPointsPerReply;
    replyPointsCap.value = config.replyPointsCap;
    forumEnabledBonus.value = config.forumEnabledBonus;
    anonymousTiers.value = (config.anonymousTiers ?? []).map((item) => ({ ...item }));
    reputationLevels.value = (config.reputationLevels ?? []).map((item) => ({ ...item }));
  } catch (error) {
    if (seq === featureLoadSeq) {
      loadError.value = requestMessage(error) || "功能开关配置加载失败，请稍后重试";
    }
  } finally {
    if (seq === featureLoadSeq) {
      loading.value = false;
      configLoading.value = false;
    }
  }
}

async function saveSiteConfig() {
  if (savingConfig.value || loadError.value) return;
  savingConfig.value = true;
  try {
    const config = await adminApi.updateSiteConfig({
      siteName: siteName.value.trim(),
      siteSubtitle: siteSubtitle.value.trim(),
      siteLogoUrl: siteLogoUrl.value.trim(),
      siteOrigin: siteOrigin.value.trim(),
      siteFilingNumber: siteFilingNumber.value.trim(),
    });
    siteName.value = config.siteName;
    siteSubtitle.value = config.siteSubtitle;
    siteLogoUrl.value = config.siteLogoUrl;
    siteOrigin.value = config.siteOrigin;
    siteFilingNumber.value = config.siteFilingNumber;
    site.applyConfig({
      siteName: config.siteName,
      siteSubtitle: config.siteSubtitle,
      siteLogoUrl: config.siteLogoUrl,
      siteOrigin: config.siteOrigin,
      siteFilingNumber: config.siteFilingNumber,
    });
    ElMessage.success("站点基础配置已保存");
  } finally {
    savingConfig.value = false;
  }
}

async function uploadLogo(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  if (!file.type.startsWith("image/")) return ElMessage.error("请选择图片文件");
  if (file.size > 5 * 1024 * 1024) return ElMessage.error("Logo 图片不能超过 5MB");
  uploadingLogo.value = true;
  try {
    const result = await uploadApi.media(file, file.name || "site-logo.png", { forceProxy: true });
    siteLogoUrl.value = result.url;
    ElMessage.success("Logo 已上传，请点击保存应用到全站");
  } finally { uploadingLogo.value = false; }
}

async function saveTrustConfig() {
  if (savingConfig.value || loadError.value) return;
  savingConfig.value = true;
  try {
    const config = await adminApi.updateSiteConfig({
      anonymousMinReputation: anonymousMinReputation.value,
      accountAgeDaysPerStep: accountAgeDaysPerStep.value,
      accountAgePointsPerStep: accountAgePointsPerStep.value,
      accountAgePointsCap: accountAgePointsCap.value,
      postPointsPerTopic: postPointsPerTopic.value,
      postPointsCap: postPointsCap.value,
      replyPointsPerReply: replyPointsPerReply.value,
      replyPointsCap: replyPointsCap.value,
      forumEnabledBonus: forumEnabledBonus.value,
      anonymousTiers: anonymousTiers.value.map((item) => ({
        reputation: Number(item.reputation || 0),
        quota: Number(item.quota || 0),
      })),
      reputationLevels: reputationLevels.value.map((item, index) => ({
        level: index + 1,
        name: item.name,
        minReputation: Number(item.minReputation || 0),
      })),
    });
    anonymousMinReputation.value = config.anonymousMinReputation;
    accountAgeDaysPerStep.value = config.accountAgeDaysPerStep;
    accountAgePointsPerStep.value = config.accountAgePointsPerStep;
    accountAgePointsCap.value = config.accountAgePointsCap;
    postPointsPerTopic.value = config.postPointsPerTopic;
    postPointsCap.value = config.postPointsCap;
    replyPointsPerReply.value = config.replyPointsPerReply;
    replyPointsCap.value = config.replyPointsCap;
    forumEnabledBonus.value = config.forumEnabledBonus;
    anonymousTiers.value = (config.anonymousTiers ?? []).map((item) => ({ ...item }));
    reputationLevels.value = (config.reputationLevels ?? []).map((item) => ({ ...item }));
    ElMessage.success("匿名与信誉规则已保存");
  } finally {
    savingConfig.value = false;
  }
}

async function toggle(key: FKey, on: boolean) {
  if (pendingKey.value !== null || loading.value || loadError.value) {
    features[key] = !on;
    return;
  }
  pendingKey.value = key;
  if (!on) {
    const confirmed = await ElMessageBox.confirm(
      `确认关闭「${featureMeta.find((m) => m.key === key)?.title || key}」？\n` +
        `普通用户立刻看不到对应入口，无法发新内容。已发布内容会保留。`,
      "确认关闭",
      { type: "warning", confirmButtonText: "关闭", cancelButtonText: "取消" }
    ).then(() => true).catch(() => false);
    if (!confirmed) {
      features[key] = !on;
      pendingKey.value = null;
      return;
    }
  }
  try {
    const r = await adminApi.updateFeatures({ [key]: on });
    Object.assign(features, r);
    site.apply(r);
    ElMessage.success(on ? "已开启" : "已关闭");
  } catch {
    features[key] = !on;
  } finally { pendingKey.value = null; }
}

function requestMessage(error: unknown) {
  if (typeof error !== "object" || error === null) return "";
  const responseMessage = (error as { response?: { data?: { message?: unknown } } }).response?.data?.message;
  if (typeof responseMessage === "string") return responseMessage;
  return error instanceof Error ? error.message : "";
}
</script>

<style scoped>
.features-pane { display: flex; flex-direction: column; gap: 14px; }
.warn :deep(.el-alert__title) { font-size: 14px; }
.pane-alert :deep(.el-alert__content) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
}
.settings-card {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 18px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 16px;
  background: var(--cpu-card);
  box-shadow: var(--cpu-shadow-sm);
}
.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.section-title {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: var(--cpu-text);
}
.section-desc {
  margin: 6px 0 0;
  font-size: 13px;
  line-height: 1.7;
  color: var(--cpu-text-secondary);
}
.section-meta {
  flex-shrink: 0;
  padding: 8px 12px;
  border-radius: 999px;
  background: rgba(54, 208, 183, 0.14);
  color: var(--cpu-primary-light);
  font-size: 12px;
  font-weight: 600;
}
.site-config {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 14px;
  background: var(--cpu-surface);
}
.config-copy {
  flex: 1;
  min-width: 0;
}
.card-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--cpu-text);
}
.config-form {
  display: flex;
  align-items: center;
  gap: 10px;
  width: min(520px, 52%);
}
.trust-config {
  align-items: flex-start;
}
.trust-config-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: min(760px, 100%);
}
.trust-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}
.trust-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border-radius: 12px;
  border: 1px solid var(--cpu-border-soft);
  background: var(--cpu-surface-subtle);
}
.trust-subcard {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px;
  border-radius: 14px;
  background: var(--cpu-surface-subtle);
  border: 1px dashed var(--cpu-border);
}
.subcard-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--cpu-text);
}
.tier-grid,
.level-grid {
  display: grid;
  gap: 10px;
}
.tier-row,
.level-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.field-label {
  font-size: 12px;
  color: var(--cpu-text-secondary);
}
.field-inline-label {
  font-size: 12px;
  color: var(--cpu-text-muted);
}
.section-toggle,
.sub-toggle {
  width: 100%;
  border: 0;
  background: transparent;
  padding: 0;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  text-align: left;
  cursor: pointer;
}
.section-toggle-copy {
  flex: 1;
  min-width: 0;
}
.section-toggle-top {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.toggle-pill {
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--cpu-surface-subtle);
  color: var(--cpu-text-secondary);
  font-size: 12px;
  font-weight: 600;
}
.toggle-pill.on {
  background: rgba(54, 208, 183, 0.16);
  color: var(--cpu-primary-light);
}
.summary-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}
.summary-pill {
  padding: 6px 10px;
  border-radius: 999px;
  background: var(--cpu-surface-subtle);
  border: 1px solid var(--cpu-border-soft);
  color: var(--cpu-text-secondary);
  font-size: 12px;
}
.toggle-arrow {
  flex-shrink: 0;
  margin-top: 2px;
  font-size: 18px;
  color: var(--cpu-text-muted);
  transition: transform 0.2s ease;
}
.section-toggle.expanded .toggle-arrow,
.sub-toggle.expanded .toggle-arrow {
  transform: rotate(180deg);
}
.ai-config {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.ai-form {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  padding: 16px;
  border-radius: 14px;
  background: var(--cpu-surface);
  border: 1px solid var(--cpu-border-soft);
}
.ai-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ai-row--switch {
  justify-content: space-between;
}
.ai-row--stretch {
  grid-column: 1 / -1;
}
.ai-label {
  font-size: 12px;
  color: var(--cpu-text-secondary);
}
.prompt-card {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px;
  border-radius: 14px;
  background: var(--cpu-surface-subtle);
  border: 1px dashed var(--cpu-border);
}
.prompt-grid {
  display: grid;
  gap: 12px;
}
.actions-row {
  display: flex;
  justify-content: flex-end;
}
.config-form :deep(.el-input) {
  flex: 1;
}
.logo-config-form { flex-wrap: wrap; }
.logo-preview { width: 52px; height: 52px; flex: 0 0 52px; display: grid; place-items: center; overflow: hidden; border: 1px solid var(--cpu-border); border-radius: 14px; background: var(--cpu-surface-subtle); color: #fff; font-weight: 800; font-size: 22px; }
.logo-preview.empty { background: #168c78; }
.logo-preview img { width: 100%; height: 100%; object-fit: cover; }
.logo-file-input { display: none; }
.feature-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.feature-row {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 14px;
  background: var(--cpu-surface);
  min-width: 0;
}
.feature-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
}
.left { flex: 1; min-width: 0; }
.icon { margin-right: 4px; }
.desc { font-size: 12px; color: var(--cpu-text-secondary); margin-top: 4px; line-height: 1.6; }
.paths { font-size: 11px; color: var(--cpu-text-muted); }
.paths code { background: var(--cpu-surface-subtle); padding: 1px 5px; border-radius: 3px; }

@media (max-width: 960px) {
  .feature-grid { grid-template-columns: 1fr; }
}

@media (max-width: 768px) {
  .settings-card {
    gap: 14px;
    padding: 14px;
    border-radius: 14px;
  }
  .section-head,
  .site-config,
  .feature-head {
    align-items: stretch;
    flex-direction: column;
  }
  .site-config,
  .feature-row,
  .ai-form,
  .prompt-card {
    padding: 14px;
  }
  .config-form {
    width: 100%;
    flex-direction: column;
    align-items: stretch;
  }
  .ai-form {
    grid-template-columns: 1fr;
  }
  .trust-grid {
    grid-template-columns: 1fr;
  }
  .tier-row,
  .level-row {
    align-items: stretch;
    flex-direction: column;
  }
  .feature-head :deep(.el-switch),
  .ai-row--switch :deep(.el-switch),
  .actions-row :deep(.el-button) {
    align-self: flex-start;
  }
  .section-toggle,
  .sub-toggle {
    gap: 10px;
  }
  .summary-row {
    gap: 6px;
  }
  .summary-pill,
  .section-meta {
    font-size: 11px;
  }
  .paths code {
    display: inline;
    white-space: normal;
    word-break: break-all;
  }
  .actions-row {
    justify-content: stretch;
  }
  .actions-row :deep(.el-button) {
    width: 100%;
  }
}
</style>
