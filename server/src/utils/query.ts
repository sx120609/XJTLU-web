type BoundedIntegerOptions = {
  fallback: number;
  min?: number;
  max?: number;
};

/**
 * Parse an integer from an Express query value without allowing NaN, Infinity,
 * fractional values, or an unbounded offset to reach Prisma.
 */
export function boundedQueryInteger(value: unknown, options: BoundedIntegerOptions) {
  const min = options.min ?? Number.MIN_SAFE_INTEGER;
  const max = options.max ?? Number.MAX_SAFE_INTEGER;
  const candidate = Array.isArray(value) ? value[0] : value;
  const parsed = typeof candidate === "number"
    ? candidate
    : typeof candidate === "string" && candidate.trim()
      ? Number(candidate)
      : Number.NaN;
  if (!Number.isFinite(parsed)) return Math.min(max, Math.max(min, Math.trunc(options.fallback)));
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

export function queryPage(value: unknown) {
  return boundedQueryInteger(value, { fallback: 1, min: 1, max: 100_000 });
}

export function querySize(value: unknown, fallback: number, min: number, max: number) {
  return boundedQueryInteger(value, { fallback, min, max });
}

export function positiveRouteInteger(value: unknown) {
  const parsed = typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 2_147_483_647 ? parsed : null;
}
