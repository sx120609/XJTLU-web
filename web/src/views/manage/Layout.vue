<template>
  <div class="manage-shell">
    <aside class="manage-sidebar" :class="{ open: mobileOpen }">
      <div class="manage-brand">
        <div class="brand-mark">K</div>
        <div><b>管理控制台</b><span>Independent workspace</span></div>
      </div>
      <nav>
        <router-link v-for="item in visibleItems" :key="item.to" :to="item.to" @click="mobileOpen = false">
          <span class="nav-icon">{{ item.icon }}</span><span>{{ item.label }}</span>
        </router-link>
      </nav>
      <div class="sidebar-foot">
        <span>管理身份与个人身份已隔离</span>
        <router-link to="/home">打开用户站点 ↗</router-link>
      </div>
    </aside>
    <div v-if="mobileOpen" class="sidebar-mask" @click="mobileOpen = false" />

    <section class="manage-workspace">
      <header class="manage-topbar">
        <button class="menu-button" type="button" @click="mobileOpen = true">☰</button>
        <div class="route-title">
          <span>{{ currentItem?.label || "管理控制台" }}</span>
          <small>{{ management.principal?.accountType === "boss" ? "BOSS 全权限" : "管理员权限工作区" }}</small>
        </div>
        <div class="account-block">
          <div><b>{{ management.principal?.displayName }}</b><span>@{{ management.principal?.username }}</span></div>
          <el-tag :type="management.isBoss ? 'danger' : 'primary'" size="small">{{ management.isBoss ? "BOSS" : "ADMIN" }}</el-tag>
          <el-dropdown @command="handleAccountCommand">
            <el-button text>会话 ▾</el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="logout">退出当前会话</el-dropdown-item>
                <el-dropdown-item command="logout-all" divided>退出全部设备</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </header>
      <main class="manage-content"><router-view /></main>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessageBox } from "element-plus";
import { useManagementStore } from "@/stores/management";

const route = useRoute();
const router = useRouter();
const management = useManagementStore();
const mobileOpen = ref(false);
const items = [
  { to: "/manage/dashboard", label: "工作台", icon: "◫", permission: "dashboard.read" },
  { to: "/manage/accounts", label: "管理员与权限", icon: "◆", boss: true },
  { to: "/manage/forum", label: "帖子审核", icon: "▤", any: ["forum.review", "forum.moderate"] },
  { to: "/manage/market-reviews", label: "实物商品审核", icon: "▣", permission: "market.review" },
  { to: "/manage/learning-reviews", label: "学习资料审核", icon: "▧", permission: "learning.review" },
  { to: "/manage/users", label: "个人用户治理", icon: "◎", any: ["users.read", "users.moderate", "users.sensitive"] },
  { to: "/manage/audit", label: "审计日志", icon: "≣", permission: "audit.read" },
  { to: "/manage/operations", label: "内容与系统", icon: "⚙", any: ["content.manage", "system.manage"] },
];
const visibleItems = computed(() => items.filter((item) => {
  if (item.boss) return management.isBoss;
  if (item.permission) return management.hasPermission(item.permission);
  return item.any?.some((code) => management.hasPermission(code));
}));
const currentItem = computed(() => items.find((item) => route.path.startsWith(item.to)));

async function handleAccountCommand(command: string) {
  if (command === "logout-all") {
    await ElMessageBox.confirm("将撤销此管理账号在所有设备上的会话，是否继续？", "退出全部设备", { type: "warning" });
  }
  await management.logout(command === "logout-all");
  await router.replace("/manage/login");
}
</script>

<style scoped>
.manage-shell { min-height: 100vh; display: flex; background: #f4f6fb; color: #172033; }
.manage-sidebar { width: 244px; position: fixed; inset: 0 auto 0 0; z-index: 40; display: flex; flex-direction: column; padding: 20px 14px; box-sizing: border-box; color: #dbe4ff; background: #10162a; }
.manage-brand { display: flex; gap: 11px; align-items: center; padding: 4px 8px 24px; }
.brand-mark { width: 38px; height: 38px; display: grid; place-items: center; border-radius: 11px; background: #6d5ce7; color: white; font-weight: 800; }
.manage-brand div:last-child { display: grid; gap: 2px; }.manage-brand b { font-size: 15px; }.manage-brand span { color: #7280a8; font-size: 10px; }
nav { display: grid; gap: 5px; }
nav a { display: flex; gap: 11px; align-items: center; padding: 11px 13px; border-radius: 10px; color: #9da9c8; text-decoration: none; font-size: 14px; transition: .15s ease; }
nav a:hover { color: white; background: rgba(255,255,255,.06); } nav a.router-link-active { color: white; background: #6d5ce7; box-shadow: 0 8px 20px rgba(109,92,231,.28); }
.nav-icon { width: 19px; text-align: center; font-size: 16px; }
.sidebar-foot { margin-top: auto; display: grid; gap: 8px; padding: 14px 9px 3px; color: #667392; font-size: 11px; line-height: 1.5; border-top: 1px solid rgba(255,255,255,.08); }.sidebar-foot a { color: #a8b4d4; text-decoration: none; }
.manage-workspace { width: calc(100% - 244px); margin-left: 244px; }
.manage-topbar { height: 70px; position: sticky; top: 0; z-index: 30; display: flex; align-items: center; justify-content: space-between; padding: 0 26px; background: rgba(255,255,255,.94); border-bottom: 1px solid #e4e8f0; backdrop-filter: blur(12px); }
.route-title { display: grid; gap: 2px; }.route-title > span { font-weight: 750; font-size: 17px; }.route-title small { color: #94a3b8; font-size: 11px; }
.account-block { display: flex; align-items: center; gap: 10px; }.account-block > div { display: grid; text-align: right; }.account-block b { font-size: 13px; }.account-block span { color: #94a3b8; font-size: 11px; }
.manage-content { padding: 24px 26px 48px; }
.menu-button { display: none; border: 0; background: transparent; font-size: 21px; color: #334155; }
.sidebar-mask { display: none; }
@media (max-width: 820px) {
  .manage-sidebar { transform: translateX(-100%); transition: transform .2s ease; }.manage-sidebar.open { transform: none; }.sidebar-mask { display: block; position: fixed; inset: 0; z-index: 35; background: rgba(15,23,42,.45); }.manage-workspace { width: 100%; margin-left: 0; }.menu-button { display: block; }.manage-topbar { padding: 0 14px; }.account-block > div { display: none; }.manage-content { padding: 16px 14px 36px; }
}
</style>
