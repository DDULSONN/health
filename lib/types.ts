/**
 * 앱 전역 타입 정의
 */

import type { AnswerValue } from "./questions";

/** 질문 번호(1~20)별 답변 */
export type AnswersMap = Partial<Record<number, AnswerValue>>;

/** 태그 이름 (스코어링에서 사용) */
export type TagId =
  | "heavy"
  | "routine"
  | "talk"
  | "pump"
  | "manage"
  | "newbie"
  | "frame"
  | "egennam";

/** 결과 유형 10종 */
export type ResultId =
  | "heavy_ss"      // 1) 중증 헬창
  | "senior"        // 2) 상급 헬창
  | "routine"       // 3) 루틴 집착러
  | "talk"          // 4) 스몰톡 헬창
  | "pump"          // 5) 펌프 중독자
  | "frame"         // 6) 근육 태토남
  | "egennam"       // 7) 근육 에겐남
  | "newbie"        // 8) 귀여운 헬린이
  | "manage"        // 9) 관리형 헬스러
  | "reality";      // 10) 건강 현실파

export interface TagScores {
  heavy: number;
  routine: number;
  talk: number;
  pump: number;
  manage: number;
  newbie: number;
  frame: number;
  egennam: number;
}
