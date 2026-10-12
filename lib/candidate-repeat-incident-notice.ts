// Incident handling only: no acquisition/return campaign and no new entitlement.
export const REPEAT_INCIDENT_CAMPAIGN = "candidate-repeat-historical-incident-2026-10-12";
export const REPEAT_INCIDENT_SUBJECT = "[짐툴] 1:1 후보 반복 문제 수정 안내";
export const REPEAT_INCIDENT_BODY = [
  "안녕하세요, 짐툴입니다.", "",
  "1:1 후보를 새로고침해도 같은 후보가 반복되는 문제로 불편을 드려 죄송합니다.", "",
  "이전 배포 이력과 남아 있는 1:1 새로고침 기록을 함께 점검해, 수정 전 추천 방식의 영향을 받았을 가능성이 있는 이용자께 오류 처리 내용을 안내드립니다. 과거 화면 기록이 충분하지 않아 회원님 계정에서 같은 문제가 발생했다고 단정하는 것은 아닙니다.", "",
  "수정한 내용",
  "· 실제로 화면에서 확인한 후보 기록을 반영해, 조건에 맞는 아직 보지 않은 후보를 먼저 추천하도록 보강했습니다.",
  "· 추천 후보와 추가 후보의 순서만 바뀌고 새로 들어오는 사람이 없으면 새로고침 횟수를 차감하지 않도록 했습니다.", "",
  "기존 매칭 요청·수락 내역, 연락처 교환 내역, 플러스 이용 기간은 변경하지 않았습니다. 이 안내 때문에 결제하거나 프로필을 다시 등록하실 필요는 없습니다.", "",
  "수정 전에 열어둔 화면이 있다면 브라우저의 페이지 새로고침으로 최신 화면을 불러올 수 있습니다. 이는 화면 안의 ‘후보 새로고침’ 버튼과 다릅니다.", "",
  "같은 문제가 계속되면 이 메일에 답장으로 닉네임과 발생 시각을 알려주세요. 확인 후 안내드리겠습니다. 비밀번호나 휴대폰 인증번호를 보내실 필요는 없습니다.", "",
  "본 메일은 과거 1:1 후보 새로고침 관련 기록을 바탕으로 보내드리는 오류 처리 안내입니다.",
  "이용에 불편을 드린 점 다시 한번 사과드립니다.", "짐툴 드림",
].join("\n");

export function isPriorRepeatIncidentNotice(row: { campaign_key?: string; subject?: string }) {
  const campaign = row.campaign_key ?? "", subject = row.subject ?? "";
  return campaign === REPEAT_INCIDENT_CAMPAIGN || /nearby-variety-repair|candidate-repeat|refresh.*(?:fix|repair|incident)/i.test(campaign)
    || /(?:후보|추천|새로고침).*(?:반복|중복)/.test(subject);
}

type HistoricalCard = { id: string; user_id: string; created_at: string; recommendation_refresh_used_at: string | null; status: string };
type HistoricalEvent = { id: number | string; user_id: string; card_id: string; refreshed_at: string; compensation_campaign?: string | null };
export type HistoricalRefreshEvidence = {
  userId: string; firstAt: string; lastAt: string; eventCount: number;
  eventIds: (string | number)[]; cardIds: string[]; legacyCardIds: string[];
};

// Broad *possible* impact cohort, not proof that any individual's screen repeated.
// Do not use signup/profile creation alone, active status, or a last-seven-days cap.
export function historicalRefreshEvidence(cards: HistoricalCard[], events: HistoricalEvent[], start: string, end: string) {
  const from = Date.parse(start), until = Date.parse(end);
  if (!Number.isFinite(from) || !Number.isFinite(until) || from >= until) throw new Error("Invalid incident window");
  const cardById = new Map(cards.map(c => [c.id, c]));
  const byUser = new Map<string, HistoricalRefreshEvidence>();
  const inWindow = (value: string | null) => value != null && Number.isFinite(Date.parse(value)) && Date.parse(value) >= from && Date.parse(value) < until;
  const add = (userId: string, cardId: string, at: string, eventId?: string | number) => {
    if (!userId || !cardId) return;
    const row = byUser.get(userId) ?? { userId, firstAt: at, lastAt: at, eventCount: 0, eventIds: [], cardIds: [], legacyCardIds: [] };
    if (Date.parse(at) < Date.parse(row.firstAt)) row.firstAt = at;
    if (Date.parse(at) > Date.parse(row.lastAt)) row.lastAt = at;
    if (!row.cardIds.includes(cardId)) row.cardIds.push(cardId);
    if (eventId != null && !row.eventIds.includes(eventId)) { row.eventIds.push(eventId); row.eventCount++; }
    if (eventId == null && !row.legacyCardIds.includes(cardId)) row.legacyCardIds.push(cardId);
    byUser.set(userId, row);
  };
  for (const event of events) {
    if (!inWindow(event.refreshed_at) || event.compensation_campaign) continue;
    const card = cardById.get(event.card_id);
    if (card && card.user_id !== event.user_id) continue;
    add(event.user_id, event.card_id, event.refreshed_at, event.id);
  }
  for (const card of cards) {
    if (inWindow(card.recommendation_refresh_used_at) && Number.isFinite(Date.parse(card.created_at))
      && Date.parse(card.created_at) <= Date.parse(card.recommendation_refresh_used_at!)) {
      add(card.user_id, card.id, card.recommendation_refresh_used_at!);
    }
  }
  return [...byUser.values()].sort((a, b) => a.userId.localeCompare(b.userId));
}
