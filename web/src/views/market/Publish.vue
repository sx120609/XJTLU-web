<template>
  <div class="publish-page">
    <header class="page-head">
      <div><span>{{ isMaterialsMode ? 'KAOPU FEATURED LEARNING' : '校园商城' }}</span><h1>{{ editingId ? (isMaterialsMode ? '编辑学习资料' : '编辑商品') : (isMaterialsMode ? '发布学习资料' : '发布商品') }}</h1><p>{{ isMaterialsMode ? '清楚说明资料内容、适用对象和版本信息，付款后的交付内容会被安全保存。' : '信息越完整，越容易快速成交。商品发布者必须是经过统一认证的 XJTLU 用户。' }}</p></div>
      <el-button @click="$router.push(isMaterialsMode ? '/market/learning-materials' : '/market')">{{ isMaterialsMode ? '返回资料专区' : '返回商城' }}</el-button>
    </header>

    <el-form label-position="top" class="publish-form cpu-card" v-loading="loading">
      <section>
        <h2>基本信息</h2>
        <div class="two-cols">
          <el-form-item label="发布类型"><el-segmented v-model="form.listingType" :options="[{label:'出售',value:'sell'},{label:'求购',value:'wanted'}]" block /></el-form-item>
          <el-form-item v-if="!isMaterialsMode" label="商品品类"><el-select v-model="form.category"><el-option v-for="item in categories" :key="item.slug" :label="`${item.icon} ${item.name}`" :value="item.slug" /></el-select></el-form-item>
          <el-form-item v-else label="发布专区"><div class="fixed-category"><span><img src="/brand/kaopu-cloud.svg" alt="" /></span><div><b>靠浦特色学习资料</b><small>独立资料专区 · 线上安全交付</small></div></div></el-form-item>
        </div>
        <el-form-item :label="isMaterialsMode ? '资料标题' : '商品标题'" required><el-input v-model="form.title" maxlength="120" show-word-limit :placeholder="isMaterialsMode ? '课程 / 考试 / 资料名称 / 适用阶段' : '品牌 / 型号 / 关键信息'" /></el-form-item>
        <el-form-item :label="isMaterialsMode ? '资料说明' : '商品描述'" required><el-input v-model="form.description" type="textarea" :rows="8" maxlength="20000" show-word-limit :placeholder="isMaterialsMode ? '说明资料目录、适用课程或考试、版本、页数、文件格式和原创情况，请勿上传侵权或作弊内容。' : '介绍购买时间、使用情况、配件、瑕疵和交易要求，请勿公开填写敏感个人信息。'" /></el-form-item>
      </section>

      <section>
        <h2>{{ isMaterialsMode ? '资料封面与预览' : '商品图片' }} <el-tag size="small" :type="requiresImage?'danger':'info'">{{ requiresImage?'必填':'选填' }}</el-tag></h2>
        <p class="section-note">{{ requiresImage?'该品类出售时至少需要 1 张图片。':'此发布类型可不上传图片；如有封面、预览或实物图，建议添加。' }} 最多 9 张，第一张作为{{ isMaterialsMode ? '资料封面' : '商城主图' }}。</p>
        <div class="image-grid">
          <div v-for="(url,index) in form.images" :key="url" class="image-cell">
            <img :src="url" alt="商品图片" /><span v-if="index===0">主图</span><button type="button" @click="form.images.splice(index,1)">×</button>
          </div>
          <label v-if="form.images.length<9" class="upload-cell" :class="{ disabled: uploading }">
            <input type="file" accept="image/*" multiple :disabled="uploading" @change="uploadImages" />
            <el-icon :class="{ 'is-loading': uploading }"><Loading v-if="uploading" /><Plus v-else /></el-icon>
            <b>{{ uploading ? `上传中 ${uploadProgress}%` : '添加图片' }}</b>
          </label>
        </div>
      </section>

      <section v-if="isDigital && form.listingType === 'sell'">
        <h2>线上交付</h2>
        <p class="section-note">买家付款成功后，系统自动在订单内展示此内容。商品详情页和未付款订单不会看到。</p>
        <el-form-item label="交付内容" :required="!hasExistingDigitalDelivery">
          <el-input v-model="form.digitalDelivery" type="textarea" :rows="6" maxlength="10000" show-word-limit :placeholder="hasExistingDigitalDelivery ? '已保存交付内容；留空表示保持不变' : '填写下载链接、提取码和使用说明。请确保链接长期有效。'" />
        </el-form-item>
        <el-alert type="info" :closable="false" show-icon title="交付内容在服务器加密保存，仅向已付款买家、卖家本人和商城管理员开放。" />
      </section>

      <section>
        <h2>价格与成色</h2>
        <div class="three-cols">
          <el-form-item label="售价（元）" required><el-input-number v-model="form.price" :min="0" :max="999999" :precision="2" :step="10" controls-position="right" /></el-form-item>
          <el-form-item label="原价（可选）"><el-input-number v-model="form.originalPrice" :min="0" :max="999999" :precision="2" :step="10" controls-position="right" /></el-form-item>
          <el-form-item label="商品成色"><el-select v-model="form.condition"><el-option v-for="item in conditions" :key="item.value" :label="item.label" :value="item.value" /></el-select></el-form-item>
        </div>
        <el-checkbox v-model="form.negotiable">接受买家议价</el-checkbox>
      </section>

      <section v-if="!isDigital">
        <h2>交付信息</h2>
        <div class="three-cols">
          <el-form-item label="交付方式"><el-select v-model="form.tradeMode"><el-option label="校园面交" value="meetup" /><el-option label="邮寄" value="shipping" /><el-option label="面交或邮寄" value="both" /></el-select></el-form-item>
          <el-form-item label="校区"><el-input v-model="form.campus" maxlength="40" placeholder="例如：SIP / 太仓" /></el-form-item>
          <el-form-item label="推荐地点"><el-input v-model="form.location" maxlength="100" placeholder="建议填写公共区域" /></el-form-item>
        </div>
      </section>

      <el-alert type="warning" :closable="false" show-icon :title="isMaterialsMode ? '禁止发布考试作弊材料、侵权文件、盗版教材、泄露试题或来源不明的学习资料。' : '禁止发布违法违规物品、账号、处方药、考试作弊资料、危险品、侵权文件或来源不明商品。'" />
      <footer class="form-actions">
        <el-button :loading="submitting" @click="submit(true)">保存草稿</el-button>
        <el-button type="primary" :loading="submitting" @click="submit(false)">{{ editingId ? '保存并上架' : (isMaterialsMode ? '发布学习资料' : '发布商品') }}</el-button>
      </footer>
    </el-form>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { Loading, Plus } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import { marketApi, type MarketCategory, type MarketCategoryOption, type MarketCondition, type MarketItem, type MarketItemInput, type MarketListingType, type MarketTradeMode } from "@/api/market";
