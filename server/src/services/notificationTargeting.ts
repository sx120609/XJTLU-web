import type { Prisma } from "@prisma/client";
import { Errors } from "../utils/response";

export const NOTIFICATION_TARGET_CLIENTS = [
  "ios",
  "android",
  "harmony",
  "web",
] as const;

export type NotificationTargetClient =
  typeof NOTIFICATION_TARGET_CLIENTS[number];

export type NotificationTargetInput =
  | string
  | readonly string[]
  | null
  | undefined;

const targetClientSet = new Set<string>(NOTIFICATION_TARGET_CLIENTS);

export function effectiveNotificationClient(client: string) {
  return client === "unknown" ? "web" : client;
}

export function normalizeNotificationTargetClient(
  input: NotificationTargetInput,
): string | null {
  if (input === undefined || input === null) return null;
  const rawValues = Array.isArray(input) ? input : String(input).split(",");
  const values = rawValues
    .map((value) => String(value).trim().toLowerCase())
    .filter(Boolean);
  if (!values.length) {
    throw Errors.badRequest("投放平台不能为空");
  }
  if (values.includes("all")) {
    if (values.length > 1) {
      throw Errors.badRequest("“全部平台”不能与指定平台同时选择");
    }
    return null;
  }
  const invalid = values.find((value) => !targetClientSet.has(value));
  if (invalid) throw Errors.badRequest("投放平台不合法");

  const selected = NOTIFICATION_TARGET_CLIENTS.filter((value) =>
    values.includes(value)
  );
  return selected.length === NOTIFICATION_TARGET_CLIENTS.length
    ? null
    : selected.join(",");
}

export function parseStoredNotificationTargets(value?: string | null) {
  if (!value || value === "all") return null;
  const values = value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  if (!values.length || values.some((item) => !targetClientSet.has(item))) {
    return new Set<NotificationTargetClient>();
  }
  return new Set(
    values.filter(
      (item): item is NotificationTargetClient => targetClientSet.has(item),
    ),
  );
}

export function notificationVisibleToClient(
  notification: { targetClient?: string | null },
  client: string,
) {
  const targets = parseStoredNotificationTargets(notification.targetClient);
  if (!targets) return true;
  return targets.has(
    effectiveNotificationClient(client) as NotificationTargetClient,
  );
}

export function notificationTargetClientWhere(
  client: string,
): Prisma.NotificationWhereInput {
  const target = effectiveNotificationClient(client);
  return {
    OR: [
      { targetClient: null },
      { targetClient: "all" },
      { targetClient: target },
      { targetClient: { startsWith: `${target},` } },
      { targetClient: { endsWith: `,${target}` } },
      { targetClient: { contains: `,${target},` } },
    ],
  };
}
