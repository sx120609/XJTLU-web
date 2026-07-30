<template>
  <div class="publish-page">
    <header class="page-head">
      <div><span>{{ isMaterialsMode ? 'KAOPU FEATURED LEARNING' : (isEnglish ? 'CAMPUS MARKET' : '校园市集') }}</span><h1>{{ pageTitle }}</h1><p>{{ isMaterialsMode ? (isEnglish ? 'Clearly describe the material, intended audience, and version.' : '清楚说明资料内容、适用对象和版本信息。') : (isEnglish ? 'Complete details make a successful trade more likely. Meet in a public campus area, inspect the item, and pay the seller directly.' : '信息越完整，越容易达成交易。请在校内公共区域见面验货，并由买家直接向卖家付款。') }}</p></div>
      <el-button @click="$router.push(isMaterialsMode ? '/learning/materials' : '/market')">{{ isMaterialsMode ? (isEnglish ? 'Back to Learning Materials' : '返回资料专区') : (isEnglish ? 'Back to Market' : '返回市集') }}</el-button>
    </header>

    <el-form label-position="top" class="publish-form cpu-card" v-loading="loading">
      <aside class="publish-readiness" aria-live="polite">
        <div>
          <span>{{ isEnglish ? 'Completeness' : '信息完整度' }}</span>
          <strong>{{ qualityScore }}%</strong>
          <small>{{ qualityHints.length ? (isEnglish ? `Consider adding: ${qualityHints.join(', ')}` : `建议补充：${qualityHints.join('、')}`) : (isEnglish ? 'Complete and ready to publish' : '信息完整，可以发布') }}</small>
        </div>
        <el-progress :percentage="qualityScore" :show-text="false" :stroke-width="7" />
        <em>{{ draftSavedLabel }}</em>
      </aside>
      <section>
        <h2>{{ isEnglish ? 'Basic information' : '基本信息' }}</h2>
        <div class="two-cols">
          <el-form-item :label="isEnglish ? 'Listing type' : '发布类型'"><div class="fixed-listing-type">{{ isMaterialsMode ? (isEnglish ? 'Paid learning material' : '付费学习资料') : (isEnglish ? 'Physical item for sale' : '出售实体物品') }} <small>{{ isEnglish ? 'Use the separate Wanted entry to request an item' : '求购请使用独立求购入口' }}</small></div></el-form-item>
          <el-form-item v-if="!isMaterialsMode" :label="isEnglish ? 'Category' : '商品品类'" required><el-select v-model="form.category" :placeholder="isEnglish ? 'Select a category' : '请选择商品品类'"><el-option v-for="item in categories" :key="item.slug" :label="`${item.icon} ${item.name}`" :value="item.slug" /></el-select></el-form-item>
          <el-form-item v-else :label="isEnglish ? 'Publishing area' : '发布专区'"><div class="fixed-category"><span><img src="/brand/kaopu-cloud.svg" alt="" /></span><div><b>{{ isEnglish ? 'Kaopu Learning Materials' : '靠浦特色学习资料' }}</b><small>{{ isEnglish ? 'Separate catalog · Secure online delivery' : '独立资料专区 · 线上安全交付' }}</small></div></div></el-form-item>
        </div>
        <el-form-item :label="isMaterialsMode ? (isEnglish ? 'Material title' : '资料标题') : (isEnglish ? 'Item title' : '商品标题')" required><el-input v-model="form.title" maxlength="120" show-word-limit :placeholder="isMaterialsMode ? (isEnglish ? 'Course / exam / material name / study stage' : '课程 / 考试 / 资料名称 / 适用阶段') : (isEnglish ? 'Brand / model / key details' : '品牌 / 型号 / 关键信息')" /></el-form-item>
        <el-form-item :label="isMaterialsMode ? (isEnglish ? 'Material description' : '资料说明') : (isEnglish ? 'Item description' : '商品描述')" required><el-input v-model="form.description" type="textarea" :rows="8" maxlength="20000" show-word-limit :placeholder="isMaterialsMode ? (isEnglish ? 'Describe the contents, applicable course or exam, version, page count, file formats, and originality. Do not upload infringing or cheating content.' : '说明资料目录、适用课程或考试、版本、页数、文件格式和原创情况，请勿上传侵权或作弊内容。') : (isEnglish ? 'Describe purchase date, usage, accessories, defects, and trade requirements. Do not publish sensitive personal information.' : '介绍购买时间、使用情况、配件、瑕疵和交易要求，请勿公开填写敏感个人信息。')" /></el-form-item>
        <div v-if="!isMaterialsMode" class="two-cols">
          <el-form-item :label="isEnglish ? 'Brand' : '品牌'"><el-input v-model="form.brand" maxlength="80" :placeholder="isEnglish ? 'Leave blank if not applicable' : '没有品牌可留空'" /></el-form-item>
          <el-form-item :label="isEnglish ? 'Model' : '型号'"><el-input v-model="form.model" maxlength="80" :placeholder="isEnglish ? 'Model, specification, or version' : '型号、规格或版本'" /></el-form-item>
        </div>
      </section>

      <section v-if="!isMaterialsMode">
        <h2>{{ isEnglish ? 'Condition and inspection' : '使用与验货信息' }}</h2>
        <div class="two-cols">
          <el-form-item :label="isEnglish ? 'Condition' : '商品成色'" required>
            <el-select v-model="form.condition" :placeholder="isEnglish ? 'Select condition' : '请选择商品成色'" style="width:100%">
              <el-option v-for="item in conditions" :key="item.value" :label="item.label" :value="item.value" />
            </el-select>
          </el-form-item>
          <el-form-item :label="isEnglish ? 'Time used' : '使用时间'"><el-input v-model="form.usageDuration" maxlength="80" :placeholder="isEnglish ? 'For example: used for about one year' : '例如：使用约 1 年'" /></el-form-item>
        </div>
        <el-form-item :label="isEnglish ? 'Accessories' : '配件情况'"><el-input v-model="form.accessories" maxlength="500" :placeholder="isEnglish ? 'Packaging, charger, receipt, and so on' : '包装、充电器、票据等'" /></el-form-item>
        <el-form-item :label="isEnglish ? 'Defects' : '瑕疵说明'"><el-input v-model="form.flaws" type="textarea" :rows="3" maxlength="1000" show-word-limit :placeholder="isEnglish ? 'Describe scratches, damage, missing parts, or faults honestly. State it if there are no obvious defects.' : '请如实说明划痕、损坏、缺件和功能异常；无明显瑕疵也请注明'" /></el-form-item>
        <el-checkbox v-model="form.testAllowed">{{ isEnglish ? 'Allow testing during the meetup' : '支持见面时当面测试' }}</el-checkbox>
        <el-alert class="contact-rule" type="info" :closable="false" show-icon :title="isEnglish ? 'Contact details are private by default. Buyers can start an in-app chat, and both parties arrange price, inspection, and handover themselves.' : '联系方式默认不公开；买家可直接发起站内私聊，双方自行沟通价格、验货和交付。'" />
      </section>

      <section>
        <h2>{{ isMaterialsMode ? (isEnglish ? 'Cover and previews' : '资料封面与预览') : (isEnglish ? 'Item photos' : '商品图片') }} <el-tag size="small" :type="requiresImage?'danger':'info'">{{ requiresImage ? (isEnglish ? 'Required' : '必填') : (isEnglish ? 'Optional' : '选填') }}</el-tag></h2>
        <p class="section-note">{{ requiresImage ? (isEnglish ? 'This category requires at least one image.' : '该品类出售时至少需要 1 张图片。') : (isEnglish ? 'Images are optional, but a cover, preview, or real photo is recommended.' : '此发布类型可不上传图片；如有封面、预览或实物图，建议添加。') }} {{ isEnglish ? `Up to 9 images; the first becomes the ${isMaterialsMode ? 'material cover' : 'Market cover'}.` : `最多 9 张，第一张作为${isMaterialsMode ? '资料封面' : '市集主图'}。` }}</p>
        <div class="image-grid">
          <div v-for="(url,index) in form.images" :key="url" class="image-cell">
            <img :src="url" :alt="`${isMaterialsMode ? (isEnglish ? 'Material' : '资料') : (isEnglish ? 'Item' : '商品')} ${isEnglish ? 'image' : '图片'} ${index + 1}`" /><span v-if="index===0">{{ isEnglish ? 'Cover' : '主图' }}</span>
            <div class="image-actions">
              <button type="button" :disabled="index===0" :aria-label="isEnglish ? 'Move earlier' : '向前移动'" @click="moveImage(index,index-1)">←</button>
              <button type="button" :disabled="index===form.images.length-1" :aria-label="isEnglish ? 'Move later' : '向后移动'" @click="moveImage(index,index+1)">→</button>
              <button type="button" :aria-label="isEnglish ? 'Delete image' : '删除图片'" @click="form.images.splice(index,1)">×</button>
            </div>
          </div>
          <label v-if="form.images.length<9" class="upload-cell" :class="{ disabled: uploading }">
            <input type="file" accept="image/*" multiple :disabled="uploading" @change="uploadImages" />
            <el-icon :class="{ 'is-loading': uploading }"><Loading v-if="uploading" /><Plus v-else /></el-icon>
            <b>{{ uploading ? (isEnglish ? `Uploading ${uploadProgress}%` : `上传中 ${uploadProgress}%`) : (isEnglish ? 'Add images' : '添加图片') }}</b>
          </label>
        </div>
      </section>

      <section v-if="isDigital && form.listingType === 'sell'">
        <h2>{{ isEnglish ? 'Online delivery' : '线上交付' }}</h2>
        <p class="section-note">{{ isEnglish ? 'The system reveals this content inside the order after payment. It is hidden from the public page and unpaid orders.' : '买家付款成功后，系统自动在订单内展示此内容。商品详情页和未付款订单不会看到。' }}</p>
        <el-form-item :label="isEnglish ? 'Delivery content' : '交付内容'" :required="!hasExistingDigitalDelivery">
          <el-input v-model="form.digitalDelivery" type="textarea" :rows="6" maxlength="10000" show-word-limit :placeholder="hasExistingDigitalDelivery ? (isEnglish ? 'Delivery content is saved; leave blank to keep it unchanged' : '已保存交付内容；留空表示保持不变') : (isEnglish ? 'Enter the download link, access code, and instructions. Keep the link available.' : '填写下载链接、提取码和使用说明。请确保链接长期有效。')" />
        </el-form-item>
        <el-alert type="info" :closable="false" show-icon :title="isEnglish ? 'Delivery content is encrypted on the server and is available only to paid buyers, the seller, and Market administrators.' : '交付内容在服务器加密保存，仅向已付款买家、卖家本人和商城管理员开放。'" />
      </section>

      <section>
        <h2>{{ isEnglish ? 'Price' : '价格信息' }}</h2>
        <div class="two-cols">
          <el-form-item :label="isEnglish ? 'Price (CNY)' : '售价（元）'" required><el-input-number v-model="form.price" :min="0" :max="999999" :precision="2" :step="10" controls-position="right" /></el-form-item>
          <el-form-item :label="isEnglish ? 'Original price (optional)' : '原价（可选）'"><el-input-number v-model="form.originalPrice" :min="0" :max="999999" :precision="2" :step="10" controls-position="right" /></el-form-item>
        </div>
        <el-checkbox v-model="form.negotiable">{{ isEnglish ? 'Accept offers' : '接受买家议价' }}</el-checkbox>
      </section>

      <section v-if="!isDigital">
        <h2>{{ isEnglish ? 'Handover' : '交付信息' }}</h2>
        <div class="three-cols">
          <el-form-item :label="isEnglish ? 'Delivery method' : '交付方式'" required><el-select v-model="form.tradeMode"><el-option v-for="mode in tradeModes" :key="mode" :label="marketTradeModeLabel(mode)" :value="mode" /></el-select></el-form-item>
          <el-form-item :label="isEnglish ? 'Campus (optional)' : '校区（选填）'"><el-select v-model="form.campus" clearable :placeholder="isEnglish ? 'Any campus' : '不限制校区'" style="width:100%"><el-option v-for="campus in MARKET_CAMPUSES" :key="campus" :label="campus" :value="campus" /></el-select></el-form-item>
          <el-form-item :label="isEnglish ? 'Suggested place' : '推荐地点'"><el-input v-model="form.location" maxlength="100" :placeholder="isEnglish ? 'Use a public campus area' : '建议填写公共区域'" /></el-form-item>
        </div>
        <el-form-item :label="isEnglish ? 'Available time' : '可交易时间'"><el-input v-model="form.availableTime" maxlength="500" :placeholder="isEnglish ? 'For example: weekdays after 18:00' : '例如：工作日 18:00 后'" /></el-form-item>
      </section>

      <section v-if="!isMaterialsMode && !editingId">
        <h2>{{ isEnglish ? 'Promotion service' : '推广服务' }} <el-tag size="small" type="info">{{ isEnglish ? 'Optional' : '选填' }}</el-tag></h2>
        <p class="section-note">{{ isEnglish ? 'You can request promotion after publishing. If a slot is available, payment details appear for manual verification; otherwise the request joins the waitlist.' : '商品发布成功后，可同时申请推广。有空位时将显示收款码和四位付款秘钥；付款仍需管理员人工核验，满位时只进入候补。' }}</p>
        <el-form-item :label="isEnglish ? 'Promotion plan (optional)' : '本次发布的推广方案（选填）'">
          <el-select v-model="selectedPromotionPlanCode" clearable :placeholder="isEnglish ? 'No promotion for now' : '暂不使用推广服务'" style="width:100%">
            <el-option v-for="plan in productPromotionPlans" :key="plan.code" :label="`${plan.name} · ¥${plan.price} / ${plan.durationDays} ${isEnglish ? 'days' : '天'}`" :value="plan.code" />
          </el-select>
        </el-form-item>
        <div v-if="selectedPromotionPlan" class="promotion-summary">
          <PromotionLabel :label="selectedPromotionPlan.badgeLabel" :kind="selectedPromotionPlan.type === 'listing_pin' ? 'pin' : 'home'" />
          <div><b>{{ selectedPromotionPlan.name }}</b><span>{{ selectedPromotionPlan.description }}</span></div>
          <strong>¥{{ selectedPromotionPlan.price }}</strong>
        </div>
        <el-alert v-if="!productPromotionPlans.length" type="info" :closable="false" :title="isEnglish ? 'No item-promotion plans are available. You can still publish normally.' : '当前没有可申请的商品推广方案，仍可正常发布商品。'" />
      </section>

      <el-alert type="warning" :closable="false" show-icon :title="isMaterialsMode ? (isEnglish ? 'Do not publish cheating materials, infringing files, pirated textbooks, leaked exam questions, or materials of unknown origin.' : '禁止发布考试作弊材料、侵权文件、盗版教材、泄露试题或来源不明的学习资料。') : (isEnglish ? 'Do not publish illegal or prohibited goods, accounts, prescription drugs, cheating materials, dangerous goods, infringing files, or items of unknown origin.' : '禁止发布违法违规物品、账号、处方药、考试作弊资料、危险品、侵权文件或来源不明商品。')" />
      <footer class="form-actions">
        <el-button :loading="submitting" @click="submit(true)">{{ isEnglish ? 'Save draft' : '保存草稿' }}</el-button>
        <el-button type="primary" :loading="submitting" @click="submit(false)">{{ editingId ? (isEnglish ? 'Save and publish' : '保存并上架') : (isMaterialsMode ? (isEnglish ? 'Publish learning material' : '发布学习资料') : (isEnglish ? 'Publish item' : '发布商品')) }}</el-button>
      </footer>
    </el-form>
    <PromotionPaymentDialog v-model="paymentOpen" :order="paymentOrder" @submitted="paymentOrder = $event" @closed="finishPublishedItem" />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { Loading, Plus } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import { MARKET_CAMPUSES, MARKET_TRADE_MODE_LABELS, marketApi, marketConditionLabel, marketTradeModeLabel, normalizeMarketCampus, type MarketCategory, type MarketCategoryOption, type MarketCondition, type MarketItem, type MarketItemInput, type MarketListingType, type MarketTradeMode, type PromotionOrder, type PromotionPlan } from "@/api/market";
