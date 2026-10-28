// Only the notice expires after 48 hours; friend recommendation stays available.
// Fixed release window, shared by all visitors. Never restart this timer per visit.
export const SITE_ANNOUNCEMENT = {
  id: "friend-recommendation-2026-10-28",
  startsAt: "2026-10-28T22:30:00+09:00",
  endsAt: "2026-10-30T22:30:00+09:00",
  title: "친구 추천 기능 안내",
  message: "오픈카드나 1:1 후보에서 ‘친구에게 추천’을 누르면, 프로필 링크를 만들어 친구에게 보낼 수 있어요. 원치 않으면 설정에서 끌 수 있어요.",
} as const;

export function isSiteAnnouncementActive(nowMs = Date.now()) {
  return nowMs >= Date.parse(SITE_ANNOUNCEMENT.startsAt) && nowMs < Date.parse(SITE_ANNOUNCEMENT.endsAt);
}
