const ALLOWED_TEST_PAYMENT_EMAILS = new Set(["tosstest@tosstest"]);

export function isAllowedTestPaymentEmail(email: string | null | undefined) {
  const normalized = String(email ?? "").trim().toLowerCase();
  if (!normalized) return false;
  return ALLOWED_TEST_PAYMENT_EMAILS.has(normalized);
}
