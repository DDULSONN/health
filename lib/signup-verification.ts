// UI hints only: never proof of signup, login, email or phone verification.
export const SIGNUP_RESEND_DELAY_MS = 60_000;
export const PENDING_SIGNUP_KEY = "gymtools:pending-email-signup:v1";
const PENDING_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const RECENT_EMAIL_KEY = "recent_login_email";
const REFERRAL_KEY = "pending_signup_referral";

export type PendingSignup = {
  email: string;
  referralCode: string;
  createdAt: number;
  resendAvailableAt: number;
};

export function readSignupEmail(): string {
  try { return window.localStorage.getItem(RECENT_EMAIL_KEY) ?? ""; } catch { return ""; }
}

export function rememberSignupEmail(email: string) {
  try { window.localStorage.setItem(RECENT_EMAIL_KEY, email); } catch { /* Optional convenience. */ }
}

export function rememberSignupReferral(code: string) {
  try {
    if (code) window.localStorage.setItem(REFERRAL_KEY, JSON.stringify({ code, createdAt: Date.now() }));
    else window.localStorage.removeItem(REFERRAL_KEY);
  } catch { /* The callback URL also carries the referral code. */ }
}

export function newPendingSignup(email: string, referralCode: string, now = Date.now()): PendingSignup {
  return { email, referralCode, createdAt: now, resendAvailableAt: now + SIGNUP_RESEND_DELAY_MS };
}

export function savePendingSignup(value: PendingSignup) {
  try { window.sessionStorage.setItem(PENDING_SIGNUP_KEY, JSON.stringify(value)); } catch { /* Keep React state. */ }
}

export function clearPendingSignup() {
  try { window.sessionStorage.removeItem(PENDING_SIGNUP_KEY); } catch { /* Optional convenience. */ }
}

export function readPendingSignup(now = Date.now()): PendingSignup | null {
  try {
    const value = JSON.parse(window.sessionStorage.getItem(PENDING_SIGNUP_KEY) ?? "null");
    if (!value || typeof value.email !== "string" || value.email.length > 320 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email) ||
      typeof value.referralCode !== "string" || !/^[A-Z0-9]{0,16}$/.test(value.referralCode) ||
      !Number.isFinite(value.createdAt) || value.createdAt > now || now - value.createdAt >= PENDING_MAX_AGE_MS ||
      !Number.isFinite(value.resendAvailableAt) || value.resendAvailableAt < value.createdAt ||
      value.resendAvailableAt > now + SIGNUP_RESEND_DELAY_MS) {
      clearPendingSignup();
      return null;
    }
    // Do not restore any unexpected fields (in particular credentials).
    return { email: value.email, referralCode: value.referralCode, createdAt: value.createdAt, resendAvailableAt: value.resendAvailableAt };
  } catch { return null; }
}

export function resendSecondsLeft(availableAt: number, now = Date.now()): number {
  return Math.max(0, Math.ceil((availableAt - now) / 1000));
}

export function isConfirmedSignupUser(user: { email?: string | null; email_confirmed_at?: string | null } | null, email: string) {
  return Boolean(user?.email_confirmed_at && user.email?.trim().toLowerCase() === email.trim().toLowerCase());
}

export function isSignupEmailRateLimit(error: { status?: number; code?: string; message?: string }) {
  return error.status === 429 || /rate.?limit|too many|security purposes/i.test(`${error.code ?? ""} ${error.message ?? ""}`);
}

// Bound read-only status checks. Never race/retry the signup or mail mutation itself.
export async function readSignupUserWithTimeout<T>(read: () => Promise<T>, timeoutMs = 10_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(read),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("signup_status_timeout")), timeoutMs); }),
    ]);
  } finally { clearTimeout(timer); }
}
