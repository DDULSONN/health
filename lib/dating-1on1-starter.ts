type Candidate = { id?: string };
type Group = { source_card_id?: string; recommendations?: Candidate[]; admin_recommendations?: Candidate[] };

/** Display-only subset of the existing server order; no new recommendation or quota use. */
export function getOneOnOneStarterKeys(groups: readonly Group[]): Set<string> {
  const keys = new Set<string>();
  const seen = new Set<string>();
  for (const group of groups) {
    if (!group.source_card_id) continue;
    for (const card of [...(group.recommendations ?? []), ...(group.admin_recommendations ?? [])]) {
      if (!card.id || seen.has(card.id)) continue;
      keys.add(`${group.source_card_id}:${card.id}`);
      seen.add(card.id);
      if (keys.size === 3) return keys;
    }
  }
  return keys;
}

export function getOneOnOneStarterGroups<T extends Group>(groups: readonly T[]): T[] {
  const keys = getOneOnOneStarterKeys(groups);
  return groups.map(group => {
    const take = (card: Candidate) => keys.delete(`${group.source_card_id}:${card.id}`);
    return { ...group, recommendations: group.recommendations?.filter(take), admin_recommendations: group.admin_recommendations?.filter(take) };
  }).filter(group => (group.recommendations?.length ?? 0) + (group.admin_recommendations?.length ?? 0) > 0);
}
