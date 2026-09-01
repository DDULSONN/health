export const OPEN_CARD_ACTIVITY_WINDOW_DAYS = 14;
export const OPEN_CARD_ACTIVITY_GRACE_HOURS = 72;
export const OPEN_CARD_DORMANT_QUEUE_PRIORITY_ISO = "9999-12-31T23:59:59.999Z";

export type OpenCardActivityDecision = "none" | "send_notice" | "defer" | "restore";

type OpenCardActivityState = {
  nowMs: number;
  lastActivityAt: string | null;
  noticeSentAt: string | null;
  noticeBaselineAt: string | null;
  deferredAt: string | null;
};

function toTime(value: string | null | undefined) {
  const time = Date.parse(String(value ?? ""));
  return Number.isFinite(time) ? time : null;
}

export function latestActivityIso(...values: Array<string | null | undefined>) {
  let latestTime: number | null = null;
  let latestValue: string | null = null;

  for (const value of values) {
    const time = toTime(value);
    if (time == null || (latestTime != null && time <= latestTime)) continue;
    latestTime = time;
    latestValue = new Date(time).toISOString();
  }

  return latestValue;
}

export function getOpenCardActivityDecision(state: OpenCardActivityState): OpenCardActivityDecision {
  const lastActivityMs = toTime(state.lastActivityAt);
  const noticeSentMs = toTime(state.noticeSentAt);
  const noticeBaselineMs = toTime(state.noticeBaselineAt);
  const recentCutoffMs = state.nowMs - OPEN_CARD_ACTIVITY_WINDOW_DAYS * 24 * 60 * 60 * 1000;

  // Any activity after the reminder's captured baseline starts a fresh cycle.
  // A currently deferred card also recovers when the member becomes recently active.
  const activityAfterNotice =
    noticeSentMs != null &&
    lastActivityMs != null &&
    lastActivityMs > (noticeBaselineMs ?? noticeSentMs);
  const isRecentlyActive = lastActivityMs != null && lastActivityMs >= recentCutoffMs;
  if (activityAfterNotice || (state.deferredAt && isRecentlyActive)) return "restore";

  if (noticeSentMs == null) return isRecentlyActive ? "none" : "send_notice";
  if (state.deferredAt) return "none";

  const graceMs = OPEN_CARD_ACTIVITY_GRACE_HOURS * 60 * 60 * 1000;
  return state.nowMs - noticeSentMs >= graceMs ? "defer" : "none";
}
