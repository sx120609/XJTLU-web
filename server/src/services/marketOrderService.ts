import crypto from "node:crypto";
import { amountCentsToMoney } from "./epay";
import { openMarketSensitive } from "./marketSensitiveService";

export function nextMarketTradeNo(userId: number) {
  return `MK${Date.now()}U${userId}${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

export function serializeMarketOrder(order: any, viewerId?: number, viewerRole?: string) {
  const { digitalDeliveryEncrypted, meetupReminderSentAt: _meetupReminderSentAt, ...safeOrder } = order;
  const canSeeDigitalDelivery = Boolean(
    digitalDeliveryEncrypted
    && ["paid", "delivering", "completed", "refund_pending", "disputed"].includes(order.status)
    && (viewerId === order.buyerId || viewerId === order.sellerId || ["admin", "mod"].includes(viewerRole || "")),
  );
  let digitalDelivery: string | null = null;
  if (canSeeDigitalDelivery) {
    try {
      digitalDelivery = openMarketSensitive(digitalDeliveryEncrypted);
    } catch {
      digitalDelivery = null;
    }
  }
  return {
    ...safeOrder,
    amount: amountCentsToMoney(order.amountCents),
    platformFee: amountCentsToMoney(order.platformFeeCents),
    sellerAmount: amountCentsToMoney(order.sellerAmountCents),
    digitalDelivery,
  };
}
