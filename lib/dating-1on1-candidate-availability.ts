// Presentation only. Never changes safety filters, refresh eligibility or quota.
export type OneOnOneCandidateAvailability = {
  state: "empty" | "limited";
  candidate_count: number;
  has_hidden_candidates: boolean;
  has_request_history: boolean;
  has_favorites: boolean;
};

export function getOneOnOneCandidateAvailability(input: {
  eligibleCount: number; hiddenCount: number; excludedByHistoryCount: number; favoriteCount: number;
}): OneOnOneCandidateAvailability | null {
  if (!Number.isSafeInteger(input.eligibleCount) || input.eligibleCount < 0 || input.eligibleCount >= 10) return null;
  return {
    state: input.eligibleCount === 0 ? "empty" : "limited", candidate_count: input.eligibleCount,
    has_hidden_candidates: input.hiddenCount > 0,
    has_request_history: input.excludedByHistoryCount > 0,
    has_favorites: input.favoriteCount > 0,
  };
}

export function getOneOnOneCandidateAvailabilityCopy(value?: OneOnOneCandidateAvailability | null) {
  if (!value || !["empty", "limited"].includes(value.state) || !Number.isSafeInteger(value.candidate_count) ||
    value.candidate_count < 0 || value.candidate_count >= 10 ||
    (value.state === "empty") !== (value.candidate_count === 0)) return null;
  return {
    title: value.state === "empty" ? "지금 새로 추천할 후보가 없어요." : `지금 추천 가능한 후보는 ${value.candidate_count}명이에요.`,
    detail: value.has_request_history ? "이미 요청했거나 거절·차단한 상대는 추천에서 제외해요."
      : "후보가 새로 등록되면 나이와 지역을 고려해 추천해요.",
    hidden: value.has_hidden_candidates ? "숨김을 해제하면 조건에 맞는 후보를 다시 추천받을 수 있어요." : null,
    favorites: value.has_favorites ? "찜한 후보도 따로 확인할 수 있어요." : null,
  };
}
