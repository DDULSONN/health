export const WEEKDAY_BASE_APPLY_LIMIT = 2;
export const WEEKEND_BASE_APPLY_LIMIT = 3;

export function getKstDateString(now = new Date()): string {
  const kstMs = now.getTime() + 9 * 60 * 60 * 1000;
  return new Date(kstMs).toISOString().slice(0, 10);
}

export function isKoreanWeekend(now = new Date()): boolean {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    weekday: "short",
  }).format(now);
  return weekday === "Sat" || weekday === "Sun";
}

export function getDailyBaseApplyLimit(now = new Date()): number {
  return isKoreanWeekend(now) ? WEEKEND_BASE_APPLY_LIMIT : WEEKDAY_BASE_APPLY_LIMIT;
}