import PromotionLabel from "@/components/market/PromotionLabel.vue";
import PromotionPaymentDialog from "@/components/market/PromotionPaymentDialog.vue";
import { uploadApi } from "@/api/topic";
import { useAuthStore } from "@/stores/auth";
import { clearPublishDraft, moveArrayEntry, readPublishDraft, savePublishDraft } from "@/utils/publishDraft";
import { optimizePublishImage } from "@/utils/publishImage";
import { useLocale } from "@/i18n";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const { isEnglish, locale } = useLocale();
const editingId = Number(route.params.id || 0);
const isMaterialsMode = computed(() => route.meta.marketCatalog === "learning-materials");
const loading = ref(false);
const submitting = ref(false);
const uploading = ref(false);
const uploadProgress = ref(0);
const categories = ref<MarketCategoryOption[]>([]);
const productPromotionPlans = ref<PromotionPlan[]>([]);
const selectedPromotionPlanCode = ref("");
const paymentOpen = ref(false);
const paymentOrder = ref<PromotionOrder | null>(null);
const publishedItemId = ref(0);
const hasExistingDigitalDelivery = ref(false);
const conditionValues = ref<Array<Exclude<MarketCondition, "wanted">>>(["new", "like_new", "good", "fair"]);
const conditions = computed(() => conditionValues.value.map((value) => ({ value, label: marketConditionLabel(value) })));
const tradeModes = ref<MarketTradeMode[]>(Object.keys(MARKET_TRADE_MODE_LABELS) as MarketTradeMode[]);
const initialListingType: MarketListingType = "sell";
const form = reactive<{ listingType: MarketListingType; title: string; description: string; category: MarketCategory; price: number; originalPrice: number | undefined; negotiable: boolean; condition: MarketCondition | ""; tradeMode: MarketTradeMode; campus: string; location: string; images: string[]; digitalDelivery: string; brand: string; model: string; usageDuration: string; flaws: string; accessories: string; testAllowed: boolean; availableTime: string }>({ listingType: initialListingType, title: "", description: "", category: "", price: 0, originalPrice: undefined, negotiable: false, condition: "", tradeMode: "meetup", campus: "", location: "", images: [], digitalDelivery: "", brand: "", model: "", usageDuration: "", flaws: "", accessories: "", testAllowed: true, availableTime: "" });
const selectedCategory = computed(() => categories.value.find((item) => item.slug === form.category));
const isDigital = computed(() => form.category === "digital_goods" || selectedCategory.value?.fulfillmentType === "digital");
const requiresImage = computed(() => form.listingType === "sell" && Boolean(selectedCategory.value?.imageRequired));
const selectedPromotionPlan = computed(() => productPromotionPlans.value.find((plan) => plan.code === selectedPromotionPlanCode.value) || null);
const draftReady = ref(false);
const draftSavedAt = ref(0);
let draftTimer = 0;
const draftType = computed(() => isMaterialsMode.value ? "learning-listing" : "market-listing");
const pageTitle = computed(() => {
  if (editingId) return isMaterialsMode.value
    ? (isEnglish.value ? "Edit learning material" : "编辑学习资料")
    : (isEnglish.value ? "Edit item" : "编辑商品");
  return isMaterialsMode.value
    ? (isEnglish.value ? "Publish learning material" : "发布学习资料")
    : (isEnglish.value ? "Sell an item" : "发布商品");
});
const qualityHints = computed(() => {
  const hints: string[] = [];
  if (!isMaterialsMode.value && !form.category) hints.push(isEnglish.value ? "a category" : "商品品类");
  if (form.title.trim().length < 8) hints.push(isEnglish.value ? "a more specific title" : "更具体的标题");
  if (form.description.trim().length < 40) hints.push(isEnglish.value ? "a detailed description" : "详细描述");
  if (!form.images.length) hints.push(isEnglish.value ? "images" : "实物图片");
  if (!isMaterialsMode.value && !form.flaws.trim()) hints.push(isEnglish.value ? "defect details" : "瑕疵说明");
  if (!isMaterialsMode.value && !form.availableTime.trim()) hints.push(isEnglish.value ? "available time" : "交易时间");
  return hints;
});
const qualityScore = computed(() => Math.round(((6 - Math.min(6, qualityHints.value.length)) / 6) * 100));
const draftSavedLabel = computed(() => draftSavedAt.value
  ? (isEnglish.value ? `Autosaved ${new Date(draftSavedAt.value).toLocaleTimeString(locale.value, { hour: "2-digit", minute: "2-digit" })}` : `已自动保存 ${new Date(draftSavedAt.value).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`)
  : (isEnglish.value ? "Saved automatically on this device" : "内容会自动保存在本机"));
