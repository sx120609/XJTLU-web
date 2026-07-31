<template>
  <div class="wanted-detail" v-loading="loading">
    <template v-if="post">
      <nav class="crumb"><router-link to="/market/wanted">{{ isEnglish ? "Campus Wanted" : "校园求购" }}</router-link><span>/</span><b>{{ post.title }}</b></nav>
      <section class="wanted-card cpu-card" :class="{ 'learning-wanted-card': isLearningWanted }">
        <header>
          <div class="category-icon">{{ categoryIcon }}</div>
          <div class="headline"><div><el-tag size="small" :type="statusType">{{ statusLabel }}</el-tag><PromotionLabel v-if="post.promotion.urgent" :label="isEnglish ? 'Boosted' : '加急'" kind="urgent" /><span>{{ isEnglish ? "Posted" : "发布于" }} {{ fmtRelative(post.createdAt) }}</span></div><h1>{{ post.title }}</h1><p>{{ categoryName }} · {{ post.campus || (isEnglish ? 'On campus' : '校内') }} · {{ post.location || (isEnglish ? 'Location to be agreed' : '地点待协商') }}</p></div>
          <div class="budget"><small>{{ isEnglish ? "Budget" : "预算范围" }}</small><strong>¥{{ post.budgetMin }}<template v-if="post.budgetMax !== post.budgetMin">–{{ post.budgetMax }}</template></strong></div>
        </header>

        <div class="detail-grid">
          <main>
            <section><h2>{{ isEnglish ? "Request details" : "需求说明" }}</h2><p class="description">{{ post.description }}</p></section>
            <section class="facts"><h2>{{ isLearningWanted ? (isEnglish ? 'Learning material wanted' : '希望收到的学习资料') : (isEnglish ? 'Item wanted' : '希望收到的物品') }}</h2><dl><div><dt>{{ isLearningWanted ? (isEnglish ? 'Course / scope' : '课程 / 资料范围') : (isEnglish ? 'Brand / model' : '品牌 / 型号') }}</dt><dd>{{ post.brandModel || (isEnglish ? 'Any' : '不限') }}</dd></div><div><dt>{{ isLearningWanted ? (isEnglish ? 'Content requirements' : '内容要求') : (isEnglish ? 'Acceptable condition' : '可接受成色') }}</dt><dd>{{ post.condition || (isEnglish ? 'Open to discussion' : '可协商') }}</dd></div><div><dt>{{ isEnglish ? "Preferred time" : "希望交易时间" }}</dt><dd>{{ post.expectedTradeTime || (isEnglish ? 'Discuss with the publisher' : '与发布者协商') }}</dd></div><div><dt>{{ isEnglish ? "Expires" : "有效期至" }}</dt><dd>{{ formatDate(post.expiresAt) }}</dd></div></dl></section>
            <el-alert v-if="isLearningWanted" type="success" :closable="false" show-icon :title="isEnglish ? 'A response may only link reviewed, active content from Learning Materials. Purchase, payment, and delivery remain in that area.' : '学习资料响应只能关联资料专区中已审核上架的内容；购买、付款与交付仍在学习资料专区完成。'" />
            <el-alert v-else type="warning" :closable="false" show-icon :title="isEnglish ? 'Meet and inspect items in a public campus area. The platform does not collect item payments. Do not pay in advance or share verification codes or passwords.' : '请在校内公共区域当面验货。平台不代收商品款；不要提前转账，不要向陌生人提供验证码或账户密码。'" />
          </main>

          <aside>
            <section class="author-card">
              <div><UserAvatar :size="44" :src="post.author.avatar" :name="post.author.nickname" /><span><strong>{{ post.author.nickname || (isEnglish ? 'Campus user' : '校园用户') }}</strong><small v-if="!post.isAnonymous && post.author.major">{{ post.author.major }}</small><small>{{ post.isAnonymous ? (isEnglish ? 'Anonymous · Identity verified by platform' : '匿名发布 · 身份由平台核验') : post.author.studentSso ? (isEnglish ? 'XJTLU identity verified' : 'XJTLU 身份已认证') : (isEnglish ? 'Campus platform user' : '校园平台用户') }}</small></span></div>
              <p>{{ isEnglish ? `${post.responseCount} response(s). Communication and trade confirmation are completed in the in-app chat.` : `求购收到 ${post.responseCount} 个响应。沟通和交易确认全部在站内私聊完成。` }}</p>
            </section>
            <div class="actions">
              <template v-if="post.mine">
                <el-button v-if="canEdit" @click="$router.push(`/market/wanted/${post.id}/edit`)">{{ isEnglish ? "Edit request" : "编辑求购" }}</el-button>
                <el-button v-if="canFinish" @click="openPointPromotion">{{ isEnglish ? "Points promotion" : "积分推流" }}</el-button>
                <el-button v-if="post.status === 'expired'" type="primary" plain @click="$router.push(`/market/wanted/${post.id}/edit`)">{{ isEnglish ? "Edit and republish" : "编辑后重新发布" }}</el-button>
                <el-button v-if="canFinish" type="success" plain @click="lifecycle('complete')">{{ isEnglish ? "Mark as found" : "标记已求到" }}</el-button>
                <el-button v-if="canFinish" type="danger" plain @click="lifecycle('cancel')">{{ isEnglish ? "Close request" : "结束求购" }}</el-button>
              </template>
              <template v-else>
                <el-button v-if="canRespond" type="primary" size="large" @click="openResponse">{{ isLearningWanted ? (isEnglish ? 'I have suitable material' : '我有合适的资料') : (isEnglish ? 'I have a suitable item' : '我有合适的物品') }}</el-button>
                <el-button v-else disabled>{{ post.allowSellerOffers ? (isEnglish ? 'Responses unavailable' : '当前不可响应') : (isEnglish ? 'Publisher disabled responses' : '发布者未开放响应') }}</el-button>
              </template>
              <el-button @click="$router.push({ path: '/post', query: { board: 'trade-talk', wantedPostId: post.id } })">{{ isEnglish ? "Start related discussion" : "发起关联讨论" }}</el-button>
              <el-button @click="shareOpen = true">{{ isEnglish ? "Share request" : "分享求购" }}</el-button>
              <el-button v-if="!post.mine && auth.isLoggedIn" type="danger" plain @click="reportWanted">{{ isEnglish ? "Report" : "举报求购" }}</el-button>
            </div>
          </aside>
        </div>
      </section>

      <section v-if="matchingItems.length" class="matching-items cpu-card">
        <header><div><span>{{ isEnglish ? "EXPLAINED MATCHES" : "可解释匹配" }}</span><h2>{{ isLearningWanted ? (isEnglish ? 'Matching content in Learning Materials' : '资料专区已有这些匹配内容') : (isEnglish ? 'Suitable items already in Market' : '市集里已有这些合适物品') }}</h2><p>{{ isEnglish ? "Calculated from category, budget, and description keywords. Private chats and contact details are never read." : "按品类、预算和描述关键词计算，不读取私聊或联系方式。" }}</p></div><router-link :to="isLearningWanted ? '/learning/materials' : '/market'">{{ isLearningWanted ? (isEnglish ? 'Open Learning Materials' : '进入资料专区') : (isEnglish ? 'Continue browsing' : '继续逛市集') }}</router-link></header>
        <div class="matching-grid"><article v-for="match in matchingItems" :key="match.item.id" :class="{ learning: isLearningItem(match.item) }" @click="openLinkedItem(match.item)"><div class="matching-cover"><img v-if="match.item.cover" :src="match.item.cover" :alt="match.item.title" /><span v-else>{{ isLearningItem(match.item) ? '📝' : '📦' }}</span><b>{{ match.score }} {{ isEnglish ? "pts" : "分" }}</b></div><div class="matching-copy"><strong>{{ match.item.title }}</strong><p>¥{{ match.item.price }} · {{ isLearningItem(match.item) ? (isEnglish ? 'Learning Materials' : '学习资料专区') : (match.item.campus || (isEnglish ? 'On campus' : '校内')) }}</p><div><span v-for="reason in match.reasons" :key="reason.key">{{ matchReason(reason.key, reason.label) }}</span></div></div></article></div>
      </section>

      <section v-if="post.responses?.length" class="responses cpu-card">
        <header><div><h2>{{ post.mine ? (isEnglish ? 'Responses received' : '收到的响应') : (isEnglish ? 'My response' : '我的响应') }}</h2><p>{{ post.mine ? (isEnglish ? 'Start a chat for a suitable item. A trade is recorded only after both parties confirm the real exchange.' : '看中合适物品就直接发起私聊；只有双方确认实际成交后，系统才记录成交。') : (isEnglish ? 'After the requester starts a chat, both parties arrange price, inspection, and handover themselves.' : '求购者发起私聊后，双方自行沟通价格、验货和交付。') }}</p></div><el-tag>{{ post.responses.length }} {{ isEnglish ? "response(s)" : "个" }}</el-tag></header>
        <article v-for="response in post.responses" :key="response.id">
          <div class="response-cover"><img v-if="response.item.cover" :src="response.item.cover" :alt="response.item.title" /><span v-else>📦</span></div>
          <div class="response-copy"><div><strong>{{ response.item.title }}</strong><el-tag v-if="isLearningItem(response.item)" size="small" color="#f3e8ff">{{ isEnglish ? "Learning material" : "学习资料" }}</el-tag><el-tag size="small" :type="responseStatusType(response.status)">{{ responseStatus(response.status) }}</el-tag></div><p>{{ response.description }}</p><small>{{ response.seller?.nickname || (isEnglish ? 'Campus user' : '校园用户') }}<template v-if="response.seller?.major"> · {{ response.seller.major }}</template> · {{ isEnglish ? "Available" : "可交易时间" }}: {{ response.availableTime || (isEnglish ? 'To be agreed' : '待协商') }}</small></div>
          <div class="response-price"><strong>¥{{ response.price }}</strong><el-button size="small" @click="openLinkedItem(response.item)">{{ isEnglish ? "View" : "查看" }}{{ isEnglish ? ` ${isLearningItem(response.item) ? 'material' : 'item'}` : (isLearningItem(response.item) ? '资料' : '物品') }}</el-button></div>
          <div v-if="response.status === 'pending'" class="response-actions">
            <template v-if="post.mine"><el-button size="small" type="danger" plain @click="handleResponse(response.id, 'reject')">{{ isEnglish ? "Decline" : "婉拒" }}</el-button><el-button size="small" type="primary" :loading="chattingResponseId === response.id" @click="startResponseChat(response)">{{ isLearningItem(response.item) ? (isEnglish ? 'View and buy' : '查看并购买') : (isEnglish ? 'Start chat' : '发起私聊') }}</el-button></template>
            <el-button v-else size="small" @click="handleResponse(response.id, 'cancel')">{{ isEnglish ? "Withdraw" : "撤回响应" }}</el-button>
          </div>
          <div v-else-if="post.mine && response.status === 'accepted'" class="response-actions">
            <el-button size="small" type="primary" plain :loading="chattingResponseId === response.id" @click="startResponseChat(response)">{{ isEnglish ? "Open chat" : "打开私聊" }}</el-button>
          </div>
        </article>
      </section>
    </template>
    <el-empty v-else-if="!loading" :description="isEnglish ? 'This request does not exist or has been removed' : '求购不存在或已被移除'"><el-button @click="$router.push('/market/wanted')">{{ isEnglish ? "Back to Wanted" : "返回求购列表" }}</el-button></el-empty>

    <el-dialog v-model="responseOpen" :title="isEnglish ? 'Respond to this request' : '响应这条求购'" width="620px" destroy-on-close>
      <el-form label-position="top">
        <el-radio-group v-model="response.mode" class="response-mode"><el-radio-button value="existing">{{ isEnglish ? `Link my active ${isLearningWanted ? 'material' : 'item'}` : `关联我的在售${isLearningWanted ? '资料' : '商品'}` }}</el-radio-button><el-radio-button v-if="!isLearningWanted" value="new">{{ isEnglish ? "Show a new item only to the requester" : "仅向求购者展示新物品" }}</el-radio-button></el-radio-group>
        <el-form-item v-if="response.mode === 'existing'" :label="isLearningWanted ? (isEnglish ? 'Select learning material' : '选择学习资料') : (isEnglish ? 'Select item' : '选择商品')" required><el-select v-model="response.itemId" :placeholder="isLearningWanted ? (isEnglish ? 'Select one of your reviewed active materials' : '请选择自己已审核上架的学习资料') : (isEnglish ? 'Select one of your active physical items' : '请选择自己当前在售的实体商品')"><el-option v-for="item in availableItems" :key="item.id" :label="`${item.title} · ¥${item.price}`" :value="item.id" /></el-select><small v-if="!availableItems.length">{{ isLearningWanted ? (isEnglish ? 'You have no active materials. Publish in Learning Materials and pass content review first.' : '还没有已上架资料，请先进入学习资料专区发布并通过内容审核。') : (isEnglish ? 'You have no active item to link. You can switch to a new item.' : '还没有可关联的在售商品，也可以切换为上传新物品。') }}</small></el-form-item>
        <template v-else>
          <el-form-item :label="isEnglish ? 'Item name' : '物品名称'" required><el-input v-model="response.title" maxlength="120" :placeholder="isEnglish ? 'Brand, model, and key details' : '品牌、型号和关键信息'" /></el-form-item>
          <div class="two-cols"><el-form-item :label="isEnglish ? 'Brand' : '品牌'"><el-input v-model="response.brand" maxlength="80" /></el-form-item><el-form-item :label="isEnglish ? 'Model' : '型号'"><el-input v-model="response.model" maxlength="80" /></el-form-item></div>
          <el-form-item :label="isEnglish ? 'Real photos' : '实拍图'" required><div class="image-list"><div v-for="url in response.images" :key="url"><img :src="url" :alt="isEnglish ? 'Response item' : '响应物品'" /><button type="button" @click="response.images.splice(response.images.indexOf(url), 1)">×</button></div><label v-if="response.images.length < 5"><input type="file" accept="image/*" multiple :disabled="uploading" @change="uploadImages" /><span>{{ uploading ? (isEnglish ? 'Uploading…' : '上传中…') : (isEnglish ? '+ Add images' : '+ 添加图片') }}</span></label></div></el-form-item>
          <el-form-item :label="isEnglish ? 'Condition' : '物品成色'"><el-select v-model="response.condition"><el-option :label="marketConditionLabel('new')" value="new" /><el-option :label="marketConditionLabel('like_new')" value="like_new" /><el-option :label="marketConditionLabel('good')" value="good" /><el-option :label="marketConditionLabel('fair')" value="fair" /></el-select></el-form-item>
        </template>
        <div class="two-cols"><el-form-item :label="isEnglish ? 'Offered price (CNY)' : '响应价格（元）'" required><el-input-number v-model="response.price" :min="0.01" :max="999999" :precision="2" controls-position="right" /></el-form-item><el-form-item :label="isEnglish ? 'Available time' : '可交易时间'"><el-input v-model="response.availableTime" maxlength="300" :placeholder="isEnglish ? 'For example: weekdays after 18:00' : '例如：工作日 18:00 后'" /></el-form-item></div>
        <el-form-item :label="isEnglish ? 'Item and trade details' : '物品与交易说明'" required><el-input v-model="response.description" type="textarea" :rows="5" maxlength="5000" show-word-limit :placeholder="isEnglish ? 'Describe usage, defects, accessories, and inspection requirements honestly. Do not add contact details.' : '如实说明使用情况、瑕疵、配件和验货要求，请勿填写联系方式。'" /></el-form-item>
        <el-alert type="info" :closable="false" show-icon :title="isLearningWanted ? (isEnglish ? 'A response does not create a trade automatically. Purchase, payment, and delivery take place in Learning Materials.' : '提交响应不会自动成交。求购者查看资料后，购买、付款和交付统一在学习资料专区完成。') : (isEnglish ? 'A response does not create a trade automatically. The requester can start a chat, and the parties settle payment directly.' : '提交响应不会自动成交。求购者可直接发起私聊，商品款仍由双方线下直接结算。')" />
      </el-form>
      <template #footer><el-button @click="responseOpen = false">{{ isEnglish ? "Cancel" : "取消" }}</el-button><el-button type="primary" :loading="submitting" @click="submitResponse">{{ isEnglish ? "Submit response" : "提交响应" }}</el-button></template>
    </el-dialog>

    <MarketShareDialog v-model="shareOpen" :title="post?.title || (isEnglish ? 'Campus Wanted' : '校园求购')" :summary="post ? (isEnglish ? `Budget ¥${post.budgetMin}–${post.budgetMax}, meetup at ${post.campus || 'campus'}` : `预算 ¥${post.budgetMin}–${post.budgetMax}，${post.campus || '校内'}面交`) : ''" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import { marketApi, marketConditionLabel, type MarketCategoryOption, type MarketCondition, type MarketItem, type MarketItemMatch, type WantedPost, type WantedResponse, type WantedResponseAction } from "@/api/market";
