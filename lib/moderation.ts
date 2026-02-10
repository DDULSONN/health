/** 모더레이션: 금칙어 필터 + rate limit 체크 */

const BANNED_WORDS = [
  "시발", "씨발", "병신", "지랄", "미친놈", "미친년",
  "ㅅㅂ", "ㅂㅅ", "ㅈㄹ", "ㅆㅂ",
];

export function containsProfanity(text: string): boolean {
  const lower = text.toLowerCase();
  return BANNED_WORDS.some((w) => lower.includes(w));
}

/**
 * rate limit 체크용: 마지막 생성 시각과 현재 시각의 차이 계산
 * @returns 남은 대기 시간(ms). 0이면 통과.
 */
export function getRateLimitRemaining(
  lastCreatedAt: string | null,
  cooldownMs: number
): number {
  if (!lastCreatedAt) return 0;
  const elapsed = Date.now() - new Date(lastCreatedAt).getTime();
  return Math.max(0, cooldownMs - elapsed);
}
