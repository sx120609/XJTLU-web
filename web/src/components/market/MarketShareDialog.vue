<template>
  <el-dialog :model-value="modelValue" title="分享给同学" width="420px" @update:model-value="$emit('update:modelValue', $event)">
    <div class="share-dialog">
      <img v-if="qrCode" :src="qrCode" alt="分享二维码" />
      <div v-else class="qr-placeholder">正在生成二维码…</div>
      <strong>{{ title }}</strong>
      <p>{{ summary }}</p>
      <el-input :model-value="shareUrl" readonly />
    </div>
    <template #footer>
      <el-button @click="$emit('update:modelValue', false)">关闭</el-button>
      <el-button v-if="canNativeShare" @click="nativeShare">系统分享</el-button>
      <el-button type="primary" @click="copyLink">复制链接</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import QRCode from "qrcode";

const props = defineProps<{ modelValue: boolean; title: string; summary?: string; url?: string }>();
const emit = defineEmits<{ "update:modelValue": [value: boolean] }>();
const qrCode = ref("");
const shareUrl = computed(() => props.url || (typeof location === "undefined" ? "" : location.href));
const canNativeShare = computed(() => typeof navigator !== "undefined" && typeof navigator.share === "function");

watch(() => [props.modelValue, shareUrl.value] as const, async ([open]) => {
  if (!open || !shareUrl.value) return;
  qrCode.value = await QRCode.toDataURL(shareUrl.value, { width: 240, margin: 1, color: { dark: "#4338ca", light: "#ffffff" } });
}, { immediate: true });

async function copyLink() {
  await navigator.clipboard.writeText(shareUrl.value);
  ElMessage.success("分享链接已复制");
}

async function nativeShare() {
  try {
    await navigator.share({ title: props.title, text: props.summary || props.title, url: shareUrl.value });
    emit("update:modelValue", false);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return;
    ElMessage.warning("系统分享未完成，可复制链接发送给同学");
  }
}
</script>

<style scoped>
.share-dialog{display:flex;align-items:center;flex-direction:column;gap:10px;text-align:center}.share-dialog img,.qr-placeholder{width:210px;height:210px;border:1px solid var(--cpu-border-soft);border-radius:14px}.qr-placeholder{display:grid;place-items:center;color:var(--cpu-text-secondary);background:var(--cpu-surface-soft);font-size:11px}.share-dialog strong{font-size:16px}.share-dialog p{margin:0;color:var(--cpu-text-secondary);font-size:11px;line-height:1.6}
</style>
