import { combineReview, type ReviewResult } from "./dating-review";

export function addRegistrationReviewFlags(review: ReviewResult, source: string, payload: Record<string, unknown>, year: number): ReviewResult {
  const birth = Number(payload.birthYear);
  const age = Number(payload.age);
  const flags: string[] = [];
  if (source === "one_on_one" && Number.isInteger(birth) && birth > 1900) {
    if (year - birth < 19) flags.push("등록 출생연도상 만19세 미만 — 연령 확인 필요");
    else if (year - birth === 19) flags.push("등록 출생연도상 만18~19세 — 생일 확인 필요");
  } else if (source === "open_card" && age > 0 && age < 19) {
    flags.push("등록 나이가 19세 미만 — 연령 확인 필요");
  }
  if (!flags.length) return review;
  return combineReview(review, {
    suspicionLevel: "medium", flags, textFlags: flags, photoFlags: [],
    summary: flags.join(" / "), raw: { registeredAgeOnly: true },
  }, [], { ...review.raw, registrationFlags: flags });
}

export function reviewFailure(review: ReviewResult): string | null {
  const incomplete = review.raw.incomplete;
  return review.raw.provider !== "gemini" || (Array.isArray(incomplete) && incomplete.length > 0)
    ? "사진·글 AI 검수 미완료. 재시도 후에도 실패하면 관리자 확인이 필요합니다."
    : null;
}
