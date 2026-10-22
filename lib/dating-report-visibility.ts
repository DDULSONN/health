// Client presentation only. Server blocks remain authoritative for access.
// Remove a successfully blocked member even if the following reload fails.
type Report = { blocked: boolean; blockedUserId?: string; blockedCardId?: string; targetType?: string; targetId?: string };
type Card = { id?: string; user_id?: string };

function isReportedCard(card: Card | null | undefined, report: Report) {
  return Boolean(card && report.blocked && (
    (report.blockedUserId && card.user_id === report.blockedUserId) ||
    (report.blockedCardId && report.targetType?.startsWith("one_on_one_") && card.id === report.blockedCardId) ||
    (report.targetType === "one_on_one_card" && report.targetId && card.id === report.targetId)
  ));
}

export function hideReportedMatches<T extends { id: string; counterparty_card?: Card | null }>(items: T[], report: Report): T[] {
  if (!report.blocked) return items;
  return items.filter(item => !isReportedCard(item.counterparty_card, report) &&
    !(report.targetType === "one_on_one_match" && report.targetId === item.id));
}

export function hideReportedRecommendations<T extends { recommendations?: Card[]; admin_recommendations?: Card[]; favorite_candidates?: Card[] }>(items: T[], report: Report): T[] {
  if (!report.blocked) return items;
  return items.map(group => ({ ...group,
    ...(group.recommendations ? { recommendations: group.recommendations.filter(card => !isReportedCard(card, report)) } : {}),
    ...(group.admin_recommendations ? { admin_recommendations: group.admin_recommendations.filter(card => !isReportedCard(card, report)) } : {}),
    ...(group.favorite_candidates ? { favorite_candidates: group.favorite_candidates.filter(card => !isReportedCard(card, report)) } : {}),
  }));
}