import { learningMaterialsApi } from "@/api/learningMaterials";
import { uploadApi } from "@/api/topic";
import { useAuthStore } from "@/stores/auth";
import { fmtRelative } from "@/utils/format";
import UserAvatar from "@/components/common/UserAvatar.vue";
import PromotionLabel from "@/components/market/PromotionLabel.vue";
import MarketShareDialog from "@/components/market/MarketShareDialog.vue";
import { useLocale } from "@/i18n";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const { isEnglish, locale } = useLocale();
const post = ref<WantedPost | null>(null);
const categories = ref<MarketCategoryOption[]>([]);
const availableItems = ref<MarketItem[]>([]);
const matchingItems = ref<MarketItemMatch[]>([]);
const loading = ref(false);
const submitting = ref(false);
const uploading = ref(false);
const responseOpen = ref(false);
const chattingResponseId = ref<number | null>(null);
const shareOpen = ref(route.query.published === "1");
const response = reactive({ mode: "existing" as "existing" | "new", itemId: undefined as number | undefined, title: "", brand: "", model: "", condition: "good" as MarketCondition, images: [] as string[], price: 0, availableTime: "", description: "" });
const category = computed(() => categories.value.find((entry) => entry.slug === post.value?.category));
const categoryIcon = computed(() => category.value?.icon || "📦");
const categoryName = computed(() => category.value?.name || post.value?.category || (isEnglish.value ? "Other" : "其他"));
const statusLabel = computed(() => (isEnglish.value
  ? ({ reviewing: "Under review", active: "Wanted", responded: "Responses received", matched: "Matched", completed: "Found", cancelled: "Closed", expired: "Expired", removed: "Removed" } as Record<string, string>)
  : ({ reviewing: "审核中", active: "求购中", responded: "已有响应", matched: "已匹配", completed: "已求到", cancelled: "已结束", expired: "已过期", removed: "已移除" } as Record<string, string>)
)[post.value?.status || ""] || post.value?.status);
const statusType = computed(() => post.value?.status === "completed" ? "success" : ["cancelled", "expired", "removed"].includes(post.value?.status || "") ? "info" : post.value?.status === "reviewing" ? "warning" : "primary");
const canEdit = computed(() => Boolean(post.value && ["active", "responded", "expired"].includes(post.value.status)));
const canFinish = computed(() => Boolean(post.value && ["active", "responded"].includes(post.value.status)));
const canRespond = computed(() => Boolean(post.value && auth.isLoggedIn && post.value.allowSellerOffers && ["active", "responded"].includes(post.value.status)));
const isLearningWanted = computed(() => post.value?.category === "learning_materials");

