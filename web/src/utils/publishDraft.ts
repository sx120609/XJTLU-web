const DRAFT_PREFIX = "kaopu:publish-draft:v1";
const DRAFT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

type PublishDraftEnvelope<T> = {
  savedAt: number;
  value: T;
};

function storageKey(type: string, userId?: number | null) {
  return `${DRAFT_PREFIX}:${userId || "guest"}:${type}`;
}

export function savePublishDraft<T>(type: string, value: T, userId?: number | null) {
  try {
    const envelope: PublishDraftEnvelope<T> = { savedAt: Date.now(), value };
    localStorage.setItem(storageKey(type, userId), JSON.stringify(envelope));
    return envelope.savedAt;
  } catch {
    return 0;
  }
}

export function readPublishDraft<T>(type: string, userId?: number | null) {
  const key = storageKey(type, userId);
  try {
    const envelope = JSON.parse(localStorage.getItem(key) || "null") as PublishDraftEnvelope<T> | null;
    if (!envelope || !Number.isFinite(envelope.savedAt) || !envelope.value) return null;
    if (Date.now() - envelope.savedAt > DRAFT_MAX_AGE_MS) {
      localStorage.removeItem(key);
      return null;
    }
    return envelope;
  } catch {
    localStorage.removeItem(key);
    return null;
  }
}

export function clearPublishDraft(type: string, userId?: number | null) {
  try { localStorage.removeItem(storageKey(type, userId)); } catch { /* storage may be unavailable */ }
}

export function moveArrayEntry<T>(list: T[], from: number, to: number) {
  if (from < 0 || from >= list.length || to < 0 || to >= list.length || from === to) return;
  const [entry] = list.splice(from, 1);
  list.splice(to, 0, entry);
}
