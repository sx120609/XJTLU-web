export const STUDENT_MARKET_PAYMENT_ENABLED = false;

function booleanSetting(value: string | undefined, fallback: boolean) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return fallback;
  return ["1", "true", "yes", "on"].includes(normalized);
}

function integerSetting(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

/**
 * Paid learning materials are enabled by default outside production so the
 * complete workflow can be developed and verified. Production must opt in
 * explicitly after migrations, creator review and payment-proof UAT pass.
 */
export const PAID_LEARNING_MATERIALS_ENABLED = booleanSetting(
  process.env.PAID_LEARNING_MATERIALS_ENABLED,
  process.env.NODE_ENV !== "production",
);

export const LEARNING_MATERIAL_MIN_PRICE_CENTS = integerSetting(
  process.env.LEARNING_MATERIAL_MIN_PRICE_CENTS,
  100,
  1,
  100_000,
);

export const LEARNING_MATERIAL_MAX_PRICE_CENTS = integerSetting(
  process.env.LEARNING_MATERIAL_MAX_PRICE_CENTS,
  100_000,
  LEARNING_MATERIAL_MIN_PRICE_CENTS,
  10_000_000,
);

export const LEARNING_PAYMENT_DUE_MS = integerSetting(
  process.env.LEARNING_PAYMENT_DUE_MS,
  24 * 60 * 60 * 1000,
  15 * 60 * 1000,
  7 * 24 * 60 * 60 * 1000,
);

export const LEARNING_SELLER_CONFIRM_DUE_MS = integerSetting(
  process.env.LEARNING_SELLER_CONFIRM_DUE_MS,
  24 * 60 * 60 * 1000,
  15 * 60 * 1000,
  7 * 24 * 60 * 60 * 1000,
);

export const LEARNING_COMPLETION_DUE_MS = integerSetting(
  process.env.LEARNING_COMPLETION_DUE_MS,
  72 * 60 * 60 * 1000,
  60 * 60 * 1000,
  30 * 24 * 60 * 60 * 1000,
);

export const LEARNING_REVIEW_SLA_MS = integerSetting(
  process.env.LEARNING_REVIEW_SLA_MS,
  24 * 60 * 60 * 1000,
  60 * 60 * 1000,
  7 * 24 * 60 * 60 * 1000,
);

export const LEARNING_ISSUE_SLA_MS = integerSetting(
  process.env.LEARNING_ISSUE_SLA_MS,
  24 * 60 * 60 * 1000,
  60 * 60 * 1000,
  7 * 24 * 60 * 60 * 1000,
);

export const DIRECT_TRADE_NOTICE = "靠浦只提供校内交易撮合，不代收学生商品款。请当面验货，并直接向卖家付款。";
export const MARKET_PAYMENT_DISABLED_MESSAGE = "靠浦不经手学生商品款，请与卖家约定校内见面交易并直接付款";
export const PAID_MATERIAL_DISABLED_MESSAGE = "付费学习资料当前处于上线前灰度阶段，请稍后再试";

export function directTradeOrderAmounts(amountCents: number) {
  const amount = Math.max(0, Math.round(amountCents));
  return {
    amountCents: amount,
    commissionBps: 0,
    platformFeeCents: 0,
    sellerAmountCents: amount,
  };
}

export function isAllowedLearningMaterialPrice(priceCents: number) {
  return Number.isInteger(priceCents)
    && priceCents >= LEARNING_MATERIAL_MIN_PRICE_CENTS
    && priceCents <= LEARNING_MATERIAL_MAX_PRICE_CENTS;
}
