<template>
  <el-dialog v-model="visible" title="推广服务付款确认" width="min(92vw, 560px)" destroy-on-close append-to-body @closed="emit('closed')">
    <div v-if="order" class="payment-flow">
      <el-alert
        v-if="order.status === 'waitlisted'"
        type="warning"
        :closable="false"
        show-icon
        title="目前推广服务已满"
        description="申请已进入候补队列。位置空出后系统会发送站内消息，再请你付款；不会自动扣款或自动启用。"
      />
      <template v-else>
        <div class="payment-main">
          <img :src="order.paymentQrUrl || '/promotion-payment-placeholder.svg'" alt="推广服务收款码占位图" />
          <div class="payment-copy">
            <span>应付金额</span>
            <strong>¥{{ order.amount }}</strong>
            <p>扫码付款时，请务必在付款备注中填写下面的四位秘钥。</p>
            <div class="secret" aria-label="付款备注秘钥">{{ order.paymentCode }}</div>
            <small v-if="order.paymentExpiresAt && !order.paymentSubmittedAt">付款位置保留至 {{ formatTime(order.paymentExpiresAt) }}</small>
          </div>
        </div>
        <el-alert type="info" :closable="false" show-icon title="当前为人工收款核验" description="扫码不会自动启用推广。付款后在下方再次输入同一四位秘钥，管理员还会核对实收金额、收款流水和付款备注。" />
        <div v-if="order.paymentSubmittedAt" class="submitted-state">
          <el-tag type="success">已提交付款确认</el-tag>
          <span>{{ formatTime(order.paymentSubmittedAt) }} · 等待管理员人工核验</span>
        </div>
        <el-form v-else label-position="top" @submit.prevent="submitClaim">
          <el-form-item label="订单页确认秘钥（必填）">
            <el-input v-model="claimCode" maxlength="4" inputmode="numeric" placeholder="请输入付款备注中的 4 位数字" @input="normalizeCode" />
          </el-form-item>
        </el-form>
      </template>
    </div>
    <template #footer>
      <el-button @click="visible = false">{{ order?.paymentSubmittedAt || order?.status === 'waitlisted' ? '关闭' : '稍后付款' }}</el-button>
      <el-button v-if="order?.status === 'pending' && !order.paymentSubmittedAt" type="primary" :loading="submitting" :disabled="claimCode.length !== 4" @click="submitClaim">我已付款并确认秘钥</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { marketApi, type PromotionOrder } from "@/api/market";

const props = defineProps<{ modelValue: boolean; order: PromotionOrder | null }>();
const emit = defineEmits<{ (event: "update:modelValue", value: boolean): void; (event: "submitted", order: PromotionOrder): void; (event: "closed"): void }>();
const claimCode = ref("");
const submitting = ref(false);
const visible = computed({ get: () => props.modelValue, set: (value) => emit("update:modelValue", value) });

watch(() => props.order?.id, () => { claimCode.value = ""; });

function normalizeCode(value: string) {
  claimCode.value = String(value || "").replace(/\D/g, "").slice(0, 4);
}

async function submitClaim() {
  if (!props.order || claimCode.value.length !== 4 || submitting.value) return;
  submitting.value = true;
  try {
    const next = await marketApi.submitPromotionPaymentClaim(props.order.id, claimCode.value);
    ElMessage.success("付款确认已提交，请等待管理员人工核验");
    emit("submitted", next);
  } finally {
    submitting.value = false;
  }
}

function formatTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}
</script>

<style scoped>
.payment-flow{display:flex;flex-direction:column;gap:16px}.payment-main{display:grid;grid-template-columns:190px minmax(0,1fr);align-items:center;gap:22px}.payment-main img{display:block;width:190px;height:190px;border:1px solid var(--cpu-border-soft);border-radius:14px;background:#fff;object-fit:contain}.payment-copy{display:flex;min-width:0;flex-direction:column;gap:7px}.payment-copy>span,.payment-copy small{color:var(--cpu-text-secondary);font-size:12px}.payment-copy strong{color:#ef4444;font-size:30px}.payment-copy p{margin:2px 0;color:var(--cpu-text-secondary);font-size:12px;line-height:1.65}.secret{padding:10px 14px;border:1px dashed var(--cpu-primary);border-radius:10px;color:var(--cpu-primary);background:var(--cpu-primary-soft);font-size:27px;font-weight:800;letter-spacing:.28em;text-align:center}.submitted-state{display:flex;align-items:center;gap:10px;padding:12px;border-radius:10px;background:var(--cpu-surface-soft)}.submitted-state span{color:var(--cpu-text-secondary);font-size:12px}@media(max-width:560px){.payment-main{grid-template-columns:1fr;text-align:center}.payment-main img{width:168px;height:168px;margin:0 auto}.payment-copy strong{font-size:26px}}
</style>