onMounted(load);

async function load() {
  loading.value = true;
  try {
    const id = Number(route.params.id);
    const [wanted, meta, matches] = await Promise.all([
      marketApi.wantedPost(id, { suppressErrorMessage: true }),
      marketApi.meta({ suppressErrorMessage: true }),
      marketApi.wantedMatches(id, { suppressErrorMessage: true }).catch(() => []),
    ]);
    post.value = wanted;
    if (wanted.promotion.urgent?.orderId) void marketApi.recordPromotionEvent(wanted.promotion.urgent.orderId, "impression", { suppressErrorMessage: true });
    categories.value = meta.wantedCategories || meta.categories;
    matchingItems.value = matches;
  } catch (error) {
    post.value = null;
    matchingItems.value = [];
    ElMessage.error(error instanceof Error ? error.message : (isEnglish.value ? "Could not load this request" : "求购加载失败"));
  } finally { loading.value = false; }
}

async function openResponse() {
  if (!auth.isLoggedIn) return router.push({ name: "login", query: { redirect: route.fullPath } });
  if (isLearningWanted.value) {
    const learningItems = await learningMaterialsApi.myItems({ suppressErrorMessage: true });
    availableItems.value = learningItems.filter((item) => item.status === "active");
  } else {
    const mine = await marketApi.mine({ suppressErrorMessage: true });
    availableItems.value = mine.selling.filter((item) => item.status === "active" && item.deliveryType === "physical" && item.visibility === "public");
  }
  response.mode = isLearningWanted.value || availableItems.value.length ? "existing" : "new";
  response.itemId = availableItems.value[0]?.id;
  response.price = Number(post.value?.budgetMax || 0);
  response.availableTime = "";
  response.description = "";
  responseOpen.value = true;
}

