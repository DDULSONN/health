// Fixed release window, shared by all visitors. Never restart this timer per visit.
export const SITE_ANNOUNCEMENT = {
  id: "one-on-one-repeat-repair-2026-10-12",
  startsAt: "2026-10-12T19:30:00+09:00",
  endsAt: "2026-10-14T19:30:00+09:00",
  title: "1:1 후보 반복 오류 수정",
  message: "일부 계정에서 새로고침 후에도 같은 후보가 반복되는 문제를 수정했어요. 재추천을 완료한 회원께는 별도로 안내드려요. 기존 매칭 내역은 그대로예요. 이용에 불편을 드려 죄송합니다.",
} as const;

export function isSiteAnnouncementActive(nowMs = Date.now()) {
  return nowMs >= Date.parse(SITE_ANNOUNCEMENT.startsAt) && nowMs < Date.parse(SITE_ANNOUNCEMENT.endsAt);
}
