<template>
  <div class="materials-page">
    <nav class="crumb"><router-link to="/market">市集</router-link><span>/</span><b>靠浦特色学习资料商城</b></nav>

    <section class="materials-hero">
      <div class="hero-copy">
        <span>KAOPU FEATURED LEARNING</span>
        <h1>靠浦特色学习资料商城</h1>
        <p>按课程代码、学习阶段和资料类型，查找同学原创或已获授权的课程笔记、备考资料与学习工具。</p>
        <div><em>课程维度检索</em><em>创作者认证</em><em>人工审核交付</em></div>
      </div>
      <div class="hero-side">
        <strong>{{ total }}</strong><small>份在架资料</small>
        <el-button v-if="auth.isLoggedIn" type="primary" size="large" @click="router.push({name:'market-learning-creator'})"><el-icon><Plus /></el-icon> 创作者中心</el-button>
        <el-button v-else type="primary" size="large" @click="login">登录后发布</el-button>
      </div>
    </section>

    <section class="filter-card cpu-card">
      <div class="search-line">
        <el-input v-model="filters.q" clearable size="large" placeholder="搜索资料名称、学院、专业或课程代码" @keyup.enter="search"><template #prefix><el-icon><Search /></el-icon></template></el-input>
        <el-button type="primary" size="large" @click="search">搜索资料</el-button>
      </div>
      <div class="filter-grid">
        <el-input v-model="filters.courseCode" clearable placeholder="课程代码，如 CPT111" @keyup.enter="search" />
        <el-select v-model="filters.semester" clearable placeholder="适用学期" @change="search"><el-option v-for="row in meta.semesters" :key="row.value" :label="row.label" :value="row.value" /></el-select>
        <el-select v-model="filters.typeId" clearable filterable placeholder="资料类型" @change="search"><el-option v-for="row in approvedTypes" :key="row.id" :label="row.name" :value="row.id" /></el-select>
        <el-select v-model="filters.format" clearable placeholder="文件格式" @change="search"><el-option v-for="row in meta.formats" :key="row.value" :label="row.label" :value="row.value" /></el-select>
        <el-button plain @click="resetFilters">重置筛选</el-button>
      </div>
    </section>

    <section class="results-head">
      <div><span>LEARNING LIBRARY</span><h2>{{ hasFilter ? "筛选结果" : "全部学习资料" }} <small>{{ total }}份</small></h2></div>
      <el-select v-model="filters.sort" class="sort-select" @change="search"><el-option label="最新发布" value="new" /><el-option label="人气优先" value="popular" /></el-select>
    </section>

    <div v-if="loading" class="materials-grid"><article v-for="i in 8" :key="i" class="material-card loading"><el-skeleton animated :rows="5" /></article></div>
    <el-alert v-else-if="error" type="error" :closable="false" show-icon :title="error"><template #default><el-button size="small" @click="load">重新加载</el-button></template></el-alert>
    <div v-else-if="items.length" class="materials-grid">
      <article v-for="item in items" :key="item.id" class="material-card" @click="openItem(item.id)">
        <div class="material-cover">
          <img v-if="item.cover" :src="item.cover" :alt="item.title" loading="lazy" />
          <div v-else class="cover-fallback"><img src="/brand/kaopu-cloud.svg" alt="" /><b>KAOPU LEARNING</b></div>
          <span v-if="item.material?.courseCode">{{ item.material.courseCode }}</span><span v-else class="legacy">待补充信息</span>
          <button type="button" :class="{active:item.favorited}" @click.stop="favorite(item)"><el-icon><StarFilled v-if="item.favorited" /><Star v-else /></el-icon></button>
        </div>
        <div class="material-copy">
          <div class="meta-tags"><em>{{ typeLabel(item) }}</em><em>{{ semesterLabel(item.material?.applicableSemester) }}</em></div>
          <h3>{{ item.title }}</h3><p>{{ item.description }}</p>
          <div class="format-line"><span v-for="format in item.material?.fileFormats?.slice(0,3)" :key="format">{{ format }}</span><small v-if="item.material?.pageCount">{{ item.material.pageCount }}页</small></div>
          <div class="price-line"><small>¥</small><strong>{{ item.price }}</strong><del v-if="item.originalPrice">¥{{ item.originalPrice }}</del></div>
          <footer><UserAvatar :size="30" :src="item.seller.avatar" :name="item.seller.nickname" /><div><b>{{ item.seller.nickname||item.seller.username }}</b><span>XJTLU认证创作者</span></div><em>{{ item.favoriteCount }} 收藏</em></footer>
        </div>
      </article>
    </div>
    <el-empty v-else description="没有找到符合条件的学习资料"><el-button type="primary" @click="resetFilters">清除筛选</el-button></el-empty>
    <el-pagination v-if="total>pageSize" v-model:current-page="page" background layout="prev, pager, next" :page-size="pageSize" :total="total" @current-change="load" />
  </div>
