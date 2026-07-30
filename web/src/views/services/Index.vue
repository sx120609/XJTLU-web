<template>
  <div class="services-page">
    <header class="page-head">
      <span>CAMPUS TOOLS</span>
      <h1>{{ t("tools.title") }}</h1>
      <p>{{ t("tools.subtitle") }}</p>
    </header>

    <section class="entry-card cpu-card" aria-labelledby="campus-entry-title">
      <div class="entry-head">
        <div>
          <span>CAMPUS RESOURCES</span>
          <h2 id="campus-entry-title">{{ t("tools.resources") }}</h2>
        </div>
      </div>
      <div class="entry-grid">
        <router-link v-for="entry in serviceEntries" :key="entry.to" :to="entry.to" class="service-entry">
          <span class="entry-icon" aria-hidden="true">{{ entry.icon }}</span>
          <span class="entry-copy"><strong>{{ entry.title }}</strong><small>{{ entry.description }}</small></span>
          <span class="entry-arrow" aria-hidden="true">→</span>
        </router-link>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useLocale } from "@/i18n";

const { t } = useLocale();
const serviceEntries = computed(() => [
  { to: "/academic", icon: "🎓", title: t("tools.academic"), description: t("tools.academicDesc") },
  { to: "/services/tools", icon: "🧰", title: t("tools.toolbox"), description: t("tools.toolboxDesc") },
  { to: "/services/resources", icon: "🧭", title: t("tools.resources"), description: t("tools.resourcesDesc") },
] as const);
</script>

<style scoped>
.services-page{display:flex;flex-direction:column;gap:20px}.page-head{padding:8px 2px}.page-head>span,.entry-head span{color:var(--cpu-primary);font-size:10px;font-weight:800;letter-spacing:.16em}.page-head h1{margin:7px 0 5px;font-size:29px}.page-head p{margin:0;color:var(--cpu-text-secondary);font-size:13px}.entry-card{padding:28px;border-radius:18px}.entry-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:20px}.entry-head h2{margin:6px 0 0;font-size:24px}.entry-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.service-entry{display:flex;min-width:0;align-items:center;gap:15px;padding:22px;border:1px solid var(--cpu-border-soft);border-radius:15px;color:var(--cpu-text);background:var(--cpu-card);text-decoration:none;transition:.18s}.service-entry:hover{transform:translateY(-2px);border-color:color-mix(in srgb,var(--cpu-primary) 48%,var(--cpu-border-soft));box-shadow:0 10px 24px rgba(15,23,42,.07)}.entry-icon{display:grid;width:48px;height:48px;flex:0 0 auto;place-items:center;border-radius:13px;background:var(--cpu-primary-soft);font-size:27px}.entry-copy{display:flex;min-width:0;flex:1;flex-direction:column;gap:5px}.entry-copy strong{font-size:16px}.entry-copy small{overflow:hidden;color:var(--cpu-text-secondary);font-size:11px;text-overflow:ellipsis;white-space:nowrap}.entry-arrow{color:var(--cpu-text-muted);font-size:18px}@media(max-width:800px){.entry-grid{grid-template-columns:1fr}.entry-card{padding:18px}.service-entry{padding:17px}}@media(max-width:520px){.services-page{gap:14px}.page-head h1{font-size:25px}.entry-card{padding:15px;border-radius:14px}.entry-head{margin-bottom:14px}.entry-head h2{font-size:21px}.service-entry{gap:12px;padding:15px}.entry-icon{width:44px;height:44px;font-size:24px}}
</style>