watch(isDigital, (value) => { if (value) form.tradeMode = "online"; else if (form.tradeMode === "online") form.tradeMode = "meetup"; });
watch([form, selectedPromotionPlanCode], () => {
  if (!draftReady.value || editingId) return;
  window.clearTimeout(draftTimer);
  draftTimer = window.setTimeout(() => {
    draftSavedAt.value = savePublishDraft(draftType.value, { ...JSON.parse(JSON.stringify(form)), promotionPlanCode: selectedPromotionPlanCode.value }, auth.user?.id);
  }, 500);
}, { deep: true });
onBeforeUnmount(() => window.clearTimeout(draftTimer));

onMounted(async () => {
  loading.value = true;
  try {
    let existingItem: MarketItem | null = null;
    if (editingId) {
      existingItem = await marketApi.item(editingId);
      if (!existingItem.mine) {
        ElMessage.error(isEnglish.value ? "You cannot edit this item" : "无权编辑该商品");
        await router.replace("/market");
        return;
      }
      if (existingItem.category === "digital_goods") {
        await router.replace({ name: "market-learning-materials-edit", params: { id: existingItem.id } });
        return;
      }
      if (route.meta.marketCatalog === "learning-materials" && existingItem.category !== "digital_goods") {
        await router.replace({ name: "market-edit", params: { id: existingItem.id } });
        return;
      }
    }

    const [meta, nextPromotionPlans] = await Promise.all([
      marketApi.meta({ suppressErrorMessage: true }),
      !editingId && !isMaterialsMode.value ? marketApi.promotionPlans({ scope: "content" }, { suppressErrorMessage: true }) : Promise.resolve([] as PromotionPlan[]),
    ]);
    categories.value = meta.categories;
    conditionValues.value = meta.conditions;
    tradeModes.value = meta.tradeModes;
    productPromotionPlans.value = nextPromotionPlans.filter((plan) => plan.targetType === "market_item");
    if (!editingId) {
      const localDraft = readPublishDraft<Record<string, unknown>>(draftType.value, auth.user?.id);
      if (localDraft) {
        const restored = { ...localDraft.value };
        selectedPromotionPlanCode.value = typeof restored.promotionPlanCode === "string" && productPromotionPlans.value.some((plan) => plan.code === restored.promotionPlanCode) ? restored.promotionPlanCode : "";
        delete restored.promotionPlanCode;
        Object.assign(form, restored);
        delete (form as typeof form & { expiryDays?: number }).expiryDays;
        if ((form.tradeMode as string) === "both") form.tradeMode = "any";
        if (!meta.tradeModes.includes(form.tradeMode)) form.tradeMode = "meetup";
        form.campus = normalizeMarketCampus(form.campus);
        form.images = Array.isArray(localDraft.value.images) ? localDraft.value.images.map(String).slice(0, 9) : [];
        draftSavedAt.value = localDraft.savedAt;
        ElMessage.info(isEnglish.value ? "Restored an unpublished draft from this device" : "已恢复本机未提交的发布内容");
      }
    }
    if (existingItem) {
      hasExistingDigitalDelivery.value = existingItem.hasDigitalDelivery;
      Object.assign(form, {
        listingType: existingItem.listingType,
        title: existingItem.title,
        description: existingItem.description,
        category: existingItem.category,
        price: Number(existingItem.price),
        originalPrice: existingItem.originalPrice ? Number(existingItem.originalPrice) : undefined,
        negotiable: existingItem.negotiable,
        condition: existingItem.condition,
        tradeMode: existingItem.tradeMode,
        campus: existingItem.campus,
        location: existingItem.location,
        images: existingItem.images.map((image) => image.url),
        brand: existingItem.brand,
        model: existingItem.model,
        usageDuration: existingItem.usageDuration,
        flaws: existingItem.flaws,
        accessories: existingItem.accessories,
        testAllowed: existingItem.testAllowed,
        availableTime: existingItem.availableTime,
      });
      form.campus = normalizeMarketCampus(form.campus);
    }
  } finally {
    draftReady.value = true;
    loading.value = false;
  }
});