import { uploadApi } from "@/api/topic";

const route = useRoute();
const router = useRouter();
const editingId = Number(route.params.id || 0);
const isMaterialsMode = computed(() => route.meta.marketCatalog === "learning-materials");
const loading = ref(false);
const submitting = ref(false);
const uploading = ref(false);
const uploadProgress = ref(0);
const categories = ref<MarketCategoryOption[]>([]);
const hasExistingDigitalDelivery = ref(false);
const conditions = [{ label: "全新", value: "new" }, { label: "近全新", value: "like_new" }, { label: "使用良好", value: "good" }, { label: "有使用痕迹", value: "fair" }];
const form = reactive<{ listingType: MarketListingType; title: string; description: string; category: MarketCategory; price: number; originalPrice: number | undefined; negotiable: boolean; condition: MarketCondition; tradeMode: MarketTradeMode; campus: string; location: string; images: string[]; digitalDelivery: string }>({ listingType: "sell", title: "", description: "", category: "other", price: 0, originalPrice: undefined, negotiable: false, condition: "good", tradeMode: "meetup", campus: "", location: "", images: [], digitalDelivery: "" });
const selectedCategory = computed(() => categories.value.find((item) => item.slug === form.category));
const isDigital = computed(() => form.category === "digital_goods" || selectedCategory.value?.fulfillmentType === "digital");
const requiresImage = computed(() => form.listingType === "sell" && Boolean(selectedCategory.value?.imageRequired));
watch(isDigital, (value) => { if (value) form.tradeMode = "online"; else if (form.tradeMode === "online") form.tradeMode = "meetup"; });

onMounted(async () => {
  loading.value = true;
  try {
    let existingItem: MarketItem | null = null;
    if (editingId) {
      existingItem = await marketApi.item(editingId);
      if (!existingItem.mine) {
        ElMessage.error("无权编辑该商品");
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

    const meta = await marketApi.meta({ suppressErrorMessage: true });
    categories.value = meta.categories;
    if (!categories.value.some((item) => item.slug === form.category) && categories.value.length) form.category = categories.value[0].slug;

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
      });
    }
  } finally {
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
      const file = files[index];
      const result = await uploadApi.media(file, file.name, { onProgress: (state) => { uploadProgress.value = Math.round(((index + state.percent / 100) / files.length) * 100); } });
      form.images.push(result.url);
    }
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "图片上传失败");
  } finally {
    uploading.value = false;
    uploadProgress.value = 0;
    input.value = "";
  }
}

