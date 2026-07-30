<template>
  <div class="learning-hub">
    <section class="learning-hero">
      <div>
        <span>KAOPU LEARNING</span>
        <h1>学习中心</h1>
        <p>把学习用品、同学交流、优质付费资料和学校官方资源放在一个清晰入口里。</p>
      </div>
      <img src="/brand/kaopu-cloud.svg" alt="靠浦" />
    </section>

    <section class="hub-section">
      <header>
        <div><span>STUDY GOODS</span><h2>学习好物</h2><p>教材、计算器和其他实体学习用品，交易仍在市集完成。</p></div>
        <router-link to="/market?category=books">进入市集 →</router-link>
      </header>
      <div v-if="goods.length" class="goods-grid">
        <article v-for="item in goods" :key="item.id" class="cpu-card goods-card" @click="router.push(`/market/item/${item.id}`)">
          <div class="goods-cover"><img v-if="item.cover" :src="item.cover" :alt="item.title" /><img v-else src="/brand/kaopu-cloud.svg" alt="" /></div>
          <div><span>{{ item.category === 'books' ? '教材与学习用品' : '学习好物' }}</span><h3>{{ item.title }}</h3><p>{{ item.description }}</p><b>¥{{ item.price }}</b></div>
        </article>
      </div>
      <el-empty v-else :image-size="70" description="暂无学习好物" />
    </section>

    <section class="hub-section split-section">
      <div>
        <header>
          <div><span>PEER DISCUSSION</span><h2>学习交流</h2><p>围绕课程与学习方法公开提问，同学共同补充。</p></div>
          <router-link to="/forum/b/question">查看问答 →</router-link>
        </header>
        <div v-if="topics.length" class="topic-list cpu-card">
          <router-link v-for="topic in topics" :key="topic.id" :to="`/forum/topic/${topic.id}`">
            <div><b>{{ topic.title }}</b><span>{{ topic.author?.nickname || '同学' }} · {{ topic.replyCount }} 回复</span></div><em>→</em>
          </router-link>
        </div>
        <el-empty v-else :image-size="64" description="暂无学习问答" />
      </div>

      <div>
        <header>
          <div><span>PAID LEARNING</span><h2>付费学习资料专区</h2><p>学习资料与实体商品独立管理；进入专区后再浏览、发布、购买和管理资料。</p></div>
        </header>
        <router-link class="learning-zone-gateway cpu-card" to="/learning/materials">
          <img src="/brand/kaopu-cloud.svg" alt="" />
          <div><b>进入学习资料专区</b><span>人人可发布 · 内容审核 · 独立订单与发布管理</span></div>
          <em>→</em>
        </router-link>
      </div>
    </section>

    <section class="hub-section official-section">
      <header>
        <div><span>OFFICIAL RESOURCES</span><h2>官方学习资源</h2><p>学校官方系统与帮助入口，外链会明确标注责任部门。</p></div>
        <router-link to="/services">全部校园服务 →</router-link>
      </header>
      <div v-if="resources.length" class="resource-grid">
        <a v-for="resource in resources" :key="resource.id" class="cpu-card resource-card" :href="resource.url" target="_blank" rel="noopener noreferrer">
          <i>{{ resource.icon || '🔗' }}</i><div><b>{{ resource.name }}</b><span>{{ resource.owner }}</span><p>{{ resource.description }}</p><small>{{ resource.needSso ? '需要学校统一身份认证' : '学校官方入口' }} · 打开外链 ↗</small></div>
        </a>
      </div>
      <el-empty v-else :image-size="70" description="官方资源暂时不可用" />
    </section>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { marketApi, type MarketItem } from "@/api/market";
import { topicApi, type Topic } from "@/api/topic";
import { servicesApi, type ServiceCard } from "@/api/services";

const router = useRouter();
const goods = ref<MarketItem[]>([]);
const topics = ref<Topic[]>([]);
const resources = ref<ServiceCard[]>([]);

onMounted(async () => {
  const results = await Promise.allSettled([
    marketApi.items({ category: "books", page: 1, size: 4 }, { suppressErrorMessage: true }),
    topicApi.list({ board: "question", page: 1, size: 5, sort: "new" }, { suppressErrorMessage: true }),
    servicesApi.list("学习"),
  ]);
  goods.value = results[0].status === "fulfilled" ? results[0].value.list.slice(0, 4) : [];
  topics.value = results[1].status === "fulfilled" ? results[1].value.list.slice(0, 5) : [];
  resources.value = results[2].status === "fulfilled" ? results[2].value : [];
});
</script>

