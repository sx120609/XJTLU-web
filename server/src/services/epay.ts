import crypto from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { acquireEpayConfigLock } from "./epayConfigLockService";
import { getSiteOrigin } from "./siteSettings";

const EPAY_CONFIG_ID = 1;
const PAY_TYPES = ["alipay", "wxpay", "qqpay", "bank", "jdpay"] as const;
export type EpayPayType = typeof PAY_TYPES[number];

export type EpayConfigInput = {
  enabled?: boolean;
  gatewayUrl?: string;
  pid?: string;
  merchantKey?: string;
  clearMerchantKey?: boolean;
  signType?: string;
  defaultType?: string;
  enabledTypes?: string[];
};

export type EpayOrderInput = {
  outTradeNo: string;
  name: string;
  money: string;
  type?: string;
  notifyUrl: string;
  returnUrl: string;
  clientIp?: string;
  device?: string;
  param?: string;
};

type EpayClient = Prisma.TransactionClient | typeof prisma;
type EpayStoredConfig = Awaited<ReturnType<typeof getStoredEpayConfig>>;

function maskSecret(secret: string) {
  if (!secret) return "";
  if (secret.length <= 8) return `${secret.slice(0, 2)}****${secret.slice(-2)}`;
  return `${secret.slice(0, 4)}****${secret.slice(-4)}`;
}

function normalizeGatewayUrl(url: string) {
  return url.trim().replace(/\/+$/, "");
}

export function amountCentsToMoney(amountCents: number) {
  return (amountCents / 100).toFixed(2);
}

export function moneyToAmountCents(value: string | number) {
  const raw = typeof value === "number"
    ? (Number.isFinite(value) ? String(value) : "")
    : value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) {
    throw new Error("支付金额不正确");
  }
  const [yuan, fraction = ""] = raw.split(".");
  const amount = Number(yuan) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error("支付金额不正确");
  }
  return amount;
}

function normalizeMoney(value: string | number) {
  return amountCentsToMoney(moneyToAmountCents(value));
}

function normalizeAbsoluteUrl(url: string, message: string) {
  const trimmed = url.trim();
  try {
    const parsed = new URL(trimmed);
    if (
      parsed.protocol !== "https:"
      || parsed.username
      || parsed.password
    ) {
      throw new Error(message);
    }
    parsed.hash = "";
    const normalized = parsed.toString();
    return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
  } catch {
    throw new Error(message);
  }
}

function submitUrlFromGateway(gatewayUrl: string) {
  const normalized = normalizeGatewayUrl(gatewayUrl);
  if (!normalized) return "";
  if (/\.php(?:\?|$)/i.test(normalized)) return normalized;
  return `${normalized}/submit.php`;
}

function normalizePayTypes(input: unknown, fallback: EpayPayType[] = ["alipay", "wxpay"]): EpayPayType[] {
  let raw = input;
  if (typeof input === "string") {
    try {
      raw = JSON.parse(input);
    } catch {
      raw = input.split(",");
    }
  }
  if (!Array.isArray(raw)) raw = fallback;
  const normalized = Array.from(new Set(
    (raw as unknown[])
      .map((item: unknown) => String(item).trim())
      .filter((item: string): item is EpayPayType => (PAY_TYPES as readonly string[]).includes(item))
  ));
  return normalized.length ? normalized : fallback;
}

function normalizeDefaultType(input: string, enabledTypes: EpayPayType[]) {
  const value = String(input || "").trim();
  return enabledTypes.includes(value as EpayPayType) ? value : enabledTypes[0] || "alipay";
}

async function getStoredEpayConfig(client: EpayClient = prisma) {
  return client.epayConfig.upsert({
    where: { id: EPAY_CONFIG_ID },
    update: {},
    create: { id: EPAY_CONFIG_ID },
  });
}

export function resolvePaymentOrigin(_requestOrigin = "") {
  return getSiteOrigin();
}

export function buildEpayCallbackUrls(origin: string) {
  const normalized = origin.trim().replace(/\/+$/, "");
  return {
    notifyUrl: normalized ? `${normalized}/api/payments/epay/notify` : "",
    returnUrl: normalized ? `${normalized}/api/payments/epay/return` : "",
  };
}