async function uploadImages(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files || []).slice(0, 9 - form.images.length);
  if (!files.length) return;
  uploading.value = true;
  try {
    for (let index = 0; index < files.length; index += 1) {
      const file = await optimizePublishImage(files[index]);
      const result = await uploadApi.media(file, file.name, { onProgress: (state) => { uploadProgress.value = Math.round(((index + state.percent / 100) / files.length) * 100); } });
      form.images.push(result.url);
    }
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : (isEnglish.value ? "Image upload failed" : "图片上传失败"));
  } finally {
    uploading.value = false;
    uploadProgress.value = 0;
    input.value = "";
  }
}

function moveImage(from: number, to: number) {
  moveArrayEntry(form.images, from, to);
}

function validate(draft = false) {
  if (form.title.trim().length < 2) { ElMessage.warning(isEnglish.value ? `Enter a ${isMaterialsMode.value ? "material" : "item"} title` : `请填写${isMaterialsMode.value ? "资料" : "商品"}标题`); return false; }
  if (!form.description.trim()) { ElMessage.warning(isEnglish.value ? `Enter a ${isMaterialsMode.value ? "material" : "item"} description` : `请填写${isMaterialsMode.value ? "资料说明" : "商品描述"}`); return false; }
  if (!isMaterialsMode.value && !categories.value.some((item) => item.slug === form.category)) { ElMessage.warning(isEnglish.value ? "Select an item category" : "请选择商品品类"); return false; }
  if (!isMaterialsMode.value && !conditions.value.some((item) => item.value === form.condition)) { ElMessage.warning(isEnglish.value ? "Select the item condition" : "请选择商品成色"); return false; }
  if (!Number.isFinite(form.price) || form.price < 0) { ElMessage.warning(isEnglish.value ? "Enter a valid price" : "请填写有效售价"); return false; }
  if (!isMaterialsMode.value && !tradeModes.value.includes(form.tradeMode)) { ElMessage.warning(isEnglish.value ? "Select a delivery method" : "请选择交付方式"); return false; }
  if (!draft && requiresImage.value && !form.images.length) { ElMessage.warning(isEnglish.value ? "This category requires at least one image" : "该品类出售时至少需要上传一张图片"); return false; }
  if (!draft && isDigital.value && form.listingType === "sell" && !form.digitalDelivery.trim() && !hasExistingDigitalDelivery.value) { ElMessage.warning(isEnglish.value ? "Enter the online delivery content" : "请填写学习资料的线上交付内容"); return false; }
  return true;
}

