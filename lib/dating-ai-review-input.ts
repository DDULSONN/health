import type { CandidateCard } from "@/lib/dating-profile-review";

export const AI_REVIEW_INPUT_VERSION = "2026-11-13-authored-text-v1";

// Use an allowlist: dedicated contact fields and another member's metadata are
// not authored profile prose. Keep the original card for rules, display and edits.
const AUTHORED_TEXT_FIELDS = ["job", "intro", "strengths", "ideal", "idealType", "preferredPartner"] as const;

export function getDatingAiReviewTexts(card: Pick<CandidateCard, "texts">): Record<string, string> {
  const texts: Record<string, string> = {};
  for (const field of AUTHORED_TEXT_FIELDS) {
    if (typeof card.texts[field] === "string") texts[field] = card.texts[field];
  }
  return texts;
}

export const DATING_AI_REVIEW_INPUT_SCOPE =
  "오픈카드의 정식 인스타그램 입력란은 정상 기능이며 위반이 아니다. 정식 연락처 입력란·상대방 정보·내부 ID는 검수 본문에서 제외했다. " +
  "제공하지 않은 항목을 추측하거나 누락으로 지적하지 않는다. 이름/닉네임은 표시 정보이므로 아이디처럼 생겼다는 이유만으로 연락처로 판단하지 않는다. " +
  "단, 작성자가 소개글·장점·이상형·직업 본문 또는 사진에 직접 넣은 연락처·외부 연락 유도는 계속 검수한다.";
