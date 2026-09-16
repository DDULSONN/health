// Fixed release window, shared by all visitors. Never restart this timer per visit.
export const SITE_ANNOUNCEMENT = {
  id: "one-on-one-recommendations-improved-2026-09-16",
  startsAt: "2026-09-16T12:50:00+09:00",
  endsAt: "2026-09-18T12:50:00+09:00",
  title: "1:1 매칭 후보 추천이 개선됐어요",
  message: "지역과 나이를 더 고려하고, 새로고침 시 후보가 반복되는 문제를 보완했어요.",
} as const;

export function isSiteAnnouncementActive(nowMs = Date.now()) {
  return nowMs >= Date.parse(SITE_ANNOUNCEMENT.startsAt) && nowMs < Date.parse(SITE_ANNOUNCEMENT.endsAt);
}