</template>

<script setup lang="ts">
import { computed,onMounted,reactive,ref } from "vue";import { useRoute,useRouter } from "vue-router";import { Plus,Search,Star,StarFilled } from "@element-plus/icons-vue";import { ElMessage } from "element-plus";import { learningMaterialsApi,type LearningMaterialItem,type LearningMaterialMeta } from "@/api/learningMaterials";import { marketApi } from "@/api/market";import { useAuthStore } from "@/stores/auth";import UserAvatar from "@/components/common/UserAvatar.vue";
const route=useRoute(),router=useRouter(),auth=useAuthStore();const items=ref<LearningMaterialItem[]>([]),loading=ref(false),error=ref(""),total=ref(0),page=ref(1);const pageSize=24;
const meta=reactive<LearningMaterialMeta>({category:{id:0,slug:"digital_goods",name:"电子资料",icon:"📁",description:"",fulfillmentType:"digital",imageRequired:false,enabled:true,sort:30,itemCount:0},semesters:[],formats:[],languages:[],originalityOptions:[],supportCategories:[],types:[],contentRules:[],legacyIncompleteCount:0});
const filters=reactive({q:String(route.query.q||""),courseCode:String(route.query.courseCode||""),semester:String(route.query.semester||""),typeId:route.query.typeId?Number(route.query.typeId):undefined as number|undefined,format:String(route.query.format||""),sort:(String(route.query.sort||"new") as "new"|"popular")});
const approvedTypes=computed(()=>meta.types.filter(row=>row.status==="approved"));const hasFilter=computed(()=>Boolean(filters.q||filters.courseCode||filters.semester||filters.typeId||filters.format));onMounted(async()=>{try{Object.assign(meta,await learningMaterialsApi.meta({suppressErrorMessage:true}))}catch{}await load()});
async function load(){loading.value=true;error.value="";try{const result=await learningMaterialsApi.items({page:page.value,size:pageSize,q:filters.q||undefined,courseCode:filters.courseCode||undefined,semester:filters.semester||undefined,typeId:filters.typeId,format:filters.format||undefined,sort:filters.sort},{suppressErrorMessage:true});items.value=result.list;total.value=result.total}catch(e){error.value=e instanceof Error?e.message:"资料加载失败"}finally{loading.value=false}}
async function search(){page.value=1;await router.replace({query:{...(filters.q?{q:filters.q}:{}),...(filters.courseCode?{courseCode:filters.courseCode.toUpperCase()}:{}),...(filters.semester?{semester:filters.semester}:{}),...(filters.typeId?{typeId:String(filters.typeId)}:{}),...(filters.format?{format:filters.format}:{}),...(filters.sort!=="new"?{sort:filters.sort}:{})}});await load()}
async function resetFilters(){Object.assign(filters,{q:"",courseCode:"",semester:"",typeId:undefined,format:"",sort:"new"});await search()}
function openItem(id:number){router.push({name:"market-learning-material-item",params:{id}})}function login(){router.push({name:"login",query:{redirect:route.fullPath}})}function semesterLabel(value?:string){return meta.semesters.find(row=>row.value===value)?.label||"学期待补充"}function typeLabel(item:LearningMaterialItem){return item.material?.type?.name||"资料类型待补充"}
async function favorite(item:LearningMaterialItem){if(!auth.isLoggedIn)return login();try{const result=await marketApi.favorite(item.id);item.favorited=result.favorited;item.favoriteCount=result.favoriteCount}catch{ElMessage.error("收藏操作失败")}}
</script>

