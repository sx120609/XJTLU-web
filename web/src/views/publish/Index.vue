<template>
  <div class="publish-hub">
    <header class="publish-head">
      <div><span>KAOPU · PUBLISH</span><h1>今天想分享什么？</h1><p>选择内容类型后，靠浦只展示真正相关的字段和规则。</p></div>
      <ol aria-label="发布流程"><li><b>1</b>选择类型</li><li><b>2</b>完善信息</li><li><b>3</b>预览发布</li></ol>
    </header>

    <section class="publish-grid" aria-label="发布类型">
      <router-link v-for="action in actions" :key="action.to" :to="action.to" class="cpu-card publish-card" :class="{ featured: 'featured' in action && action.featured }">
        <span class="card-icon" :class="action.tone"><el-icon><component :is="action.icon" /></el-icon></span>
        <div>
          <h2>{{ action.title }}</h2>
          <p>{{ action.description }}</p>
        </div>
        <el-icon class="arrow"><Right /></el-icon>
      </router-link>
    </section>

    <el-alert
      type="info"
      :closable="false"
      show-icon
      title="校园交易仅提供信息撮合：请在校内公共区域见面、当面验货，款项由买卖双方直接结算。"
    />
  </div>
</template>

<script setup lang="ts">
import { Bell, ChatLineRound, Goods, Reading, Right, Search } from "@element-plus/icons-vue";

const actions = [
  { title: "出售物品", description: "发布闲置物品的价格、成色、图片和面交信息。", to: "/publish/listing", icon: Goods, tone: "teal" },
  { title: "发布求购", description: "填写预算与具体需求，让有合适物品的同学回应。", to: "/publish/wanted", icon: Search, tone: "amber" },
  { title: "分享免费原创", description: "上传本人原创或已获授权的课程笔记、复习资料和学习模板，始终免费。", to: "/learning/free/publish", icon: Reading, tone: "rose", featured: true },
  { title: "发起讨论", description: "到校园广场提问、交流或分享经验。", to: "/publish/post", icon: ChatLineRound, tone: "violet" },
  { title: "分享校园信息", description: "发布活动、提醒和有时效性的校园生活信息。", to: "/publish/post?kind=info", icon: Bell, tone: "blue" },
] as const;
</script>

<style scoped>
.publish-hub{max-width:980px;margin:0 auto;display:flex;flex-direction:column;gap:20px}.publish-head{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:end;gap:24px;padding:22px 24px;border:1px solid var(--cpu-border-soft);border-radius:18px;background:linear-gradient(125deg,var(--cpu-card),var(--cpu-primary-soft))}.publish-head span{color:var(--cpu-primary);font-size:11px;font-weight:700;letter-spacing:.16em}.publish-head h1{margin:7px 0 5px;font-size:30px}.publish-head p{margin:0;color:var(--cpu-text-secondary);font-size:14px}.publish-head ol{display:flex;gap:8px;margin:0;padding:0;list-style:none}.publish-head li{display:flex;align-items:center;gap:5px;color:var(--cpu-text-secondary);font-size:11px;white-space:nowrap}.publish-head li b{display:grid;place-items:center;width:24px;height:24px;border-radius:50%;color:#fff;background:var(--cpu-primary);font-size:10px}.publish-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.publish-card{display:flex;align-items:center;gap:15px;padding:20px;color:var(--cpu-text);text-decoration:none;transition:.18s}.publish-card.featured{grid-column:1/-1;border-color:rgba(190,24,93,.2);background:linear-gradient(105deg,var(--cpu-card),color-mix(in srgb,#fdf2f8 62%,var(--cpu-card)))}.publish-card:hover{transform:translateY(-2px);border-color:color-mix(in srgb,var(--cpu-primary) 40%,var(--cpu-border-soft));box-shadow:0 12px 28px rgba(15,23,42,.08)}.card-icon{display:grid;place-items:center;flex:0 0 52px;width:52px;height:52px;border-radius:16px;font-size:25px}.card-icon.teal{color:var(--cpu-primary);background:var(--cpu-primary-soft)}.card-icon.amber{color:#b45309;background:#fef3c7}.card-icon.rose{color:#be185d;background:#fce7f3}.card-icon.violet{color:#6d5ce7;background:#ede9fe}.card-icon.blue{color:#2563eb;background:#dbeafe}.publish-card>div{min-width:0;flex:1}.publish-card h2{margin:0 0 5px;font-size:17px}.publish-card p{margin:0;color:var(--cpu-text-secondary);font-size:12px;line-height:1.55}.arrow{color:var(--cpu-text-muted)}@media(max-width:760px){.publish-head{grid-template-columns:1fr;padding:18px}.publish-head ol{overflow-x:auto}.publish-head h1{font-size:25px}.publish-grid{grid-template-columns:1fr}.publish-card,.publish-card.featured{grid-column:auto;padding:16px}.card-icon{flex-basis:46px;width:46px;height:46px;border-radius:14px;font-size:22px}}
</style>
