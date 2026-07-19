<template>
  <span class="promotion-label" :class="`is-${kind}`">{{ label }}</span>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ label: string; kind?: "pin" | "urgent" | "home" | "merchant" }>(), { kind: "home" });
</script>

<style scoped>
.promotion-label{display:inline-flex;align-items:center;justify-content:center;padding:3px 7px;border:1px solid currentColor;border-radius:6px;font-size:9px;font-weight:800;line-height:1;letter-spacing:.04em;white-space:nowrap}.is-pin{color:#9a3412;background:#fff7ed}.is-urgent{color:#b91c1c;background:#fef2f2}.is-home{color:#7e22ce;background:#faf5ff}.is-merchant{color:#0f766e;background:#ecfdf5}
</style>
