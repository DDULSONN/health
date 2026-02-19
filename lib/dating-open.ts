export const OPEN_CARD_LIMIT_MALE = 15;
export const OPEN_CARD_LIMIT_FEMALE = 20;
export const OPEN_CARD_EXPIRE_HOURS = 48;

export function getOpenCardLimitBySex(sex: "male" | "female"): number {
  return sex === "female" ? OPEN_CARD_LIMIT_FEMALE : OPEN_CARD_LIMIT_MALE;
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function getKstDayRangeUtc(now = new Date()): { startUtcIso: string; endUtcIso: string } {
  const kstNowMs = now.getTime() + KST_OFFSET_MS;
  const kstDayStartMs = Math.floor(kstNowMs / (24 * 60 * 60 * 1000)) * 24 * 60 * 60 * 1000;
  const startUtcMs = kstDayStartMs - KST_OFFSET_MS;
  const endUtcMs = startUtcMs + 24 * 60 * 60 * 1000;
  return {
    startUtcIso: new Date(startUtcMs).toISOString(),
    endUtcIso: new Date(endUtcMs).toISOString(),
  };
}

export function formatRemainingToKorean(expiresAtIso: string, now = new Date()): string {
  const diffMs = new Date(expiresAtIso).getTime() - now.getTime();
  if (diffMs <= 0) return "만료됨";

  const totalMinutes = Math.floor(diffMs / (60 * 1000));
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  if (days >= 1) return `${days}일 ${hours}시간 남음`;
  if (hours >= 1) return `${hours}시간 ${minutes}분 남음`;
  return `${Math.max(1, minutes)}분 남음`;
}
