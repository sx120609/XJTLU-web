export function safeNotificationLink(input: unknown) {
  const value = typeof input === "string" ? input.trim() : "";
  if (!value) return "";
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  try {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol)
      || url.username
      || url.password
    ) {
      return "";
    }
    return url.toString();
  } catch {
    return "";
  }
}

export function isExternalNotificationLink(value: string) {
  return /^https?:\/\//i.test(value);
}
