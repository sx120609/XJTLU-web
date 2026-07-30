<template>
  <el-drawer
    v-model="visible"
    direction="btt"
    size="auto"
    class="publish-action-drawer"
    title="发布到靠浦"
  >
    <p class="sheet-intro">选择要发布的内容，交易信息和校园讨论会进入各自的流程。</p>
    <div class="publish-action-grid">
      <button v-for="action in actions" :key="action.to" type="button" @click="open(action.to)">
        <span class="action-icon" :class="action.tone"><el-icon><component :is="action.icon" /></el-icon></span>
        <span class="action-copy">
          <b>{{ action.title }}</b>
          <small>{{ action.description }}</small>
        </span>
      </button>
    </div>
    <div class="sheet-safety">商品交易仅提供校内撮合，请在公共区域当面验货，款项由双方直接结算。</div>
  </el-drawer>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { Bell, ChatLineRound, Goods, Reading, Search } from "@element-plus/icons-vue";
import { useAuthStore } from "@/stores/auth";

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ (event: "update:modelValue", value: boolean): void }>();
const router = useRouter();
const auth = useAuthStore();

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit("update:modelValue", value),
});

const actions = [
  { title: "出售物品", description: "发布校内闲置，和同学当面交易", to: "/publish/listing", icon: Goods, tone: "teal" },
  { title: "发布求购", description: "说明预算与需求，等待卖方响应", to: "/publish/wanted", icon: Search, tone: "amber" },
  { title: "学习资料专区", description: "进入专区后发布或浏览学习资料", to: "/learning/materials", icon: Reading, tone: "rose" },
  { title: "发起讨论", description: "在校园广场提问或分享观点", to: "/publish/post", icon: ChatLineRound, tone: "violet" },
  { title: "分享校园信息", description: "发布活动、提醒与校园生活信息", to: "/publish/post?kind=info", icon: Bell, tone: "blue" },
] as const;

async function open(to: string) {
  visible.value = false;
  if (!auth.isLoggedIn) {
    await router.push({ name: "login", query: { redirect: to } });
    return;
  }
  await router.push(to);
}
</script>

<style scoped>
.sheet-intro{margin:-4px 0 16px;color:var(--cpu-text-secondary);font-size:13px;line-height:1.6}.publish-action-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.publish-action-grid button{display:flex;align-items:center;gap:13px;min-width:0;padding:15px;border:1px solid var(--cpu-border-soft);border-radius:14px;color:var(--cpu-text);background:var(--cpu-card);text-align:left;cursor:pointer;transition:.18s}.publish-action-grid button:hover{transform:translateY(-2px);border-color:color-mix(in srgb,var(--cpu-primary) 42%,var(--cpu-border-soft));box-shadow:0 10px 24px rgba(15,23,42,.08)}.action-icon{display:grid;place-items:center;flex:0 0 42px;width:42px;height:42px;border-radius:13px;font-size:21px}.action-icon.teal{color:var(--cpu-primary);background:var(--cpu-primary-soft)}.action-icon.amber{color:#b45309;background:#fef3c7}.action-icon.violet{color:#6d5ce7;background:#ede9fe}.action-icon.blue{color:#2563eb;background:#dbeafe}.action-copy{display:flex;min-width:0;flex-direction:column;gap:4px}.action-copy b{font-size:14px}.action-copy small{color:var(--cpu-text-secondary);font-size:11px;line-height:1.45}.sheet-safety{margin-top:14px;padding:10px 12px;border-radius:10px;color:var(--cpu-text-secondary);background:var(--cpu-surface-soft);font-size:11px;line-height:1.55}@media(max-width:560px){.publish-action-grid{grid-template-columns:1fr}.publish-action-grid button{padding:13px}.sheet-intro{font-size:12px}}
.action-icon.rose{color:#be185d;background:#fce7f3}
</style>

<style>
.publish-action-drawer{max-width:760px!important;margin:0 auto!important;border-radius:20px 20px 0 0!important}.publish-action-drawer .el-drawer__header{margin-bottom:8px}.publish-action-drawer .el-drawer__body{padding-top:8px;padding-bottom:calc(18px + env(safe-area-inset-bottom))}
</style>
