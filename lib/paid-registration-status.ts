export const PAID_REGISTRATION_MANAGE_HREF = "/mypage?section=matching&match=received#paid-card-received";

export type PaidRegistrationCard = {
  id: string;
  status: string;
  display_mode: string | null;
  expires_at: string | null;
};

export function paidRegistrationPresentation(card: { status: string; display_mode?: string | null; expires_at: string | null }, now: number) {
  const expiresAt = card.expires_at ? Date.parse(card.expires_at) : NaN;
  const active = card.status === "approved" && Number.isFinite(expiresAt) && expiresAt > now;
  const minutes = active ? Math.max(1, Math.ceil((expiresAt - now) / 60_000)) : 0;
  return {
    active,
    product: card.display_mode === "instant_public" ? "대기 없이 등록" : "36시간 상단 고정",
    label: active ? "공개 중" : card.status === "expired" || (card.status === "approved" && Number.isFinite(expiresAt) && expiresAt <= now)
      ? "공개 종료" : card.status === "pending" ? "공개 전" : card.status === "rejected" ? "공개되지 않음" : "상태 확인 필요",
    remaining: active ? (minutes < 60 ? `${minutes}분 남음` : `${Math.floor(minutes / 60)}시간 ${minutes % 60}분 남음`) : "",
  };
}

export function parsePaidRegistrationStatus(value: unknown): { card: PaidRegistrationCard | null; checked_at: string } | null {
  if (!value || typeof value !== "object") return null;
  const data = value as { card?: PaidRegistrationCard | null; checked_at?: unknown };
  if (typeof data.checked_at !== "string" || !Number.isFinite(Date.parse(data.checked_at))) return null;
  if (data.card === null) return { card: null, checked_at: data.checked_at };
  const card = data.card;
  if (!card || typeof card.id !== "string" || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(card.id) ||
    typeof card.status !== "string" || !["instant_public", "priority_24h", null].includes(card.display_mode) ||
    (card.expires_at !== null && (typeof card.expires_at !== "string" || !Number.isFinite(Date.parse(card.expires_at))))) return null;
  return { card, checked_at: data.checked_at };
}
