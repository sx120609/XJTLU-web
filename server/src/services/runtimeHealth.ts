type RuntimeJobState = {
  key: string;
  label: string;
  intervalMs: number | null;
  registeredAt: number;
  lastStartedAt: number | null;
  lastSucceededAt: number | null;
  lastFailedAt: number | null;
  lastDurationMs: number | null;
  lastError: string | null;
  runs: number;
  failures: number;
  skippedOverlaps: number;
  running: boolean;
};

const processStartedAt = Date.now();
const runtimeJobs = new Map<string, RuntimeJobState>();

function safeErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "未知错误");
  return message.replace(/\s+/g, " ").trim().slice(0, 300) || "未知错误";
}

function ensureRuntimeJob(key: string, label: string, intervalMs?: number | null) {
  const existing = runtimeJobs.get(key);
  if (existing) {
    existing.label = label;
    if (intervalMs !== undefined) existing.intervalMs = intervalMs;
    return existing;
  }
  const state: RuntimeJobState = {
    key,
    label,
    intervalMs: intervalMs ?? null,
    registeredAt: Date.now(),
    lastStartedAt: null,
    lastSucceededAt: null,
    lastFailedAt: null,
    lastDurationMs: null,
    lastError: null,
    runs: 0,
    failures: 0,
    skippedOverlaps: 0,
    running: false,
  };
  runtimeJobs.set(key, state);
  return state;
}

export function registerRuntimeJob(key: string, label: string, intervalMs?: number | null) {
  ensureRuntimeJob(key, label, intervalMs);
}

export async function runTrackedJob<T>(
  key: string,
  label: string,
  task: () => Promise<T>,
  intervalMs?: number | null,
) {
  const state = ensureRuntimeJob(key, label, intervalMs);
  if (state.running) {
    state.skippedOverlaps += 1;
    return undefined;
  }
  const startedAt = Date.now();
  state.running = true;
  state.lastStartedAt = startedAt;
  state.runs += 1;
  try {
    const result = await task();
    state.lastSucceededAt = Date.now();
    state.lastDurationMs = state.lastSucceededAt - startedAt;
    state.lastError = null;
    return result;
  } catch (error) {
    state.lastFailedAt = Date.now();
    state.lastDurationMs = state.lastFailedAt - startedAt;
    state.lastError = safeErrorMessage(error);
    state.failures += 1;
    throw error;
  } finally {
    state.running = false;
  }
}

export function getRuntimeHealthSnapshot(now = Date.now()) {
  const memory = process.memoryUsage();
  return {
    process: {
      startedAt: new Date(processStartedAt).toISOString(),
      uptimeMs: Math.max(0, now - processStartedAt),
      nodeVersion: process.version,
      memory: {
        rssBytes: memory.rss,
        heapUsedBytes: memory.heapUsed,
        heapTotalBytes: memory.heapTotal,
      },
    },
    jobs: [...runtimeJobs.values()]
      .sort((a, b) => a.label.localeCompare(b.label, "zh-CN"))
      .map((job) => {
        const failedAfterSuccess = Boolean(job.lastFailedAt && (!job.lastSucceededAt || job.lastFailedAt > job.lastSucceededAt));
        return {
          key: job.key,
          label: job.label,
          intervalMs: job.intervalMs,
          status: job.running ? "running" : failedAfterSuccess ? "failed" : job.lastSucceededAt ? "healthy" : "waiting",
          registeredAt: new Date(job.registeredAt).toISOString(),
          lastStartedAt: job.lastStartedAt ? new Date(job.lastStartedAt).toISOString() : null,
          lastSucceededAt: job.lastSucceededAt ? new Date(job.lastSucceededAt).toISOString() : null,
          lastFailedAt: job.lastFailedAt ? new Date(job.lastFailedAt).toISOString() : null,
          lastDurationMs: job.lastDurationMs,
          lastError: job.lastError,
          runs: job.runs,
          failures: job.failures,
          skippedOverlaps: job.skippedOverlaps,
        };
      }),
  };
}
