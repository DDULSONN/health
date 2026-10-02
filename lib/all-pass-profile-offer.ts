export const ALL_PASS_PROFILE_OFFER_KEY = "completed-profile-all-pass-v1";
export const ALL_PASS_PROFILE_REGULAR_PRICE = 39_900;
export const ALL_PASS_PROFILE_DISCOUNT_PRICE = 32_000;
export const ALL_PASS_PROFILE_DISCOUNT_LABEL = "약 20% 할인";
export const ALL_PASS_PROFILE_WINDOW_MS = 24 * 60 * 60 * 1000;
export type AllPassProfileOffer = {
  state: "available" | "active" | "expired" | "used";
  offerId: string | null;
  startsAt: string | null;
  expiresAt: string | null;
  serverNow: string;
  amount: 32000;
  originalAmount: 39900;
};
export function isAllPassProfileOffer(value: unknown): value is AllPassProfileOffer {
  if (!value || typeof value !== "object") return false;
  const v = value as AllPassProfileOffer;
  if (v.amount !== ALL_PASS_PROFILE_DISCOUNT_PRICE || v.originalAmount !== ALL_PASS_PROFILE_REGULAR_PRICE ||
    !["available", "active", "expired", "used"].includes(v.state) || !Number.isFinite(Date.parse(v.serverNow))) return false;
  if (v.state === "available") return v.offerId === null && v.startsAt === null && v.expiresAt === null;
  return typeof v.offerId === "string" && /^[0-9a-f-]{36}$/i.test(v.offerId) &&
    typeof v.startsAt === "string" && typeof v.expiresAt === "string" &&
    Date.parse(v.expiresAt) - Date.parse(v.startsAt) === ALL_PASS_PROFILE_WINDOW_MS;
}
export function allPassOfferRemaining(offer: AllPassProfileOffer, elapsedMs: number) {
  if (offer.state !== "active" || !offer.expiresAt) return 0;
  return Math.max(0, Date.parse(offer.expiresAt) - Date.parse(offer.serverNow) - Math.max(0, elapsedMs));
}
export function allPassOfferTimeLabel(ms: number) {
  const minutes = Math.max(0, Math.ceil(ms / 60_000));
  return minutes >= 60 ? `${Math.floor(minutes / 60)}시간 ${minutes % 60}분` : `${minutes}분`;
}
