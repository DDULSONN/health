import { safeInternalPath } from "@/lib/safe-internal-path";

export const PHONE_ALREADY_USED_CODE = "PHONE_ALREADY_USED";

export function safeAccountRecoveryNext(input: string | null | undefined) {
  const safePath = safeInternalPath(input);
  const pathname = safePath.split(/[?#]/, 1)[0];
  if (
    pathname === "/login" || pathname.startsWith("/login/") ||
    pathname === "/signup" || pathname.startsWith("/signup/") ||
    pathname === "/auth" || pathname.startsWith("/auth/") ||
    pathname === "/account-recovery" || pathname.startsWith("/account-recovery/")
  ) {
    return "/";
  }
  return safePath;
}

export function buildExistingAccountLoginHref(
  nextInput: string | null | undefined,
  options: { tab?: "social" | "google" | "apple" | "password" | "otp"; recovery?: boolean } = {},
) {
  const params = new URLSearchParams({
    next: safeAccountRecoveryNext(nextInput),
    reason: "phone_already_used",
  });
  if (options.tab) params.set("tab", options.tab);
  if (options.recovery) params.set("recovery", "1");
  return `/login?${params.toString()}`;
}

export function buildAccountRecoveryHref(nextInput: string | null | undefined) {
  return `/account-recovery?next=${encodeURIComponent(safeAccountRecoveryNext(nextInput))}`;
}

export function buildPasswordResetHref() {
  return "/auth/reset-password?recovery=1";
}

export function isPhoneAlreadyUsedCode(input: unknown) {
  return String(input ?? "").trim().toUpperCase() === PHONE_ALREADY_USED_CODE;
}
