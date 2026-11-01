import { CONTACT_CARE_UUID } from "@/lib/contact-care";

export const CONTACT_VOUCHER_GRANT_LIMIT = 10;
export type ContactVoucherGrantInput = {
  requestId: string;
  userId: string;
  expectedNickname: string;
  quantity: number;
  reason: string;
  confirmed: true;
};
export function parseContactVoucherGrant(value: unknown): ContactVoucherGrantInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.requestId !== "string" || !CONTACT_CARE_UUID.test(v.requestId) ||
    typeof v.userId !== "string" || !CONTACT_CARE_UUID.test(v.userId) ||
    typeof v.expectedNickname !== "string" || !v.expectedNickname.trim() || v.expectedNickname.length > 100 ||
    typeof v.quantity !== "number" || !Number.isSafeInteger(v.quantity) || v.quantity < 1 || v.quantity > CONTACT_VOUCHER_GRANT_LIMIT ||
    typeof v.reason !== "string" || Array.from(v.reason.trim()).length < 5 || v.reason.length > 300 || v.confirmed !== true) return null;
  return { requestId: v.requestId.toLowerCase(), userId: v.userId.toLowerCase(), expectedNickname: v.expectedNickname,
    quantity: v.quantity, reason: v.reason.trim(), confirmed: true };
}
export type ContactVoucherAdminSnapshot = {
  member: { id: string; nickname: string; canGrant: boolean };
  installed: boolean;
  manualRemaining: number;
  claimRemaining: number;
  remaining: number;
  history: { id: string; reason: string; created_at: string; used_at: string | null; revoked_at: string | null }[];
};
export function isContactVoucherAdminSnapshot(value: unknown, userId: string): value is ContactVoucherAdminSnapshot {
  const v = value as ContactVoucherAdminSnapshot | null;
  return !!v && v.member?.id === userId && typeof v.member.nickname === "string" && typeof v.member.canGrant === "boolean" &&
    typeof v.installed === "boolean" && [v.manualRemaining, v.claimRemaining, v.remaining].every(n => Number.isSafeInteger(n) && n >= 0) &&
    v.remaining === v.manualRemaining + v.claimRemaining && Array.isArray(v.history) && v.history.length <= 20 &&
    v.history.every(h => !!h && typeof h.id === "string" && CONTACT_CARE_UUID.test(h.id) && typeof h.reason === "string" &&
      typeof h.created_at === "string" && Number.isFinite(Date.parse(h.created_at)) &&
      (h.used_at === null || typeof h.used_at === "string") && (h.revoked_at === null || typeof h.revoked_at === "string"));
}
