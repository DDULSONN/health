export const CONTACT_CARE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type ContactCareClaim = {
  id: string; user_id: string; match_id: string; order_id: string;
  exchanged_at: string | null; counterparty_name: string | null;
  first_contact_at: string; explanation: string; reason: "no_response" | "scam";
  status: "pending" | "needs_info" | "approved" | "rejected";
  evidence_count: number; supplement_due_at: string | null;
  created_at: string; review_note: string | null; used_at: string | null; used_match_id: string | null;
};
export type ContactCareMatch = { id: string; name: string; order_id?: string; exchanged_at?: string };
export type ContactCareStatus = {
  active: boolean; starts_at: string | null; claim: ContactCareClaim | null;
  payments: ContactCareMatch[]; matches: ContactCareMatch[];
  manual_remaining?: number;
  manual_history?: { used_match_id: string; used_at: string }[];
};
export const CONTACT_CARE_MESSAGES: Record<string, string> = {
  CARE_ONCE: "이미 신청 중이거나 교환권을 받은 내역이 있어요. 지급은 계정당 한 번만 가능해요.",
  CARE_WAIT: "무응답 신청은 첫 연락 후 24시간이 지나야 가능해요. 연락 시각도 확인해 주세요.",
  CARE_DEADLINE: "번호교환 후 72시간의 신청 기간이 지났어요. 다른 문제가 있다면 고객센터로 문의해 주세요.",
  CARE_SUPPLEMENT: "추가 자료 제출 기간이 지났어요. 고객센터로 문의해 주세요.",
  CARE_UPLOAD: "대화 캡처 1~3장을 첨부해 주세요. 업로드가 완료되지 않았다면 다시 확인해 주세요.",
  CARE_RATE: "오늘 업로드 시도가 많아요. 고객센터로 문의해 주세요.",
  CARE_PAYMENT: "본인이 결제한 정상 결제 건인지 다시 확인해 주세요. 취소·환불된 결제는 대상이 아니에요.",
  CARE_INACTIVE: "현재 신규 신청을 받지 않아요. 기존 신청 내역은 유지돼요. 고객센터로 문의해 주세요.",
  CARE_INPUT: "입력 내용을 확인해 주세요.",
  CARE_ADMIN: "관리자 권한을 확인해 주세요.",
  CARE_EVIDENCE: "첨부 캡처와 신청 사유에 맞는 증빙을 먼저 확인해 주세요.",
  CARE_REVIEWED: "이미 처리된 신청이에요. 목록을 새로 불러와 주세요.",
  CARE_NO_CREDIT: "사용 가능한 교환권이 없어요. 사용 내역을 확인해 주세요.",
  CARE_MATCH_CHANGED: "이미 교환했거나 매칭 상태가 바뀌었어요. 교환권은 차감하지 않았어요.",
  CARE_CHECKOUT: "이전에 연 결제창의 종료 여부를 확인하고 있어요. 결제창을 닫아 주세요. 만료 확인 후 교환권을 사용할 수 있고, 교환권은 그대로 유지돼요. 오래 지속되면 고객센터로 문의해 주세요.",
  CARE_ALREADY_EXCHANGED: "교환권으로 이미 번호를 교환한 매칭이에요. 마이페이지를 확인해 주세요.",
  CARE_PLUS: "기존 플러스로 무료 교환이 가능해요. 원래 교환 버튼을 이용하면 교환권은 남아 있어요.",
  CARE_STORE: "앱 내 결제 이력이 있어 고객센터 확인이 필요해요. 교환권은 유지돼요.",
  CARE_BLOCKED: "현재 이 상대와 번호를 교환할 수 없어요. 교환권은 유지돼요.",
  CARE_UNAVAILABLE: "현재 신청 또는 교환 조건을 확인할 수 없어요. 고객센터에 문의해 주세요.",
};

// Client guidance only. The database independently rechecks every condition.
export function contactCareApplicationIssue(input: {
  selected?: ContactCareMatch; first: string; reason: string; explanation: string;
  evidenceCount: number; confirmed: boolean; stale: boolean;
  supplement?: { dueAt: string | null }; now: number;
}): string | null {
  if (input.stale) return "‘내역 다시 확인’을 누른 뒤 신청해 주세요.";
  if (!input.selected) return "신청할 결제 건을 선택해 주세요. 목록에 없으면 고객센터로 문의해 주세요.";
  const exchanged = Date.parse(input.selected.exchanged_at ?? "");
  if (!Number.isFinite(exchanged)) return "번호교환 시각을 확인하지 못했어요. 내역을 다시 확인해 주세요.";
  if (input.supplement) {
    const due = Date.parse(input.supplement.dueAt ?? "");
    if (!Number.isFinite(due) || input.now > due) return CONTACT_CARE_MESSAGES.CARE_SUPPLEMENT;
  } else if (input.now > exchanged + 72 * 3600000) return CONTACT_CARE_MESSAGES.CARE_DEADLINE;
  const first = Date.parse(input.first);
  if (!Number.isFinite(first)) return "첫 연락을 보낸 날짜와 시간을 입력해 주세요.";
  if (first < exchanged) return "첫 연락 시각은 번호교환 이후로 입력해 주세요.";
  if (first > input.now) return "첫 연락 시각이 미래로 입력되어 있어요. 다시 확인해 주세요.";
  if (input.reason === "no_response" && input.now < first + 24 * 3600000) {
    const available = first + 24 * 3600000;
    if (!input.supplement && available > exchanged + 72 * 3600000) {
      return "첫 연락 후 24시간을 기다리면 신청 기한이 지나요. 고객센터로 문의해 주세요.";
    }
    return `무응답 신청은 첫 연락 후 24시간부터 가능해요. ${new Date(available).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}부터 신청할 수 있어요.`;
  }
  if (input.explanation.trim().length < 10) return "연락 방법과 상황을 10자 이상 적어 주세요.";
  if (input.explanation.length > 500) return "연락 방법과 상황을 500자 이내로 적어 주세요.";
  if (input.evidenceCount < 1 || input.evidenceCount > 3) return "대화 캡처를 1~3장 첨부해 주세요.";
  if (!input.confirmed) return "제출 내용과 관리자 검토 안내를 확인하고 체크해 주세요.";
  return null;
}
