const BODYCHECK_PRIOR_MEAN = 1.5;
const BODYCHECK_PRIOR_WEIGHT = 3;

type RankLikeRow = {
  score_sum?: number | null;
  vote_count?: number | null;
  score_avg?: number | null;
  created_at?: string | null;
};

export function getBodycheckAverageScore(row: RankLikeRow) {
  const explicitAverage = Number(row.score_avg ?? NaN);
  if (Number.isFinite(explicitAverage)) return explicitAverage;

  const voteCount = Number(row.vote_count ?? 0);
  if (voteCount <= 0) return 0;
  return Number(row.score_sum ?? 0) / voteCount;
}

export function getBodycheckRankingScore(row: RankLikeRow) {
  const voteCount = Math.max(0, Number(row.vote_count ?? 0));
  const average = getBodycheckAverageScore(row);
  return (
    (average * voteCount + BODYCHECK_PRIOR_MEAN * BODYCHECK_PRIOR_WEIGHT) /
    (voteCount + BODYCHECK_PRIOR_WEIGHT)
  );
}

export function compareBodycheckRankRows<T extends RankLikeRow>(a: T, b: T) {
  const scoreDiff = getBodycheckRankingScore(b) - getBodycheckRankingScore(a);
  if (Math.abs(scoreDiff) > 1e-9) return scoreDiff;

  const avgDiff = getBodycheckAverageScore(b) - getBodycheckAverageScore(a);
  if (Math.abs(avgDiff) > 1e-9) return avgDiff;

  const voteDiff = Number(b.vote_count ?? 0) - Number(a.vote_count ?? 0);
  if (voteDiff !== 0) return voteDiff;

  const aTime = new Date(String(a.created_at ?? "")).getTime();
  const bTime = new Date(String(b.created_at ?? "")).getTime();
  return (Number.isFinite(aTime) ? aTime : 0) - (Number.isFinite(bTime) ? bTime : 0);
}
