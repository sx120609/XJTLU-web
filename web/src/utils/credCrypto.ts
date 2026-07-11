/**
 * 学校账号本地加密保存（用于“记住账号密码”）。
 * 数据只保存在当前浏览器；共享设备上不要启用。
 */
const KEY_STORAGE = "xjtlu-sso-key-v1";
const CRED_STORAGE = "xjtlu-sso-creds-v1";
const LEGACY_CPU_KEY_STORAGE = "cpu-jwxt-key-v1";
const LEGACY_CPU_CRED_STORAGE = "cpu-jwxt-creds-v1";

export function purgeLegacyCpuCreds() {
  try {
    localStorage.removeItem(LEGACY_CPU_CRED_STORAGE);
    localStorage.removeItem(LEGACY_CPU_KEY_STORAGE);
  } catch { /* ignore */ }
}

function b64encode(bytes: Uint8Array) {
  let value = "";
  for (let index = 0; index < bytes.length; index += 1) value += String.fromCharCode(bytes[index]);
  return btoa(value);
}

function b64decode(value: string) {
  const raw = atob(value);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return bytes;
}

async function getOrCreateKey() {
  let raw = localStorage.getItem(KEY_STORAGE);
  let bytes: Uint8Array;
  if (!raw) {
    bytes = crypto.getRandomValues(new Uint8Array(32));
    localStorage.setItem(KEY_STORAGE, b64encode(bytes));
  } else {
    bytes = b64decode(raw);
  }
  return crypto.subtle.importKey("raw", bytes as unknown as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function saveCreds(username: string, password: string) {
  purgeLegacyCpuCreds();
  const key = await getOrCreateKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify({
    username,
    password,
    school: "xjtlu",
    savedAt: Date.now(),
  }));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as unknown as BufferSource },
    key,
    plain as unknown as BufferSource,
  );
  localStorage.setItem(CRED_STORAGE, JSON.stringify({
    iv: b64encode(iv),
    data: b64encode(new Uint8Array(encrypted)),
  }));
}

export async function loadCreds(): Promise<{ username: string; password: string } | null> {
  purgeLegacyCpuCreds();
  const raw = localStorage.getItem(CRED_STORAGE);
  if (!raw) return null;
  try {
    const payload = JSON.parse(raw) as { iv?: string; data?: string };
    if (!payload.iv || !payload.data) return null;
    const key = await getOrCreateKey();
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64decode(payload.iv) as unknown as BufferSource },
      key,
      b64decode(payload.data) as unknown as BufferSource,
    );
    const value = JSON.parse(new TextDecoder().decode(decrypted)) as Record<string, unknown>;
    if (value.school !== "xjtlu" || typeof value.username !== "string" || typeof value.password !== "string") return null;
    return { username: value.username, password: value.password };
  } catch {
    clearCreds();
    return null;
  }
}

export function hasCreds() {
  purgeLegacyCpuCreds();
  try { return Boolean(localStorage.getItem(CRED_STORAGE)); } catch { return false; }
}

export function clearCreds() {
  purgeLegacyCpuCreds();
  try {
    localStorage.removeItem(CRED_STORAGE);
    localStorage.removeItem(KEY_STORAGE);
  } catch { /* ignore */ }
}

export async function savedUsername() {
  return (await loadCreds())?.username ?? null;
}
