export const STUDENT_MARKET_PAYMENT_ENABLED = false;
export const PAID_LEARNING_MATERIALS_ENABLED = false;

export const DIRECT_TRADE_NOTICE = "靠浦只提供校内交易撮合，不代收学生商品款。请当面验货，并直接向卖家付款。";
export const MARKET_PAYMENT_DISABLED_MESSAGE = "靠浦不经手学生商品款，请与卖家约定校内见面交易并直接付款";
export const PAID_MATERIAL_DISABLED_MESSAGE = "第一阶段仅支持经过审核的免费原创学习内容，不支持付费数字资料";

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
  return priceCents === 0;
}
