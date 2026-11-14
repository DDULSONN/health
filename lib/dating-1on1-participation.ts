// Display eligibility only. Never creates a request or changes recommendations.
type Profile = { id?: string; status?: string | null; archived?: boolean };
type Candidate = { id?: string };
type Group = {
  source_card_id?: string;
  hidden_candidate_ids?: string[];
  recommendations?: Candidate[];
  admin_recommendations?: Candidate[];
};
type Match = { role?: string; state?: string };

export function shouldShowFirstOneOnOneRequest(input: {
  hasSentRequest?: boolean | null;
  phoneVerified?: boolean;
  cards: readonly Profile[];
  groups: readonly Group[];
  matches: readonly Match[];
}): boolean {
  // Unknown/failed history is not evidence that this is a first-time sender.
  if (input.hasSentRequest !== false || input.phoneVerified !== true) return false;
  // Give received requests and existing connections priority over a first-send prompt.
  if (input.matches.some(match => ["source_selected", "candidate_accepted", "mutual_accepted"].includes(match.state ?? ""))) return false;
  const activeIds = new Set(input.cards.filter(card => card.id && !card.archived &&
    ["submitted", "reviewing", "approved"].includes(card.status ?? "")).map(card => card.id));
  return input.groups.some(group => {
    if (!group.source_card_id || !activeIds.has(group.source_card_id)) return false;
    const hidden = new Set(group.hidden_candidate_ids ?? []);
    return [...(group.recommendations ?? []), ...(group.admin_recommendations ?? [])]
      .some(candidate => candidate.id && !hidden.has(candidate.id));
  });
}
