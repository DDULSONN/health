/** 모더레이션: 금칙어 필터 + rate limit 체크 */

const BANNED_WORDS = [
  "시발", "씨발", "병신", "지랄", "미친놈", "미친년",
  "ㅅㅂ", "ㅂㅅ", "ㅈㄹ", "ㅆㅂ",
];

const CONTACT_BANNED_PATTERNS = [
  /카[카톡]+/i,
  /카[카]?톡/i,
  /kakao/i,
  /카카오/i,
  /인스타/i,
  /instagram/i,
  /insta/i,
  /오픈채팅/i,
  /open\.kakao/i,
  /텔레그램/i,
  /telegram/i,
  /010[\s\-]?\d{4}[\s\-]?\d{4}/,
  /01[16789][\s\-]?\d{3,4}[\s\-]?\d{4}/,
  /라인\s?아이디/i,
  /line\s?id/i,
];

export function containsContactInfo(text: string): boolean {
  return CONTACT_BANNED_PATTERNS.some((p) => p.test(text));
}

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
