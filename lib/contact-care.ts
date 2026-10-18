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
};
export const CONTACT_CARE_MESSAGES: Record<string, string> = {
  CARE_ONCE: "이미 신청 중이거나 교환권을 받은 내역이 있어요. 지급은 계정당 한 번만 가능해요.",
  CARE_WAIT: "무응답 신청은 첫 연락 후 24시간이 지나야 가능해요. 연락 시각도 확인해 주세요.",
  CARE_DEADLINE: "번호교환 후 72시간의 신청 기간이 지났어요. 다른 문제가 있다면 고객센터로 문의해 주세요.",
  CARE_SUPPLEMENT: "추가 자료 제출 기간이 지났어요. 고객센터로 문의해 주세요.",
  CARE_UPLOAD: "대화 캡처 1~3장을 첨부해 주세요. 업로드가 완료되지 않았다면 다시 확인해 주세요.",
  CARE_RATE: "오늘 업로드 시도가 많아요. 고객센터로 문의해 주세요.",
  CARE_PAYMENT: "본인이 결제한 정상 결제 건인지 다시 확인해 주세요. 취소·환불된 결제는 대상이 아니에요.",
  CARE_INACTIVE: "현재 신규 신청 대상이 아니에요. 시범 운영 시작 후 결제한 건만 신청할 수 있어요.",
  CARE_INPUT: "입력 내용을 확인해 주세요.",
  CARE_ADMIN: "관리자 권한을 확인해 주세요.",
  CARE_EVIDENCE: "첨부 캡처와 신청 사유에 맞는 증빙을 먼저 확인해 주세요.",
  CARE_REVIEWED: "이미 처리된 신청이에요. 목록을 새로 불러와 주세요.",
  CARE_NO_CREDIT: "사용 가능한 교환권이 없어요. 사용 내역을 확인해 주세요.",
  CARE_MATCH_CHANGED: "이미 교환했거나 매칭 상태가 바뀌었어요. 교환권은 차감하지 않았어요.",
  CARE_CHECKOUT: "이 매칭에 진행 중인 결제가 있어요. 중복 교환 방지를 위해 고객센터에 확인해 주세요. 교환권은 유지돼요.",
  CARE_ALREADY_EXCHANGED: "교환권으로 이미 번호를 교환한 매칭이에요. 마이페이지를 확인해 주세요.",
  CARE_PLUS: "기존 플러스로 무료 교환이 가능해요. 원래 교환 버튼을 이용하면 교환권은 남아 있어요.",
  CARE_STORE: "앱 내 결제 이력이 있어 고객센터 확인이 필요해요. 교환권은 유지돼요.",
  CARE_BLOCKED: "현재 이 상대와 번호를 교환할 수 없어요. 교환권은 유지돼요.",
  CARE_UNAVAILABLE: "현재 신청 또는 교환 조건을 확인할 수 없어요. 고객센터에 문의해 주세요.",
};
