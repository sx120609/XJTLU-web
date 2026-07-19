<template>
  <div class="merchant-list-page">
    <section class="merchant-hero"><div><span>CAMPUS SERVICES</span><h1>合作商户</h1><p>经资料审核并启用主页的校园周边服务。所有卡片均明确标注商业属性。</p></div><el-button v-if="auth.isLoggedIn" size="large" @click="$router.push('/market/merchant/apply')">申请商户主页</el-button></section>
    <section class="filter cpu-card"><el-input v-model="filters.q" clearable placeholder="搜索服务、商户或服务范围" @keyup.enter="load" /><el-select v-model="filters.category" clearable placeholder="全部分类"><el-option v-for="category in categories" :key="category" :label="category" :value="category" /></el-select><el-button type="primary" @click="load">搜索</el-button></section>
    <section class="merchant-grid" v-loading="loading">
      <article v-for="merchant in merchants" :key="merchant.id" class="cpu-card" @click="openMerchant(merchant)">
        <div class="cover"><img v-if="merchant.images[0]" :src="merchant.images[0]" :alt="merchant.name" /><span v-else>🏪</span><PromotionLabel label="合作商户" kind="merchant" /></div>
        <div class="copy"><span>{{ merchant.category }}</span><h2>{{ merchant.name }}</h2><p>{{ merchant.description }}</p><dl><div><dt>价格</dt><dd>{{ merchant.priceRange }}</dd></div><div><dt>范围</dt><dd>{{ merchant.serviceArea }}</dd></div></dl><footer><span>浏览 {{ merchant.viewCount }}</span><span>收藏 {{ merchant.favoriteCount }}</span><span>咨询 {{ merchant.inquiryCount }}</span></footer></div>
      </article>
      <el-empty v-if="!loading&&!merchants.length" description="暂无已启用的合作商户主页" />
    </section>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { marketApi, type MerchantProfile } from "@/api/market";
import { useAuthStore } from "@/stores/auth";
import PromotionLabel from "@/components/market/PromotionLabel.vue";
const router=useRouter(),auth=useAuthStore();const merchants=ref<MerchantProfile[]>([]),categories=ref<string[]>([]),loading=ref(false);const filters=reactive({q:"",category:""});onMounted(load);
async function load(){loading.value=true;try{const result=await marketApi.merchants({...filters,page:1,size:40},{suppressErrorMessage:true});merchants.value=result.list;categories.value=Array.from(new Set(result.list.map(row=>row.category)));for(const row of result.list){const orderId=row.promotion.homepage?.orderId;if(orderId)void marketApi.recordPromotionEvent(orderId,"impression",{suppressErrorMessage:true});}}finally{loading.value=false}}
function openMerchant(merchant:MerchantProfile){const orderId=merchant.promotion.homepage?.orderId;if(orderId)void marketApi.recordPromotionEvent(orderId,"click",{suppressErrorMessage:true});void router.push(`/market/merchant/${merchant.slug}`)}
</script>

<style scoped>
.merchant-list-page{display:flex;flex-direction:column;gap:18px}.merchant-hero{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:27px 31px;border-radius:18px;color:#fff;background:linear-gradient(125deg,#0f766e,#168776 55%,#2563eb)}.merchant-hero span{font-size:9px;letter-spacing:.16em}.merchant-hero h1{margin:6px 0}.merchant-hero p{margin:0;font-size:11px;opacity:.88}.filter{display:grid;grid-template-columns:minmax(0,1fr) 220px auto;gap:9px;padding:13px}.merchant-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;min-height:260px}.merchant-grid article{overflow:hidden;cursor:pointer;transition:.18s}.merchant-grid article:hover{transform:translateY(-3px);box-shadow:0 12px 26px rgba(15,23,42,.09)}.cover{position:relative;display:grid;place-items:center;aspect-ratio:1.55/1;overflow:hidden;background:var(--cpu-surface-soft);font-size:52px}.cover img{width:100%;height:100%;object-fit:cover}.cover :deep(.promotion-label){position:absolute;left:10px;top:10px}.copy{padding:15px}.copy>span{color:var(--cpu-primary);font-size:9px}.copy h2{margin:5px 0 7px;font-size:17px}.copy>p{display:-webkit-box;height:42px;margin:0;overflow:hidden;color:var(--cpu-text-secondary);font-size:10px;line-height:21px;-webkit-box-orient:vertical;-webkit-line-clamp:2}.copy dl{display:grid;grid-template-columns:1fr 1fr;gap:7px}.copy dl>div{padding:8px;border-radius:7px;background:var(--cpu-surface-soft)}.copy dt{color:var(--cpu-text-secondary);font-size:8px}.copy dd{margin:3px 0 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px}.copy footer{display:flex;justify-content:space-between;padding-top:10px;border-top:1px dashed var(--cpu-border-soft);color:var(--cpu-text-secondary);font-size:9px}@media(max-width:900px){.merchant-grid{grid-template-columns:repeat(2,1fr)}}@media(max-width:600px){.merchant-hero{align-items:flex-start;flex-direction:column}.merchant-hero .el-button{width:100%}.filter{grid-template-columns:1fr}.merchant-grid{grid-template-columns:1fr}}
</style>
