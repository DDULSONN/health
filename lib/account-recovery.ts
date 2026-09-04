export const PHONE_ALREADY_USED_CODE = "PHONE_ALREADY_USED";

export function safeAccountRecoveryNext(input: string | null | undefined) {
  if (!input || !input.startsWith("/") || input.startsWith("//")) return "/";
  if (
    input.startsWith("/login") ||
    input.startsWith("/signup") ||
    input.startsWith("/auth") ||
    input.startsWith("/account-recovery")
  ) {
    return "/";
  }
  return input;
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
  return "/auth/reset-password";
}

export function isPhoneAlreadyUsedCode(input: unknown) {
  return String(input ?? "").trim().toUpperCase() === PHONE_ALREADY_USED_CODE;
}
