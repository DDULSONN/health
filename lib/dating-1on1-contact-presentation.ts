import { canOfferOneOnOneContact, oneOnOneNextStep } from "@/lib/dating-1on1-match-navigation";

// Presentation only: never expires/cancels a match or changes exchange eligibility.
export type ContactPresentationMatch = {
  id: string;
  role?: string;
  state?: string;
  action_required?: boolean;
  contact_exchange_status?: string;
  source_final_responded_at?: string | null;
  candidate_responded_at?: string | null;
  created_at?: string | null;
  contact_nudge?: {
    available?: boolean;
    received_from_other?: { created_at?: string | null } | null;
    replies_available?: boolean;
    sent_by_me?: { reply?: { created_at?: string | null } | null } | null;
  } | null;
};

const OLDER_UNEXCHANGED_MS = 7 * 24 * 60 * 60 * 1000;

function timestamp(value: string | null | undefined): number | null {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function mutualAcceptedTime(match: ContactPresentationMatch): number | null {
  return match.state === "mutual_accepted"
    ? timestamp(match.source_final_responded_at) ?? timestamp(match.candidate_responded_at)
    : null;
}

export function contactPresentationTime(match: ContactPresentationMatch): number | null {
  const base = mutualAcceptedTime(match) ?? timestamp(match.created_at);
  const receivedAt = canOfferOneOnOneContact(match) && match.contact_nudge?.available
    ? timestamp(match.contact_nudge.received_from_other?.created_at)
    : null;
  const repliedAt = canOfferOneOnOneContact(match) && match.contact_nudge?.available && match.contact_nudge.replies_available
    ? timestamp(match.contact_nudge.sent_by_me?.reply?.created_at)
    : null;
  // Only an actual partner reply brings an old match back into view. A reply
  // to their message (my own reply), receipt, or unrelated update never does.
  const times = [base, receivedAt, repliedAt].filter((time): time is number => time !== null);
  return times.length ? Math.max(...times) : null;
}

export function groupContactPresentation<T extends ContactPresentationMatch>(
  matches: readonly T[],
  now: number,
): { current: T[]; older: T[] } {
  const priority = (match: T) => canOfferOneOnOneContact(match) ? 2
    : match.action_required || oneOnOneNextStep(match) || match.state === "candidate_accepted" || match.state === "mutual_accepted" ? 1 : 0;
  const ordered = matches.map((match, index) => ({ match, index, time: contactPresentationTime(match) }))
    .sort((a, b) => priority(b.match) - priority(a.match)
      || (b.time ?? 0) - (a.time ?? 0) || a.index - b.index);
  const current: T[] = [], older: T[] = [];
  for (const { match, time } of ordered) {
    // Unknown dates, approved exchanges and pending reviews must stay reachable normally.
    const fold = canOfferOneOnOneContact(match) && mutualAcceptedTime(match) !== null
      && time !== null && Number.isFinite(now)
      && now - time >= OLDER_UNEXCHANGED_MS;
    (fold ? older : current).push(match);
  }
  return { current, older };
}
