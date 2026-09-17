// Presentation only. Eligibility and consumption remain server-authoritative.
export type OneOnOneRefreshUsage = {
  refresh_limit?: number;
  refresh_remaining?: number;
  can_refresh?: boolean;
  next_refresh_at?: string | null;
};

export const ONE_ON_ONE_REFRESH_POLICY_COPY =
  "자정에 초기화되지 않아요. 사용한 횟수는 각각 24시간 후 다시 이용할 수 있어요.";

function count(value: unknown, minimum = 0): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum ? value : null;
}

export function formatOneOnOneNextRefresh(value?: string | null): string | null {
  if (!value) return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  // Round UP to a whole second, so the displayed time never precedes eligibility.
  const date = new Date(Math.ceil(time / 1000) * 1000);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul", month: "numeric", day: "numeric",
    hour: "numeric", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  const hour = Number(part("hour"));
  // Some runtimes emit AM/PM even for ko-KR. Keep Korean wording consistent.
  return `${Number(part("month"))}. ${Number(part("day"))}. ${hour >= 12 ? "오후" : "오전"} ${hour % 12 || 12}:${part("minute")}:${part("second")}`;
}

export function getOneOnOneRefreshCopy(usage?: OneOnOneRefreshUsage | null) {
  const limit = count(usage?.refresh_limit, 1);
  const remaining = count(usage?.refresh_remaining)
    ?? (typeof usage?.can_refresh === "boolean" ? (usage.can_refresh ? 1 : 0) : null);
  const next = formatOneOnOneNextRefresh(usage?.next_refresh_at);
  return {
    button: usage?.can_refresh === true
      ? `후보 새로고침 · ${remaining ?? 1}회`
      : remaining === 0 ? "다음 이용 대기" : "이용 상태 확인 중",
    summary: remaining === null ? "새로고침 이용 상태를 불러오는 중이에요."
      : limit !== null ? `최근 24시간 기준 ${limit}회 중 ${remaining}회 남았어요.`
      : `새로고침 ${remaining}회 남았어요.`,
    next: remaining === 0
      ? next ? `다음 이용: ${next}부터 (한국 시간)`
        : "다음 이용 시각은 화면을 다시 불러와 확인해 주세요."
      : null,
  };
}

export function buildOneOnOneRefreshConfirmation(usage?: OneOnOneRefreshUsage | null) {
  const limit = count(usage?.refresh_limit, 1);
  const remaining = count(usage?.refresh_remaining)
    ?? (usage?.can_refresh === true ? 1 : null);
  const quota = remaining !== null && remaining > 0
    ? `사용 전 ${remaining}회 → 이번 사용 후 ${remaining - 1}회 남아요.`
    : "이용 가능 횟수는 요청 시 확인하며, 성공하면 1회가 사용돼요.";
  return ["후보 새로고침 1회를 사용할까요?", "", quota,
    limit !== null ? `최근 24시간 기준 최대 ${limit}회 이용할 수 있어요.` : "",
    ONE_ON_ONE_REFRESH_POLICY_COPY].filter((line, index) => line || index === 1).join("\n");
}

export function buildOneOnOneRefreshSuccess(usage: OneOnOneRefreshUsage) {
  // Only the POST response tells us the actual post-consumption balance.
  const remaining = count(usage.refresh_remaining);
  const next = formatOneOnOneNextRefresh(usage.next_refresh_at);
  return ["새로고침 1회를 사용했어요.",
    remaining !== null ? `사용 후 ${remaining}회 남았어요.` : "남은 횟수는 화면에서 확인해 주세요.",
    remaining === 0 ? next ? `다음 이용: ${next}부터 (한국 시간)`
      : "다음 이용 가능 시각은 화면에서 확인해 주세요." : "",
  ].filter(Boolean).join("\n");
}