export async function getEpayConfig(requestOrigin = "") {
  const config = await getStoredEpayConfig();
  const enabledTypes = normalizePayTypes(config.enabledTypes);
  const origin = resolvePaymentOrigin(requestOrigin);
  const callbacks = buildEpayCallbackUrls(origin);
  return {
    id: config.id,
    enabled: config.enabled,
    gatewayUrl: config.gatewayUrl,
    submitUrl: submitUrlFromGateway(config.gatewayUrl),
    pid: config.pid,
    hasMerchantKey: Boolean(config.merchantKey),
    merchantKeyMasked: maskSecret(config.merchantKey),
    signType: config.signType,
    defaultType: normalizeDefaultType(config.defaultType, enabledTypes),
    enabledTypes,
    notifyUrl: callbacks.notifyUrl,
    returnUrl: callbacks.returnUrl,
    siteOrigin: origin,
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
  };
}

export async function updateEpayConfig(input: EpayConfigInput, requestOrigin = "") {
  await getStoredEpayConfig();
  await prisma.$transaction(async (tx) => {
    await acquireEpayConfigLock(tx);
    await tx.$queryRaw`
      SELECT "id"
      FROM "EpayConfig"
      WHERE "id" = ${EPAY_CONFIG_ID}
      FOR UPDATE
    `;
    const current = await getStoredEpayConfig(tx);
    const nextEnabledTypes = input.enabledTypes !== undefined
      ? normalizePayTypes(input.enabledTypes)
      : normalizePayTypes(current.enabledTypes);
    const nextGatewayUrl = input.gatewayUrl !== undefined
      ? (
        input.gatewayUrl.trim()
          ? normalizeAbsoluteUrl(
            input.gatewayUrl,
            "易支付网关地址必须是无凭据的 HTTPS 地址",
          )
          : ""
      )
      : current.gatewayUrl;
    const nextPid = input.pid !== undefined
      ? input.pid.trim()
      : current.pid;
    const nextMerchantKey = input.clearMerchantKey
      ? ""
      : (
        input.merchantKey !== undefined
          ? input.merchantKey.trim()
          : current.merchantKey
      );
    const nextSignType = input.signType !== undefined
      ? input.signType.trim().toUpperCase()
      : current.signType;
    const nextDefaultType = input.defaultType !== undefined
      ? input.defaultType.trim()
      : current.defaultType;
    const nextEnabled = input.enabled ?? current.enabled;

    if (nextSignType !== "MD5") {
      throw new Error("当前仅支持 MD5 签名");
    }
    if (!nextEnabledTypes.includes(nextDefaultType as EpayPayType)) {
      throw new Error("默认支付方式必须包含在已启用方式中");
    }
    if (
      nextEnabled
      && (
        !nextGatewayUrl
        || !nextPid
        || !nextMerchantKey
        || !resolvePaymentOrigin(requestOrigin)
      )
    ) {
      throw new Error("启用易支付前请完整配置 HTTPS 网关、商户信息和网站域名");
    }

    const merchantChanged = (
      nextGatewayUrl !== current.gatewayUrl
      || nextPid !== current.pid
      || nextMerchantKey !== current.merchantKey
      || nextSignType !== current.signType
    );
    if (merchantChanged) {
      const now = new Date();
      const legacyCutoff = new Date(now.getTime() - 3 * 60 * 60 * 1000);
      await tx.sponsorOrder.updateMany({
        where: {
          status: "pending",
          OR: [
            { expiresAt: { lte: now } },
            { expiresAt: null, createdAt: { lte: legacyCutoff } },
          ],
        },
        data: {
          status: "closed",
          closedAt: now,
        },
      });
      const pendingOrders = await tx.sponsorOrder.count({
        where: { status: "pending" },
      });
      if (pendingOrders > 0) {
        throw new Error("存在待支付赞助订单，暂不能修改商户网关或密钥");
      }
    }

    await tx.epayConfig.update({
      where: { id: EPAY_CONFIG_ID },
      data: {
        enabled: nextEnabled,
        gatewayUrl: nextGatewayUrl,
        pid: nextPid,
        merchantKey: nextMerchantKey,
        signType: nextSignType,
        defaultType: nextDefaultType,
        enabledTypes: JSON.stringify(nextEnabledTypes),
      },
    });
  });
  return getEpayConfig(requestOrigin);
}