<style scoped>
.materials-page{max-width:1460px;margin:0 auto;display:flex;flex-direction:column;gap:22px}.crumb{display:flex;gap:8px;color:var(--cpu-text-secondary);font-size:11px}.crumb a{color:#a21caf;text-decoration:none}.materials-hero{position:relative;display:flex;align-items:center;justify-content:space-between;min-height:270px;padding:45px 55px;overflow:hidden;border-radius:26px;color:#fff;background:radial-gradient(circle at 84% 12%,rgba(255,255,255,.18),transparent 25%),linear-gradient(120deg,#9f1239,#a21caf 52%,#6d28d9)}.materials-hero:after{content:"";position:absolute;right:-80px;bottom:-180px;width:420px;height:420px;border:60px solid rgba(255,255,255,.07);border-radius:50%}.hero-copy,.hero-side{position:relative;z-index:1}.hero-copy>span{font-size:10px;font-weight:800;letter-spacing:.2em}.hero-copy h1{margin:12px 0;font-size:43px}.hero-copy p{max-width:650px;margin:0;color:#fae8ff;font-size:15px}.hero-copy>div{display:flex;gap:9px;margin-top:24px}.hero-copy em{padding:6px 10px;border:1px solid rgba(255,255,255,.22);border-radius:999px;background:rgba(255,255,255,.1);font-size:9px;font-style:normal}.hero-side{display:flex;align-items:flex-end;flex-direction:column}.hero-side strong{font-size:46px}.hero-side small{margin:-5px 0 21px;color:#f5d0fe}.filter-card{padding:18px}.search-line{display:grid;grid-template-columns:1fr auto;gap:12px}.filter-grid{display:grid;grid-template-columns:1.1fr repeat(3,1fr) auto;gap:10px;margin-top:12px}.results-head{display:flex;align-items:flex-end;justify-content:space-between}.results-head span{color:#a21caf;font-size:9px;font-weight:800;letter-spacing:.16em}.results-head h2{margin:4px 0 0;font-size:25px}.results-head h2 small{color:var(--cpu-text-secondary);font-size:12px;font-weight:500}.sort-select{width:170px}.materials-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:17px}.material-card{overflow:hidden;border:1px solid var(--cpu-border-soft);border-radius:17px;background:var(--cpu-card);box-shadow:0 12px 32px rgba(62,28,87,.05);cursor:pointer;transition:.2s}.material-card:hover{transform:translateY(-4px);box-shadow:0 18px 42px rgba(109,40,217,.12)}.material-card.loading{min-height:390px;padding:22px}.material-cover{position:relative;height:185px;overflow:hidden;background:linear-gradient(145deg,#fdf2f8,#f3e8ff)}.material-cover>img{width:100%;height:100%;object-fit:cover}.cover-fallback{display:flex;align-items:center;justify-content:center;flex-direction:column;height:100%;gap:5px;color:#86198f}.cover-fallback img{width:76px;height:76px;object-fit:contain}.cover-fallback b{font-size:8px;letter-spacing:.18em}.material-cover>span{position:absolute;left:12px;top:12px;padding:5px 8px;border-radius:7px;color:#fff;background:#9d174d;font-size:9px;font-weight:800}.material-cover>span.legacy{background:#64748b}.material-cover>button{position:absolute;right:11px;top:11px;width:34px;height:34px;border:0;border-radius:50%;color:#64748b;background:rgba(255,255,255,.92);cursor:pointer}.material-cover>button.active{color:#be185d}.material-copy{padding:16px}.meta-tags{display:flex;gap:5px}.meta-tags em,.format-line span{padding:3px 6px;border-radius:5px;color:#86198f;background:#fae8ff;font-size:8px;font-style:normal}.material-copy h3{height:44px;margin:8px 0 5px;overflow:hidden;font-size:16px;line-height:22px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}.material-copy>p{height:36px;margin:0;overflow:hidden;color:var(--cpu-text-secondary);font-size:10px;line-height:18px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}.format-line{display:flex;align-items:center;gap:4px;height:28px;margin-top:8px}.format-line small{margin-left:auto;color:var(--cpu-text-secondary)}.price-line{display:flex;align-items:baseline;gap:5px;margin:7px 0 12px;color:#be185d}.price-line strong{font-size:23px}.price-line del{margin-left:4px;color:#94a3b8;font-size:10px}.material-copy footer{display:flex;align-items:center;gap:8px;padding-top:11px;border-top:1px solid var(--cpu-border-soft)}.material-copy footer>div{display:flex;min-width:0;flex-direction:column}.material-copy footer b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px}.material-copy footer span,.material-copy footer em{color:var(--cpu-text-secondary);font-size:8px}.material-copy footer em{margin-left:auto;font-style:normal}.el-pagination{justify-content:center}@media(max-width:1120px){.materials-grid{grid-template-columns:repeat(3,1fr)}.filter-grid{grid-template-columns:repeat(3,1fr)}.filter-grid .el-button{grid-column:3}}@media(max-width:780px){.materials-hero{align-items:flex-start;flex-direction:column;padding:30px}.hero-copy h1{font-size:34px}.hero-side{width:100%;align-items:flex-start;margin-top:24px}.materials-grid{grid-template-columns:repeat(2,1fr)}.filter-grid{grid-template-columns:repeat(2,1fr)}}@media(max-width:540px){.hero-copy>div{flex-wrap:wrap}.materials-grid{grid-template-columns:1fr}.search-line,.filter-grid{grid-template-columns:1fr}.filter-grid .el-button{grid-column:auto}.results-head{align-items:flex-start;flex-direction:column;gap:10px}.sort-select{width:100%}}
.free-line{display:flex;align-items:center;justify-content:space-between;margin:9px 0 12px}.free-line strong{color:#168776;font-size:15px}.free-line span{color:var(--cpu-text-secondary);font-size:9px}
</style>
