/**
 * localStorage 유틸 (답변 저장/복원)
 * - 키: helchang_answers
 * - 서버 전송 없음, 브라우저에만 저장
 */

import type { AnswersMap } from "./types";

const STORAGE_KEY = "helchang_answers";

function isClient(): boolean {
  return typeof window !== "undefined";
}

/** 저장된 답변 불러오기 */
export function getStoredAnswers(): AnswersMap {
  if (!isClient()) return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, number>;
    const out: AnswersMap = {};
    for (const [k, v] of Object.entries(parsed)) {
      const num = parseInt(k, 10);
      if (num >= 1 && num <= 20 && (v === 1 || v === 2 || v === 3)) {
        out[num] = v as 1 | 2 | 3;
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** 답변 저장 */
export function setStoredAnswers(answers: AnswersMap): void {
  if (!isClient()) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(answers));
  } catch {
    // quota 등 무시
  }
}

/** 저장 초기화 (다시하기 시) */
export function clearStoredAnswers(): void {
  if (!isClient()) return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
