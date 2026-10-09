// Fixed release window, shared by all visitors. Never restart this timer per visit.
export const SITE_ANNOUNCEMENT = {
  id: "one-on-one-candidate-expansion-2026-10-10",
  startsAt: "2026-10-10T00:45:00+09:00",
  endsAt: "2026-10-12T00:45:00+09:00",
  title: "1:1 후보를 더 확인해 보세요",
  message: "1:1에서 ‘후보 넓혀보기’를 누르면 하루 최대 3명을 더 확인할 수 있어요. 나이 조건은 유지하고 주변 지역까지 살펴봐요. 기존 추천은 그대로이며, 새로고침 횟수는 차감되지 않아요.",
} as const;

export function isSiteAnnouncementActive(nowMs = Date.now()) {
  return nowMs >= Date.parse(SITE_ANNOUNCEMENT.startsAt) && nowMs < Date.parse(SITE_ANNOUNCEMENT.endsAt);
}