async function submit(draft: boolean) {
  if (!validate(draft) || submitting.value) return;
  submitting.value = true;
  try {
    if (isMaterialsMode.value) {
      form.category = "digital_goods";
      form.tradeMode = "online";
    }
    const payload: MarketItemInput = { ...form, condition: form.condition as MarketCondition, catalog: isMaterialsMode.value ? "learning_materials" : "market", price: form.price, originalPrice: form.originalPrice, draft };
    const item = editingId
      ? await marketApi.updateItem(editingId, { ...payload, status: draft ? "draft" : "active" })
      : await marketApi.createItem(payload);
    clearPublishDraft(draftType.value, auth.user?.id);
    let promotionWarning = "";
    let successMessage = draft
      ? (isEnglish.value ? "Draft saved" : "草稿已保存")
      : isMaterialsMode.value
        ? (isEnglish.value ? "Learning material published" : "学习资料已发布")
        : (isEnglish.value ? "Item published" : "商品已发布");
    if (!draft && !editingId && selectedPromotionPlan.value) {
      if (item.status === "active") {
        try {
          const order = await marketApi.createPromotionOrder({ planCode: selectedPromotionPlan.value.code, targetId: item.id, note: "随商品发布提交" }, { suppressErrorMessage: true });
          if (order.status === "waitlisted") {
            promotionWarning = isEnglish.value ? "Item published. Promotion is full, so your request has joined the waitlist. You will receive an in-app notice when a slot opens." : "商品已发布；目前推广服务已满，推广申请已进入候补队列，空位释放后会发送站内通知";
          } else {
            paymentOrder.value = order;
            publishedItemId.value = item.id;
            paymentOpen.value = true;
            successMessage = isEnglish.value ? "Item published. Complete the promotion payment confirmation." : "商品已发布，请完成推广服务付款确认";
          }
        } catch {
          promotionWarning = isEnglish.value ? "Item published, but the promotion request was not created. The listing is unaffected; try again later in Promotion Services." : "商品已发布，但推广申请未创建；商品不受影响，可稍后在推广服务中重新申请";
        }
      } else {
        promotionWarning = isEnglish.value ? "Item submitted for review. You can request promotion after it becomes a public active listing." : "商品已提交审核；审核通过成为公开在售商品后，可在推广服务中申请推广";
      }
    }
    if (promotionWarning) ElMessage.warning(promotionWarning); else ElMessage.success(successMessage);
    if (paymentOpen.value) return;
    await router.replace({ name: "market-item", params: { id: item.id }, query: draft ? undefined : { published: "1" } });
  } finally {
    submitting.value = false;
  }
}

