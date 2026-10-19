// Convenience storage only. Never use these values as proof of authentication.
export function readAuthHint(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}

export function writeAuthHint(key: string, value: string) {
  try { window.localStorage.setItem(key, value); } catch { /* Auth can succeed without a remembered email. */ }
}

export function removeAuthHint(key: string) {
  try { window.localStorage.removeItem(key); } catch { /* Storage can be unavailable in private/in-app browsers. */ }
}

export type AuthLinkAttempt = {
  key: string;
  promise: Promise<{ error: { message: string; code?: string } | null }>;
};

// A consumed one-time link must not be exchanged again on retry or refresh.
export function clearConsumedAuthLink() {
  const url = new URL(window.location.href);
  const hash = new URLSearchParams(url.hash.slice(1));
  for (const key of ["code", "token_hash", "type", "access_token", "refresh_token"]) {
    url.searchParams.delete(key);
    hash.delete(key);
  }
  url.hash = hash.toString();
  window.history.replaceState(window.history.state, "", url.toString());
}

/** Bound read-only SDK calls; do not retry or time out account mutations through this helper. */
export async function readAuthWithTimeout<T>(read: () => Promise<T>, timeoutMs = 10_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(read),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("auth_read_timeout")), timeoutMs);
      }),
    ]);
  } finally { clearTimeout(timer); }
}

export function accountRecoveryNeedsRetry(code: string) {
  return code !== "RECOVERY_ACCOUNT_MISMATCH" && code !== "RECOVERY_SESSION_EXPIRED";
}

export function authEmailError(message: string) {
  const lower = message.toLowerCase();
  if (/rate.?limit|too many|security purposes|over_email_send_rate_limit/.test(lower)) {
    return "메일 요청이 너무 잦아요. 잠시 기다린 뒤 다시 보내 주세요.";
  }
  if (/invalid.*email|email.*invalid/.test(lower)) return "이메일 주소를 다시 확인해 주세요.";
  if (/signups not allowed|signup.*disabled|user not found/.test(lower)) {
    return "가입했던 이메일인지 확인해 주세요. Google·Apple로 가입했다면 해당 로그인 방법을 이용해 주세요.";
  }
  return "메일을 보내지 못했어요. 연결 상태와 이메일 주소를 확인한 뒤 다시 시도해 주세요.";
}
