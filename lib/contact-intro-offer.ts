export const CONTACT_INTRO_PRICE = 15_000;
export type ContactIntroOffer = {
  offerId: string;
  matchId: string;
  amount: 15000;
  originalAmount: 20000;
  expiresAt: string;
  serverNow: string;
  active: boolean;
  hasOrder: boolean;
};
export const isContactIntroId = (id: unknown): id is string =>
  typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
export function isContactIntroOffer(value: unknown): value is ContactIntroOffer {
  if (!value || typeof value !== "object") return false;
  const o = value as ContactIntroOffer;
  return isContactIntroId(o.offerId) && isContactIntroId(o.matchId) && o.amount === CONTACT_INTRO_PRICE &&
    o.originalAmount === 20000 && typeof o.active === "boolean" && typeof o.hasOrder === "boolean" &&
    Number.isFinite(Date.parse(o.expiresAt)) && Number.isFinite(Date.parse(o.serverNow));
}