export function signEpayParams(params: Record<string, string | number | boolean | null | undefined>, merchantKey: string) {
  const query = Object.keys(params)
    .filter((key) => key !== "sign" && key !== "sign_type")
    .filter((key) => params[key] !== undefined && params[key] !== null && String(params[key]) !== "")
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");
  return crypto.createHash("md5").update(`${query}${merchantKey}`).digest("hex");
}

export function verifyEpayParams(params: Record<string, string | number | boolean | null | undefined>, merchantKey: string) {
  const sign = String(params.sign ?? "").toLowerCase();
  if (!sign) return false;
  return signEpayParams(params, merchantKey) === sign;
}

export type EpayMerchantCredentials = {
  pid: string;
  merchantKey: string;
};

export function verifyEpayMerchantParams(
  params: Record<string, string | number | boolean | null | undefined>,
  credentials: EpayMerchantCredentials,
) {
  return Boolean(
    credentials.pid
    && credentials.merchantKey
    && String(params.pid ?? "") === credentials.pid
    && verifyEpayParams(params, credentials.merchantKey),
  );
}

function ensureReady(config: EpayStoredConfig) {
  if (!config.enabled) throw new Error("易支付尚未启用");
  if (!config.gatewayUrl) throw new Error("易支付网关地址未配置");
  normalizeAbsoluteUrl(
    config.gatewayUrl,
    "易支付网关地址必须是无凭据的 HTTPS 地址",
  );
  if (!config.pid) throw new Error("易支付商户 ID 未配置");
  if (!config.merchantKey) throw new Error("易支付商户密钥未配置");
}

export async function buildEpaySubmitPayload(
  order: EpayOrderInput,
  client: EpayClient = prisma,
) {
  const config = await getStoredEpayConfig(client);
  ensureReady(config);
  const enabledTypes = normalizePayTypes(config.enabledTypes);
  const payType = normalizeDefaultType(order.type || config.defaultType, enabledTypes);
  if (!enabledTypes.includes(payType as EpayPayType)) throw new Error("该支付方式未启用");
  const params: Record<string, string> = {
    pid: config.pid,
    type: payType,
    out_trade_no: order.outTradeNo.trim(),
    notify_url: order.notifyUrl.trim(),
    return_url: order.returnUrl.trim(),
    name: order.name.trim(),
    money: normalizeMoney(order.money),
  };
  if (order.clientIp?.trim()) params.clientip = order.clientIp.trim();
  if (order.device?.trim()) params.device = order.device.trim();
  if (order.param?.trim()) params.param = order.param.trim();

  if (!params.out_trade_no) throw new Error("商户订单号不能为空");
  if (!params.name) throw new Error("商品名称不能为空");
  if (!params.notify_url) throw new Error("异步通知地址未配置");
  if (!params.return_url) throw new Error("同步跳转地址未配置");

  params.sign = signEpayParams(params, config.merchantKey);
  params.sign_type = config.signType || "MD5";

  return {
    submitUrl: submitUrlFromGateway(config.gatewayUrl),
    method: "POST",
    params,
  };
}

export async function getEpayMerchantKey() {
  const config = await getStoredEpayConfig();
  return config.merchantKey;
}

export async function getEpayMerchantCredentials() {
  const config = await getStoredEpayConfig();
  return {
    pid: config.pid,
    merchantKey: config.merchantKey,
  };
}

export async function getEnabledEpayTypes() {
  const config = await getStoredEpayConfig();
  if (!config.enabled || !config.gatewayUrl || !config.pid || !config.merchantKey) return [];
  try {
    normalizeAbsoluteUrl(
      config.gatewayUrl,
      "易支付网关地址必须是无凭据的 HTTPS 地址",
    );
  } catch {
    return [];
  }
  return normalizePayTypes(config.enabledTypes);
}
