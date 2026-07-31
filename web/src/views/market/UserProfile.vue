<template>
  <div class="profile-page" v-loading="loading">
    <template v-if="profile">
      <header class="profile-hero cpu-card">
        <UserAvatar :size="72" :src="profile.user.avatar" :name="profile.user.nickname" />
        <div><span>KAOPU · SELLER</span><h1>{{ profile.user.nickname || (isEnglish ? 'Campus user' : '校园用户') }}</h1><p>{{ trust?.identity.label || (profile.user.studentSso ? (isEnglish ? 'XJTLU campus identity verified' : 'XJTLU 校园身份已认证') : (isEnglish ? 'Campus platform user' : '校园平台用户')) }} · {{ isEnglish ? "Joined" : "加入于" }} {{ joinDate }}</p><small v-if="profile.user.major" class="profile-major">{{ profile.user.major }}</small></div>
        <div class="hero-actions"><el-button v-if="canReport" type="danger" plain @click="reportOpen = true">{{ isEnglish ? "Report user" : "举报用户" }}</el-button><el-button @click="$router.push('/market')">{{ isEnglish ? "Back to Market" : "返回市集" }}</el-button></div>
      </header>
      <section class="stats cpu-card"><div><strong>{{ trust?.score ?? '—' }}</strong><span>{{ isEnglish ? "Trust score" : "信誉值" }}</span></div><div><strong>{{ profile.stats.rating.toFixed(1) }}</strong><span>{{ isEnglish ? "Trade rating" : "交易评分" }}</span></div><div><strong>{{ trust?.completedTradeCount ?? profile.stats.completedTrades }}</strong><span>{{ isEnglish ? "Completed trades" : "成交笔数" }}</span></div><div><strong>{{ trust?.completionRate ?? 0 }}%</strong><span>{{ isEnglish ? "Completion rate" : "成交率" }}</span></div><div><strong>{{ trust?.positiveRate ?? profile.stats.positiveRate }}%</strong><span>{{ isEnglish ? "Positive rate" : "好评率" }}</span></div><div><strong>{{ profile.stats.listingCount }}</strong><span>{{ isEnglish ? "Public listings" : "公开在售" }}</span></div></section>
      <section><div class="section-head"><div><span>ACTIVE LISTINGS</span><h2>{{ isEnglish ? "Items for sale" : "在售物品" }}</h2></div><small>{{ isEnglish ? "Only public, active listings are shown" : "仅展示公开、有效的商品" }}</small></div><div v-if="profile.recentItems.length" class="goods-grid"><article v-for="item in profile.recentItems" :key="item.id" @click="$router.push(`/market/item/${item.id}`)"><div><img v-if="item.cover" :src="item.cover" :alt="item.title" /><span v-else>📦</span></div><h3>{{ item.title }}</h3><p><strong>¥{{ item.price }}</strong><span>{{ item.campus || (isEnglish ? 'On-campus handoff' : '校内面交') }}</span></p></article></div><el-empty v-else :description="isEnglish ? 'This user has no public active listings' : '该用户暂时没有公开在售物品'" /></section>
      <el-alert type="info" :closable="false" show-icon :title="isEnglish ? 'Profiles never expose student IDs, login names, or contact details. Start an in-app chat if you are interested in a listing.' : '个人主页不会公开学号、登录名或联系方式。对在售商品有意向时可直接发起站内私聊。'" />
    </template>
    <el-empty v-else-if="!loading" :description="isEnglish ? 'User trade profile not found' : '用户交易主页不存在'"><el-button @click="$router.push('/market')">{{ isEnglish ? "Back to Market" : "返回市集" }}</el-button></el-empty>
    <el-dialog v-model="reportOpen" :title="isEnglish ? 'Report this user' : '举报该用户'" width="440px"><el-form label-position="top"><el-form-item :label="isEnglish ? 'Reason' : '举报原因'"><el-input v-model="report.reason" maxlength="80" :placeholder="isEnglish ? 'Example: suspected fraud, harassment, or prohibited trade' : '例如：疑似欺诈、骚扰或违规交易'" /></el-form-item><el-form-item :label="isEnglish ? 'Additional details' : '补充说明'"><el-input v-model="report.detail" type="textarea" :rows="4" maxlength="1000" show-word-limit /></el-form-item></el-form><template #footer><el-button @click="reportOpen = false">{{ isEnglish ? "Cancel" : "取消" }}</el-button><el-button type="danger" :loading="reporting" @click="submitReport">{{ isEnglish ? "Submit report" : "提交举报" }}</el-button></template></el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { ElMessage } from "element-plus";