async function uploadImages(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files || []).slice(0, 5 - response.images.length);
  if (!files.length) return;
  uploading.value = true;
  try {
    for (const file of files) response.images.push((await uploadApi.media(file, file.name)).url);
  } finally { uploading.value = false; input.value = ""; }
}

async function submitResponse() {
  if (!post.value || submitting.value) return;
  if (response.mode === "existing" && !response.itemId) return void ElMessage.warning(isLearningWanted.value ? (isEnglish.value ? "Select an active learning material" : "请选择一个已上架学习资料") : (isEnglish.value ? "Select an active item" : "请选择一个在售商品"));
  if (response.mode === "new" && (!response.title.trim() || !response.images.length)) return void ElMessage.warning(isEnglish.value ? "Enter the item name and upload at least one real photo" : "请填写物品名称并上传至少一张实拍图");
  if (response.price <= 0 || !response.description.trim()) return void ElMessage.warning(isEnglish.value ? "Enter an offered price and item details" : "请填写响应价格和物品说明");
  submitting.value = true;
  try {
    await marketApi.respondToWanted(post.value.id, { itemId: response.mode === "existing" ? response.itemId : undefined, title: response.mode === "new" ? response.title : undefined, price: response.price, description: response.description, images: response.mode === "new" ? response.images : undefined, condition: response.condition, brand: response.brand, model: response.model, availableTime: response.availableTime });
    responseOpen.value = false;
    ElMessage.success(isEnglish.value ? "Response submitted. Waiting for the requester." : "响应已提交，等待求购者处理");
    await load();
  } finally { submitting.value = false; }
}