async function finishPublishedItem() {
  if (!publishedItemId.value) return;
  const id = publishedItemId.value;
  publishedItemId.value = 0;
  await router.replace({ name: "market-item", params: { id }, query: { published: "1" } });
}
</script>

<style scoped>
.publish-page{max-width:1040px;margin:0 auto;display:flex;flex-direction:column;gap:18px}.page-head{display:flex;justify-content:space-between;align-items:flex-end}.page-head span{color:var(--cpu-primary);font-size:11px;letter-spacing:.12em}.page-head h1{margin:5px 0;font-size:28px}.page-head p{margin:0;color:var(--cpu-text-secondary);font-size:13px}.publish-form{padding:26px}.publish-form section+section{margin-top:28px;padding-top:23px;border-top:1px solid var(--cpu-border-soft)}.publish-form h2{margin:0 0 15px;font-size:17px}.section-note{margin:-8px 0 13px;color:var(--cpu-text-secondary);font-size:11px}.two-cols{display:grid;grid-template-columns:1fr 1fr;gap:18px}.three-cols{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}.image-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:10px}.image-cell,.upload-cell{position:relative;aspect-ratio:1;border-radius:11px;overflow:hidden;background:var(--cpu-surface-soft)}.image-cell img{width:100%;height:100%;object-fit:cover}.image-cell span{position:absolute;left:6px;bottom:6px;padding:2px 5px;border-radius:4px;color:#fff;background:#168776;font-size:9px}.image-cell button{position:absolute;right:5px;top:5px;width:24px;height:24px;border:0;border-radius:50%;color:#fff;background:rgba(15,23,42,.68);cursor:pointer}.upload-cell{display:flex;align-items:center;justify-content:center;flex-direction:column;gap:7px;border:1px dashed var(--cpu-border);color:var(--cpu-text-secondary);cursor:pointer}.upload-cell input{display:none}.upload-cell .el-icon{font-size:24px}.upload-cell b{font-size:11px}.form-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:24px;padding-top:20px;border-top:1px solid var(--cpu-border-soft)}@media(max-width:700px){.page-head{align-items:flex-start;flex-direction:column;gap:12px}.publish-form{padding:16px}.two-cols,.three-cols{grid-template-columns:1fr}.image-grid{grid-template-columns:repeat(3,1fr)}.form-actions .el-button{flex:1}}
.fixed-category{display:flex;align-items:center;gap:10px;width:100%;padding:8px 11px;border:1px solid rgba(190,24,93,.16);border-radius:8px;background:linear-gradient(105deg,#fff1f2,#f3e8ff)}.fixed-category>span{display:grid;place-items:center;width:32px;height:32px;border-radius:9px;background:linear-gradient(145deg,#be185d,#7c3aed)}.fixed-category>span img{display:block;width:76%;height:76%;object-fit:contain}.fixed-category>div{display:flex;flex-direction:column}.fixed-category b{color:#701a3d;font-size:12px}.fixed-category small{color:#9d5d77;font-size:9px}
.fixed-listing-type{display:flex;align-items:center;justify-content:space-between;width:100%;min-height:32px;padding:0 11px;border:1px solid var(--cpu-border-soft);border-radius:8px;color:var(--cpu-primary);background:var(--cpu-primary-soft);font-size:12px;font-weight:700}.fixed-listing-type small{color:var(--cpu-text-secondary);font-size:9px;font-weight:400}.contact-rule{margin-top:14px}
.promotion-summary{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:12px;margin-bottom:13px;padding:13px 15px;border:1px solid color-mix(in srgb,var(--cpu-primary) 22%,var(--cpu-border-soft));border-radius:11px;background:var(--cpu-primary-soft)}.promotion-summary>div{display:flex;min-width:0;flex-direction:column;gap:3px}.promotion-summary span{overflow:hidden;color:var(--cpu-text-secondary);font-size:10px;text-overflow:ellipsis;white-space:nowrap}.promotion-summary>strong{font-size:18px}
.publish-readiness{display:grid;grid-template-columns:minmax(0,1fr) 180px auto;align-items:center;gap:16px;margin-bottom:22px;padding:14px 16px;border:1px solid color-mix(in srgb,var(--cpu-primary) 24%,var(--cpu-border-soft));border-radius:13px;background:var(--cpu-primary-soft)}.publish-readiness>div{display:grid;grid-template-columns:auto 1fr;align-items:baseline;gap:2px 8px}.publish-readiness span,.publish-readiness small{color:var(--cpu-text-secondary);font-size:11px}.publish-readiness strong{color:var(--cpu-primary);font-size:19px}.publish-readiness small{grid-column:1/-1}.publish-readiness em{color:var(--cpu-text-secondary);font-size:10px;font-style:normal;white-space:nowrap}.image-actions{position:absolute;left:6px;right:6px;bottom:6px;display:flex;justify-content:flex-end;gap:4px}.image-cell>.image-actions button{position:static;display:grid;place-items:center;width:25px;height:25px;padding:0;border:0;border-radius:7px;color:#fff;background:rgba(15,23,42,.72);cursor:pointer}.image-cell>.image-actions button:disabled{opacity:.35;cursor:not-allowed}.image-cell>span{top:6px;bottom:auto}
@media(max-width:700px){.publish-readiness{grid-template-columns:1fr;gap:9px}.form-actions{position:sticky;z-index:5;bottom:calc(66px + env(safe-area-inset-bottom));margin:22px -16px -16px;padding:12px 16px;background:var(--cpu-card);box-shadow:0 -8px 20px rgba(15,23,42,.06)}}
</style>
