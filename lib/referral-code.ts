export const REFERRAL_CODE_MIN_LENGTH = 8;
export const REFERRAL_CODE_MAX_LENGTH = 16;

export function normalizeReferralCode(value: unknown) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, REFERRAL_CODE_MAX_LENGTH);
}
export function isValidReferralCode(value: unknown) {
  const normalized = normalizeReferralCode(value);
  return /^[A-Z0-9]{8,16}$/.test(normalized);
}
