// Birth-year eligibility, shared by forms and server gates. This preserves the
// published 19+ policy (current KST year - 19), not exact birthday verification.
export const MIN_DATING_BIRTH_YEAR = 1960;
export const MIN_DATING_AGE = 19;
export const DATING_AGE_INELIGIBLE_MESSAGE = "1:1 매칭 이용 연령을 확인할 수 없는 프로필입니다. 출생연도를 확인하거나 고객센터에 문의해 주세요.";

export function getMaxDatingBirthYear(nowMs = Date.now()): number {
  return new Date(nowMs + 9 * 60 * 60 * 1000).getUTCFullYear() - MIN_DATING_AGE;
}

export function parseDatingBirthYear(value: unknown, nowMs = Date.now()): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !/^\d{4}$/.test(value.trim())) return null;
  const year = typeof value === "string" ? Number(value.trim()) : value;
  return Number.isInteger(year) && year >= MIN_DATING_BIRTH_YEAR && year <= getMaxDatingBirthYear(nowMs) ? year : null;
}

export function getDatingBirthYearErrorMessage(nowMs = Date.now()): string {
  return `만 ${MIN_DATING_AGE}세 이상만 이용할 수 있어요. 출생연도는 ${MIN_DATING_BIRTH_YEAR}~${getMaxDatingBirthYear(nowMs)}년 사이의 4자리 숫자로 입력해 주세요. 예: 1996`;
}
