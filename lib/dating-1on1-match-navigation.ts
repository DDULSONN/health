// Navigation/display only. The existing authenticated APIs remain the authority.
const HOME = "/community/dating/cards?tab=one_on_one";

export function normalizeOneOnOneMatchId(value: unknown): string | null {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    ? value.toLowerCase() : null;
}

export function oneOnOneMatchHref(value: unknown): string {
  const id = normalizeOneOnOneMatchId(value);
  return id ? `${HOME}&matchId=${id}#selected-one-on-one-match` : HOME;
}

export function oneOnOneNotificationHref(type: unknown, matchId: unknown): string | null {
  return typeof type === "string" && [
    "dating_1on1_selection_received", "dating_1on1_match_accepted",
    "dating_1on1_match_canceled", "dating_1on1_contact_nudge",
    "dating_1on1_contact_exchanged",
  ].includes(type) && normalizeOneOnOneMatchId(matchId) ? oneOnOneMatchHref(matchId) : null;
}

type MatchStep = { role?: string; state?: string; contact_exchange_status?: string };
export function canOfferOneOnOneContact(match: MatchStep): boolean {
  return match.state === "mutual_accepted" &&
    ["none", "awaiting_applicant_payment"].includes(match.contact_exchange_status ?? "");
}

export function oneOnOneNextStep(match: MatchStep): string | null {
  if (match.role === "source" && match.state === "candidate_accepted") return "수락 여부 확인";
  if (canOfferOneOnOneContact(match)) return "연락처 교환";
  return null;
}
