/**
 * 점수·태그 계산 및 결과 매핑
 * - 총점: 그렇다=3, 중간이다=2, 아니다=1
 * - 태그: 그렇다(3)일 때만 해당 질문의 태그에 +1
 */

import { QUESTIONS, TOTAL_QUESTIONS } from "./questions";
import type { AnswersMap, TagId, TagScores, ResultId } from "./types";

/** 질문 ID(1~20) → 해당 질문이 기여하는 태그 목록 */
const QUESTION_TAGS: Record<number, TagId[]> = {
  1: ["heavy", "routine"],
  2: [],
  3: ["talk"],
  4: ["manage"],
  5: ["pump"],
  6: ["heavy"],
  7: ["talk", "egennam"],
  8: ["routine", "newbie"],
  9: ["pump"],
  10: ["manage"],
  11: ["pump", "frame"],
  12: ["newbie"],
  13: ["heavy"],
  14: [],
  15: ["routine", "manage"],
  16: [],
  17: ["talk", "egennam"],
  18: [],
  19: [],
  20: ["heavy"],
};

const ZERO_TAGS: TagScores = {
  heavy: 0,
  routine: 0,
  talk: 0,
  pump: 0,
  manage: 0,
  newbie: 0,
  frame: 0,
  egennam: 0,
};

/** 총점 계산 (1~3점 합산) */
export function calculateTotal(answers: AnswersMap): number {
  let total = 0;
  for (let q = 1; q <= TOTAL_QUESTIONS; q++) {
    const a = answers[q];
    if (a === 1) total += 1;
    else if (a === 2) total += 2;
    else if (a === 3) total += 3;
  }
  return total;
}

/** 태그 점수 계산: '그렇다'(3)일 때만 해당 질문의 태그에 +1 */
export function calculateTagScores(answers: AnswersMap): TagScores {
  const tags = { ...ZERO_TAGS };
  for (let q = 1; q <= TOTAL_QUESTIONS; q++) {
    if (answers[q] !== 3) continue;
    const tagList = QUESTION_TAGS[q];
    if (!tagList) continue;
    for (const t of tagList) {
      tags[t]++;
    }
  }
  return tags;
}

/**
 * 우선순위 매핑 로직 (위에서부터 만족하면 즉시 확정)
 * 1) 중증 헬창: total >= 52 && heavy >= 3
 * 2) 상급 헬창: total >= 47 && heavy >= 2
 * 3) 루틴 집착러: routine >= 2 && total >= 40
 * 4) 스몰톡 헬창: talk >= 2 && total >= 38
 * 5) 펌프 중독자: pump >= 2 && total >= 36
 * 6) 근육 태토남: frame >= 1 && total >= 35 && newbie <= 1
 * 7) 근육 에겐남: egennam >= 2 && total >= 34 && heavy <= 2
 * 8) 귀여운 헬린이: newbie >= 2 && total >= 30 && total <= 39
 * 9) 관리형 헬스러: manage >= 2 && total >= 32 && total <= 42
 * 10) 건강 현실파: 위에 해당 없음 또는 total <= 29
 */
export function getResultId(answers: AnswersMap): ResultId {
  const total = calculateTotal(answers);
  const t = calculateTagScores(answers);

  if (total >= 52 && t.heavy >= 3) return "heavy_ss";
  if (total >= 47 && t.heavy >= 2) return "senior";
  if (t.routine >= 2 && total >= 40) return "routine";
  if (t.talk >= 2 && total >= 38) return "talk";
  if (t.pump >= 2 && total >= 36) return "pump";
  if (t.frame >= 1 && total >= 35 && t.newbie <= 1) return "frame";
  if (t.egennam >= 2 && total >= 34 && t.heavy <= 2) return "egennam";
  if (t.newbie >= 2 && total >= 30 && total <= 39) return "newbie";
  if (t.manage >= 2 && total >= 32 && total <= 42) return "manage";
  return "reality";
}

/** 상위 태그 2개 반환 (점수 내림차순, 0 제외) */
export function getTopTags(tags: TagScores): { tag: TagId; score: number }[] {
  const entries = (Object.entries(tags) as [keyof TagScores, number][])
    .filter(([, score]) => score > 0)
    .map(([tag, score]) => ({ tag, score }))
    .sort((a, b) => b.score - a.score);
  return entries.slice(0, 2);
}

/** 태그 한글 라벨 (결과 페이지 설명용) */
export const TAG_LABELS: Record<TagId, string> = {
  heavy: "중증 헬창",
  routine: "루틴 집착",
  talk: "스몰톡",
  pump: "펌프/거울",
  manage: "관리/식단",
  newbie: "헬린이 감성",
  frame: "프레임/태토",
  egennam: "에겐남",
};
