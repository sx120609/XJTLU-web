import dayjs from "dayjs";
import { getActiveLocale } from "@/i18n";

export function fmtDate(d: string | Date | null | undefined, pattern = "YYYY-MM-DD HH:mm") {
  if (!d) return "—";
  return dayjs(d).format(pattern);
}

export function fmtRelative(d: string | Date | null | undefined) {
  if (!d) return "";
  const target = dayjs(d);
  const now = dayjs();
  const diffMin = target.diff(now, "minute");
  const relative = new Intl.RelativeTimeFormat(getActiveLocale(), { numeric: "auto" });
  if (Math.abs(diffMin) < 1) return relative.format(0, "minute");
  if (Math.abs(diffMin) < 60) return relative.format(diffMin, "minute");
  const diffHours = Math.trunc(diffMin / 60);
  if (Math.abs(diffHours) < 24) return relative.format(diffHours, "hour");
  const diffDays = Math.trunc(diffHours / 24);
  if (Math.abs(diffDays) < 30) return relative.format(diffDays, "day");
  return new Intl.DateTimeFormat(getActiveLocale(), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(target.toDate());
}

export function fmtMoney(cents: number | string) {
  const amount = typeof cents === "string" ? Number(cents) : cents / 100;
  return new Intl.NumberFormat(getActiveLocale(), { style: "currency", currency: "CNY" }).format(amount);
}

export function fmtKWh(v: number) {
  return `${new Intl.NumberFormat(getActiveLocale(), { maximumFractionDigits: 1 }).format(v)} ${getActiveLocale() === "zh-CN" ? "度" : "kWh"}`;
}