async function handleResponse(id: number, action: WantedResponseAction) {
  await marketApi.updateWantedResponse(id, action);
  ElMessage.success(isEnglish.value ? "Done" : "操作成功");
  await load();
}

async function startResponseChat(responseItem: WantedResponse) {
  if (isLearningItem(responseItem.item)) {
    await router.push({ name: "market-learning-material-item", params: { id: responseItem.itemId } });
    return;
  }
  chattingResponseId.value = responseItem.id;
  try {
    const conversation = await marketApi.createConversation(
      responseItem.itemId,
      "",
      responseItem.id,
    );
    await router.push({
      name: "market-messages",
      query: { conversation: conversation.id },
    });
  } finally {
    chattingResponseId.value = null;
  }
}

function isLearningItem(item: MarketItem) {
  return item.deliveryType === "digital" || item.category === "digital_goods";
}

function openLinkedItem(item: MarketItem) {
  void router.push(isLearningItem(item)
    ? { name: "market-learning-material-item", params: { id: item.id } }
    : { name: "market-item", params: { id: item.id } });
}

async function lifecycle(action: "cancel" | "complete") {
  if (!post.value) return;
  await ElMessageBox.confirm(
    action === "complete"
      ? (isEnglish.value ? "Confirm that you found the item and close this request?" : "确认已经求到物品并结束这条求购？")
      : (isEnglish.value ? "Close this request? Pending responses will also close." : "确认结束这条求购？未处理响应会一并关闭。"),
    isEnglish.value ? "Confirm action" : "确认操作",
    { type: "warning" },
  );
  post.value = await marketApi.updateWantedLifecycle(post.value.id, action);
  ElMessage.success(isEnglish.value ? "Request status updated" : "求购状态已更新");
  await load();
}

