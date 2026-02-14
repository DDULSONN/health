const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function toKstDate(now: Date): Date {
  return new Date(now.getTime() + KST_OFFSET_MS);
}

function fromKstDate(kstDate: Date): Date {
  return new Date(kstDate.getTime() - KST_OFFSET_MS);
}

export function getKstWeekRange(now = new Date()) {
  const kstNow = toKstDate(now);
  const day = kstNow.getUTCDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;

  const startKst = new Date(kstNow);
  startKst.setUTCDate(kstNow.getUTCDate() + diffToMonday);
  startKst.setUTCHours(0, 0, 0, 0);

  const endKst = new Date(startKst.getTime() + WEEK_MS);
  const startUtc = fromKstDate(startKst);
  const endUtc = fromKstDate(endKst);

  return {
    startUtc,
    endUtc,
    startUtcIso: startUtc.toISOString(),
    endUtcIso: endUtc.toISOString(),
  };
}

export function getPreviousKstWeekRange(now = new Date()) {
  const currentWeek = getKstWeekRange(now);
  const endUtc = currentWeek.startUtc;
  const startUtc = new Date(endUtc.getTime() - WEEK_MS);

  return {
    startUtc,
    endUtc,
    startUtcIso: startUtc.toISOString(),
    endUtcIso: endUtc.toISOString(),
  };
}

export function formatKstDateTime(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}
