// Fixed release window, shared by all visitors. Never restart this timer per visit.
export const SITE_ANNOUNCEMENT = {
  id: "one-on-one-extra-locality-2026-10-04",
  startsAt: "2026-10-04T12:00:00+09:00",
  endsAt: "2026-10-06T12:00:00+09:00",
  title: "1:1 추가 후보 추천을 개선했어요",
  message: "가까운 지역과 나이가 맞는 후보가 있는데도 먼 지역의 추가 후보가 나오던 경우를 보완했어요. 페이지를 새로 열면 반영되며, 새로고침 횟수는 차감되지 않아요.",
} as const;

export function isSiteAnnouncementActive(nowMs = Date.now()) {
  return nowMs >= Date.parse(SITE_ANNOUNCEMENT.startsAt) && nowMs < Date.parse(SITE_ANNOUNCEMENT.endsAt);
}