function openPointPromotion() {
  if (!post.value) return;
  void router.push({
    name: "market-promotions",
    query: { mode: "points", targetType: "wanted_post", targetId: String(post.value.id) },
  });
}

async function reportWanted() {
  if (!post.value) return;
  const { value } = await ElMessageBox.prompt(
    isEnglish.value ? "Briefly describe the violation or risk. Administrators will review the full context." : "请简要说明违规类型或风险情况，管理员会结合完整内容核查。",
    isEnglish.value ? "Report request" : "举报求购",
    { inputPattern: /\S{2,80}/, inputErrorMessage: isEnglish.value ? "Enter 2–80 characters" : "请填写 2–80 个字符", confirmButtonText: isEnglish.value ? "Submit report" : "提交举报", type: "warning" },
  );
  await marketApi.reportWanted(post.value.id, { reason: value });
  ElMessage.success(isEnglish.value ? "Report submitted. Thank you." : "举报已提交，感谢你的反馈");
}

function formatDate(value: string) { return new Date(value).toLocaleString(locale.value, { year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }); }
function responseStatus(value: string) {
  return (isEnglish.value
    ? ({ pending: "Pending", accepted: "Chat started", rejected: "Declined", cancelled: "Withdrawn", expired: "Expired" } as Record<string, string>)
    : ({ pending: "等待处理", accepted: "已私聊", rejected: "未接受", cancelled: "已撤回", expired: "已过期" } as Record<string, string>)
  )[value] || value;
}
function responseStatusType(value: string) { return value === "accepted" ? "success" : value === "pending" ? "warning" : "info"; }
function matchReason(key: string, fallback: string) {
  if (!isEnglish.value) return fallback;
  return ({ category: "Same category", budget: "Within budget", title: "Title match", keyword: "Keyword match", course: "Course match" } as Record<string, string>)[key] || fallback;
}
</script>