function validate(draft = false) {
  if (form.title.trim().length < 2) { ElMessage.warning(`请填写${isMaterialsMode.value ? "资料" : "商品"}标题`); return false; }
  if (!form.description.trim()) { ElMessage.warning(`请填写${isMaterialsMode.value ? "资料说明" : "商品描述"}`); return false; }
  if (form.price < 0) { ElMessage.warning("价格不能小于 0"); return false; }
  if (!draft && requiresImage.value && !form.images.length) { ElMessage.warning("该品类出售时至少需要上传一张图片"); return false; }
  if (!draft && isDigital.value && form.listingType === "sell" && !form.digitalDelivery.trim() && !hasExistingDigitalDelivery.value) { ElMessage.warning("请填写学习资料的线上交付内容"); return false; }
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
    const payload: MarketItemInput = { ...form, catalog: isMaterialsMode.value ? "learning_materials" : "market", price: form.price, originalPrice: form.originalPrice, draft };
    const item = editingId
      ? await marketApi.updateItem(editingId, { ...payload, status: draft ? "draft" : "active" })
      : await marketApi.createItem(payload);
    ElMessage.success(draft ? "草稿已保存" : isMaterialsMode.value ? "学习资料已发布" : "商品已发布");
    await router.replace({ name: "market-item", params: { id: item.id } });
  } finally {
    submitting.value = false;
  }
}
</script>

<style scoped>
.publish-page{max-width:1040px;margin:0 auto;display:flex;flex-direction:column;gap:18px}.page-head{display:flex;justify-content:space-between;align-items:flex-end}.page-head span{color:var(--cpu-primary);font-size:11px;letter-spacing:.12em}.page-head h1{margin:5px 0;font-size:28px}.page-head p{margin:0;color:var(--cpu-text-secondary);font-size:13px}.publish-form{padding:26px}.publish-form section+section{margin-top:28px;padding-top:23px;border-top:1px solid var(--cpu-border-soft)}.publish-form h2{margin:0 0 15px;font-size:17px}.section-note{margin:-8px 0 13px;color:var(--cpu-text-secondary);font-size:11px}.two-cols{display:grid;grid-template-columns:1fr 1fr;gap:18px}.three-cols{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}.image-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:10px}.image-cell,.upload-cell{position:relative;aspect-ratio:1;border-radius:11px;overflow:hidden;background:var(--cpu-surface-soft)}.image-cell img{width:100%;height:100%;object-fit:cover}.image-cell span{position:absolute;left:6px;bottom:6px;padding:2px 5px;border-radius:4px;color:#fff;background:#168776;font-size:9px}.image-cell button{position:absolute;right:5px;top:5px;width:24px;height:24px;border:0;border-radius:50%;color:#fff;background:rgba(15,23,42,.68);cursor:pointer}.upload-cell{display:flex;align-items:center;justify-content:center;flex-direction:column;gap:7px;border:1px dashed var(--cpu-border);color:var(--cpu-text-secondary);cursor:pointer}.upload-cell input{display:none}.upload-cell .el-icon{font-size:24px}.upload-cell b{font-size:11px}.form-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:24px;padding-top:20px;border-top:1px solid var(--cpu-border-soft)}@media(max-width:700px){.page-head{align-items:flex-start;flex-direction:column;gap:12px}.publish-form{padding:16px}.two-cols,.three-cols{grid-template-columns:1fr}.image-grid{grid-template-columns:repeat(3,1fr)}.form-actions .el-button{flex:1}}
.fixed-category{display:flex;align-items:center;gap:10px;width:100%;padding:8px 11px;border:1px solid rgba(190,24,93,.16);border-radius:8px;background:linear-gradient(105deg,#fff1f2,#f3e8ff)}.fixed-category>span{display:grid;place-items:center;width:32px;height:32px;border-radius:9px;background:linear-gradient(145deg,#be185d,#7c3aed)}.fixed-category>span img{display:block;width:76%;height:76%;object-fit:contain}.fixed-category>div{display:flex;flex-direction:column}.fixed-category b{color:#701a3d;font-size:12px}.fixed-category small{color:#9d5d77;font-size:9px}
</style>