<style scoped>
.learning-hub{max-width:1380px;margin:0 auto;display:flex;flex-direction:column;gap:34px}.learning-hero{position:relative;display:flex;align-items:center;justify-content:space-between;min-height:250px;padding:42px 52px;overflow:hidden;border-radius:24px;color:#fff;background:radial-gradient(circle at 82% 16%,rgba(255,255,255,.18),transparent 27%),linear-gradient(120deg,#0f766e,#168776 48%,#6d5ce7)}.learning-hero span,.hub-section header span{font-size:10px;font-weight:800;letter-spacing:.18em}.learning-hero h1{margin:10px 0;font-size:42px}.learning-hero p{max-width:670px;margin:0;color:rgba(255,255,255,.86);line-height:1.8}.learning-hero img{position:relative;z-index:1;width:150px;height:150px;object-fit:contain;filter:drop-shadow(0 16px 24px rgba(15,23,42,.18))}.hub-section{display:flex;flex-direction:column;gap:16px}.hub-section header{display:flex;align-items:flex-end;justify-content:space-between;gap:16px}.hub-section header span{color:var(--cpu-primary)}.hub-section h2{margin:4px 0;font-size:25px}.hub-section header p{margin:0;color:var(--cpu-text-secondary);font-size:12px}.hub-section header a{color:var(--cpu-primary);font-size:12px;font-weight:700;text-decoration:none;white-space:nowrap}.goods-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}.goods-card{overflow:hidden;cursor:pointer;transition:.18s}.goods-card:hover{transform:translateY(-3px);border-color:var(--cpu-primary)}.goods-cover{height:150px;background:var(--cpu-surface-soft)}.goods-cover img{width:100%;height:100%;object-fit:cover}.goods-card>div:last-child{padding:14px}.goods-card span{color:var(--cpu-primary);font-size:9px;font-weight:700}.goods-card h3{height:42px;margin:6px 0;font-size:15px;line-height:21px;overflow:hidden}.goods-card p{height:34px;margin:0;color:var(--cpu-text-secondary);font-size:10px;line-height:17px;overflow:hidden}.goods-card b{display:block;margin-top:10px;color:#dc2626}.split-section{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:22px}.split-section>div{display:flex;min-width:0;flex-direction:column;gap:14px}.topic-list{overflow:hidden}.topic-list>a{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 15px;color:var(--cpu-text);text-decoration:none;border-bottom:1px solid var(--cpu-border-soft)}.topic-list>a:last-child{border-bottom:0}.topic-list>a:hover{background:var(--cpu-surface-soft)}.topic-list div{display:flex;min-width:0;flex-direction:column;gap:4px}.topic-list b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}.topic-list span{color:var(--cpu-text-secondary);font-size:10px}.topic-list em{color:var(--cpu-primary);font-style:normal}.learning-zone-gateway{display:flex;align-items:center;gap:16px;min-height:122px;padding:22px;color:var(--cpu-text);text-decoration:none;background:linear-gradient(135deg,var(--cpu-card),color-mix(in srgb,var(--cpu-primary) 9%,var(--cpu-card)))}.learning-zone-gateway:hover{border-color:var(--cpu-primary);transform:translateY(-2px)}.learning-zone-gateway img{width:64px;height:64px;object-fit:contain}.learning-zone-gateway div{display:flex;min-width:0;flex:1;flex-direction:column;gap:6px}.learning-zone-gateway b{font-size:17px}.learning-zone-gateway span{color:var(--cpu-text-secondary);font-size:11px}.learning-zone-gateway em{color:var(--cpu-primary);font-size:28px;font-style:normal}.resource-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.resource-card{display:flex;gap:13px;padding:18px;color:var(--cpu-text);text-decoration:none;transition:.18s}.resource-card:hover{transform:translateY(-2px);border-color:var(--cpu-primary)}.resource-card i{display:grid;place-items:center;width:44px;height:44px;flex:0 0 44px;border-radius:12px;background:rgba(22,135,118,.1);font-size:22px;font-style:normal}.resource-card div{display:flex;min-width:0;flex-direction:column;gap:3px}.resource-card b{font-size:15px}.resource-card span,.resource-card small{color:var(--cpu-text-secondary);font-size:10px}.resource-card p{margin:5px 0;color:var(--cpu-text-secondary);font-size:11px;line-height:1.65}.resource-card small{color:var(--cpu-primary)}@media(max-width:1000px){.goods-grid{grid-template-columns:repeat(2,1fr)}.resource-grid{grid-template-columns:1fr}.learning-hero img{width:110px}}@media(max-width:720px){.learning-hub{gap:26px}.learning-hero{align-items:flex-start;padding:30px 24px}.learning-hero h1{font-size:34px}.learning-hero img{display:none}.split-section{grid-template-columns:1fr}.hub-section header{align-items:flex-start;flex-direction:column}.goods-grid{grid-template-columns:1fr}}
</style>