<style scoped>
.wanted-detail{display:flex;flex-direction:column;gap:16px}.crumb{display:flex;gap:7px;overflow:hidden;color:var(--cpu-text-secondary);font-size:10px}.crumb a{color:var(--cpu-primary)}.crumb b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.wanted-card{padding:24px}.wanted-card>header{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:16px;padding-bottom:20px;border-bottom:1px solid var(--cpu-border-soft)}.category-icon{display:grid;place-items:center;width:58px;height:58px;border-radius:16px;background:var(--cpu-primary-soft);font-size:30px}.headline>div{display:flex;align-items:center;gap:8px}.headline>div span{color:var(--cpu-text-secondary);font-size:9px}.headline h1{margin:8px 0 4px;font-size:25px}.headline p{margin:0;color:var(--cpu-text-secondary);font-size:11px}.budget{text-align:right}.budget small{display:block;color:var(--cpu-text-secondary);font-size:9px}.budget strong{color:#ef4444;font-size:27px}.detail-grid{display:grid;grid-template-columns:minmax(0,1fr) 270px;gap:30px;padding-top:22px}.detail-grid main{display:flex;min-width:0;flex-direction:column;gap:22px}.detail-grid h2,.responses h2{margin:0 0 10px;font-size:16px}.description{margin:0;white-space:pre-wrap;color:var(--cpu-text-secondary);font-size:13px;line-height:1.9}.facts dl{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:0}.facts dl div{padding:11px;border-radius:9px;background:var(--cpu-surface-soft)}.facts dt{color:var(--cpu-text-secondary);font-size:9px}.facts dd{margin:5px 0 0;font-size:12px}.detail-grid aside{display:flex;flex-direction:column;gap:12px}.author-card{padding:14px;border:1px solid var(--cpu-border-soft);border-radius:12px}.author-card>div{display:flex;align-items:center;gap:9px}.author-card span{display:flex;flex-direction:column;gap:3px}.author-card small{color:var(--cpu-primary);font-size:9px}.author-card p{margin:12px 0 0;padding-top:10px;border-top:1px dashed var(--cpu-border-soft);color:var(--cpu-text-secondary);font-size:10px;line-height:1.6}.actions{display:flex;flex-direction:column;gap:7px}.actions .el-button{width:100%;margin:0}.matching-items{padding:20px}.matching-items>header{display:flex;align-items:flex-end;justify-content:space-between;gap:12px}.matching-items header span{color:var(--cpu-primary);font-size:10px;letter-spacing:.12em}.matching-items h2{margin:4px 0;font-size:18px}.matching-items header p{margin:0;color:var(--cpu-text-secondary);font-size:10px}.matching-items header a{color:var(--cpu-primary);font-size:11px}.matching-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-top:14px}.matching-grid article{overflow:hidden;border:1px solid var(--cpu-border-soft);border-radius:11px;cursor:pointer}.matching-grid article:hover{border-color:var(--cpu-primary)}.matching-cover{position:relative;display:grid;place-items:center;height:120px;overflow:hidden;background:var(--cpu-surface-soft);font-size:32px}.matching-cover img{width:100%;height:100%;object-fit:cover}.matching-cover b{position:absolute;right:7px;top:7px;padding:3px 7px;border-radius:10px;color:#fff;background:rgba(17,94,89,.9);font-size:9px}.matching-copy{padding:10px}.matching-copy>strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px}.matching-copy p{margin:5px 0;color:var(--cpu-text-secondary);font-size:9px}.matching-copy>div{display:flex;gap:3px;flex-wrap:wrap}.matching-copy span{padding:2px 5px;border-radius:8px;color:var(--cpu-primary);background:var(--cpu-primary-soft);font-size:8px}.responses{padding:20px}.responses>header{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}.responses header h2{margin-bottom:3px}.responses header p{margin:0;color:var(--cpu-text-secondary);font-size:10px}.responses article{display:flex;align-items:center;gap:12px;padding:12px 0;border-top:1px solid var(--cpu-border-soft)}.response-cover{display:grid;place-items:center;width:66px;height:60px;overflow:hidden;flex:0 0 auto;border-radius:9px;background:var(--cpu-surface-soft);font-size:24px}.response-cover img{width:100%;height:100%;object-fit:cover}.response-copy{min-width:0;flex:1}.response-copy>div{display:flex;align-items:center;gap:7px}.response-copy p{margin:5px 0;color:var(--cpu-text-secondary);font-size:11px}.response-copy small{color:var(--cpu-text-muted);font-size:9px}.response-price{display:flex;align-items:flex-end;flex-direction:column;gap:6px}.response-price strong{color:#ef4444;font-size:18px}.response-actions{display:flex;gap:5px}.response-mode{margin-bottom:18px}.two-cols{display:grid;grid-template-columns:1fr 1fr;gap:14px}.image-list{display:flex;flex-wrap:wrap;gap:8px}.image-list>div,.image-list label{position:relative;width:88px;height:88px;overflow:hidden;border-radius:9px;background:var(--cpu-surface-soft)}.image-list img{width:100%;height:100%;object-fit:cover}.image-list button{position:absolute;right:4px;top:4px;width:23px;height:23px;border:0;border-radius:50%;color:#fff;background:rgba(15,23,42,.65)}.image-list label{display:grid;place-items:center;border:1px dashed var(--cpu-border);color:var(--cpu-text-secondary);font-size:10px;cursor:pointer}.image-list input{display:none}@media(max-width:900px){.matching-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:760px){.wanted-card{padding:16px}.wanted-card>header{grid-template-columns:auto 1fr}.budget{grid-column:1/-1;text-align:left}.detail-grid{grid-template-columns:1fr}.facts dl{grid-template-columns:1fr}.matching-items{padding:15px}.matching-items>header{align-items:flex-start;flex-direction:column}.matching-grid{display:flex;overflow-x:auto;scroll-snap-type:x mandatory}.matching-grid article{min-width:76%;scroll-snap-align:start}.responses article{align-items:flex-start;flex-wrap:wrap}.response-copy{min-width:calc(100% - 80px)}.response-actions{width:100%;justify-content:flex-end}.two-cols{grid-template-columns:1fr}}
.wanted-card.learning-wanted-card{border-color:#c084fc;background:linear-gradient(145deg,var(--cpu-card),color-mix(in srgb,#a855f7 7%,var(--cpu-card)))}.wanted-card.learning-wanted-card .category-icon,.matching-grid article.learning .matching-cover{color:#7e22ce;background:#f3e8ff}.matching-grid article.learning{border-color:#d8b4fe}
</style>
