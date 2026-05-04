const ADMIN_PANEL_COOKIE = "admin_panel_unlocked";
const ADMIN_PANEL_SALT = "helchang-admin-panel-lock-v1";
const UNLOCK_MAX_AGE_SECONDS = 60 * 60 * 12;

function getPassword(): string {
  return process.env.ADMIN_PANEL_PASSWORD?.trim() ?? "";
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function getAdminPanelCookieName() {
  return ADMIN_PANEL_COOKIE;
}

export function getAdminPanelCookieMaxAge() {
  return UNLOCK_MAX_AGE_SECONDS;
}

export function isAdminPanelLockEnabled(): boolean {
  return getPassword().length > 0;
}

export async function createAdminPanelUnlockToken(userId: string): Promise<string> {
  const password = getPassword();
  if (!password) return "";
  return sha256(`${ADMIN_PANEL_SALT}:${userId}:${password}`);
}

export async function isAdminPanelUnlocked(userId: string, cookieValue?: string | null): Promise<boolean> {
  if (!isAdminPanelLockEnabled()) return true;
  if (!cookieValue) return false;
  const expected = await createAdminPanelUnlockToken(userId);
  return safeEqual(cookieValue, expected);
}

export function verifyAdminPanelPassword(input: string): boolean {
  const password = getPassword();
  return !!password && safeEqual(input, password);
}
