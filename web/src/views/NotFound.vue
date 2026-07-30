<template>
  <div class="not-found">
    <div class="content">
      <div class="logo">404</div>
      <p>{{ isEnglish ? "This page could not be found." : "页面走失了。也许它正在某个药学楼的电梯里..." }}</p>
      <el-button type="primary" @click="$router.push('/home')">{{ isEnglish ? "Back to Home" : "返回首页" }}</el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useLocale } from "@/i18n";

const { isEnglish } = useLocale();
</script>

<style scoped>
.not-found {
  min-height: 100vh;
  min-height: 100dvh;
  display: grid;
  place-items: center;
  background: var(--cpu-bg);
  padding: 24px;
}
.content { text-align: center; }
.logo {
  font-size: 96px;
  font-weight: 800;
  color: #1d4d8a;
  letter-spacing: 4px;
  margin-bottom: 12px;
}
.content p {
  color: var(--cpu-text-secondary);
  margin-bottom: 16px;
}
</style>
