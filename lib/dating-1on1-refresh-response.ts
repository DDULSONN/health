// Validate the display boundary only. Never change ranking, eligibility or quota.
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCandidate(value: unknown) {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id.trim()) return false;
  for (const key of ["name", "nickname", "display_nickname", "region", "job", "intro_text", "strengths_text", "preferred_partner_text"]) {
    if (value[key] != null && typeof value[key] !== "string") return false;
  }
  for (const key of ["age", "birth_year", "height_cm"]) {
    if (value[key] != null && (typeof value[key] !== "number" || !Number.isFinite(value[key]))) return false;
  }
  return value.photo_signed_urls == null || (Array.isArray(value.photo_signed_urls) &&
    value.photo_signed_urls.every((url) => typeof url === "string"));
}

export function isOneOnOneRecommendationPayload(value: unknown): boolean {
  if (!isRecord(value) || !Array.isArray(value.items)) return false;
  return value.items.every((group) => {
    if (!isRecord(group) || typeof group.source_card_id !== "string" || !group.source_card_id.trim()) return false;
    if (!Array.isArray(group.recommendations) || !group.recommendations.every(isCandidate)) return false;
    // Optional lists can be absent on an older server or empty on a small pool.
    return [group.admin_recommendations, group.favorite_candidates].every((list) =>
      list == null || (Array.isArray(list) && list.every(isCandidate)));
  });
}