import { marketApi, type MarketTrustProfile } from "@/api/market";
import UserAvatar from "@/components/common/UserAvatar.vue";
import { useAuthStore } from "@/stores/auth";
import { useLocale } from "@/i18n";

const route = useRoute();
const auth = useAuthStore();
const { isEnglish, locale } = useLocale();
const profile = ref<Awaited<ReturnType<typeof marketApi.userMarketProfile>> | null>(null);
const trust = ref<MarketTrustProfile | null>(null);
const loading = ref(false);
const reportOpen = ref(false);
const reporting = ref(false);
const report = reactive({ reason: "", detail: "" });
const canReport = computed(() => auth.isLoggedIn && auth.user?.id !== profile.value?.user.id);
const joinDate = computed(() => profile.value?.user.createdAt ? new Date(profile.value.user.createdAt).toLocaleDateString(locale.value, { year: "numeric", month: "long" }) : (isEnglish.value ? "Recently" : "近期"));
onMounted(load);
watch(() => route.params.id, load);
async function load() { loading.value = true; try { [profile.value, trust.value] = await Promise.all([marketApi.userMarketProfile(Number(route.params.id), { suppressErrorMessage: true }), marketApi.userTrust(Number(route.params.id), { suppressErrorMessage: true })]); } catch { profile.value = null; trust.value = null; } finally { loading.value = false; } }
async function submitReport() { if (!profile.value || reporting.value) return; if (report.reason.trim().length < 2) return void ElMessage.warning(isEnglish.value ? "Enter a report reason" : "请填写举报原因"); reporting.value = true; try { await marketApi.reportUser(profile.value.user.id, report); reportOpen.value = false; report.reason = ""; report.detail = ""; ElMessage.success(isEnglish.value ? "Report submitted for administrator review" : "举报已提交，管理员会尽快核查"); } finally { reporting.value = false; } }
</script>

<style scoped>
.profile-page{display:flex;flex-direction:column;gap:18px}.profile-hero{display:flex;align-items:center;gap:16px;padding:23px}.profile-hero>div{min-width:0;flex:1}.profile-hero .hero-actions{display:flex;flex:0 0 auto;gap:7px}.profile-hero span,.section-head span{color:var(--cpu-primary);font-size:9px;letter-spacing:.14em}.profile-hero h1{margin:5px 0;font-size:25px}.profile-hero p{margin:0;color:var(--cpu-text-secondary);font-size:11px}.stats{display:grid;grid-template-columns:repeat(6,1fr);padding:18px}.stats div{display:flex;align-items:center;flex-direction:column;gap:4px;border-right:1px solid var(--cpu-border-soft)}.stats div:last-child{border:0}.stats strong{font-size:22px}.stats span{color:var(--cpu-text-secondary);font-size:9px}.section-head{display:flex;align-items:flex-end;justify-content:space-between;margin-bottom:12px}.section-head h2{margin:4px 0 0}.section-head small{color:var(--cpu-text-secondary)}.goods-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.goods-grid article{padding:10px;border:1px solid var(--cpu-border-soft);border-radius:12px;background:var(--cpu-card);cursor:pointer}.goods-grid article>div{display:grid;place-items:center;aspect-ratio:1.25/1;overflow:hidden;border-radius:9px;background:var(--cpu-surface-soft);font-size:34px}.goods-grid img{width:100%;height:100%;object-fit:cover}.goods-grid h3{height:38px;margin:9px 0 5px;overflow:hidden;font-size:12px}.goods-grid p{display:flex;align-items:center;justify-content:space-between;margin:0}.goods-grid strong{color:#ef4444}.goods-grid span{color:var(--cpu-text-secondary);font-size:9px}@media(max-width:700px){.profile-hero{align-items:flex-start;flex-wrap:wrap}.profile-hero>div{min-width:calc(100% - 90px)}.profile-hero .hero-actions{width:100%}.profile-hero .hero-actions .el-button{flex:1}.stats{grid-template-columns:repeat(3,1fr);gap:14px}.stats div{border:0}.goods-grid{grid-template-columns:repeat(2,1fr)}}
.profile-major{display:block;margin-top:5px;color:var(--cpu-text-secondary);font-size:11px}
</style>
