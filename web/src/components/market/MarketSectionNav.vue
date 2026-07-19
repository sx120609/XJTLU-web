<template>
  <nav class="market-section-nav" aria-label="市集频道">
    <router-link to="/market?sort=popular">推荐</router-link>
    <router-link to="/market?sort=new">闲置</router-link>
    <router-link to="/market/wanted">求购</router-link>
    <router-link to="/market?category=books">学习好物</router-link>
    <router-link v-if="site.features.promotion" to="/market/merchants">合作商户</router-link>
    <router-link v-if="site.features.promotion" to="/market/promotions">推广服务</router-link>
    <router-link to="/services">校园服务</router-link>
  </nav>
</template>

<script setup lang="ts">
import { useSiteStore } from "@/stores/site";

const site = useSiteStore();
</script>

<style scoped>
.market-section-nav{display:flex;gap:8px;padding:7px;border:1px solid var(--cpu-border-soft);border-radius:13px;background:var(--cpu-card)}.market-section-nav a{min-width:0;flex:1;padding:9px 7px;border-radius:9px;color:var(--cpu-text-secondary);font-size:12px;font-weight:600;text-align:center;text-decoration:none}.market-section-nav a:hover,.market-section-nav a.router-link-exact-active{color:var(--cpu-primary);background:var(--cpu-primary-soft)}@media(max-width:820px){.market-section-nav{overflow-x:auto}.market-section-nav a{flex:0 0 88px}}
</style>
