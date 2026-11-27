export const ADMIN_OPERATION_ROWS = [
  { key: "paymentReview", label: "승인 후 교환 확인", unit: "건", hint: "최근 7일 · 현재 유효한 연결에서 번호 교환 완료가 확인되지 않은 매칭", href: "/mypage?section=admin&adminTab=payment_center" },
  { key: "agedCheckout", label: "오래된 결제 대기", unit: "건", hint: "최근 14일 내 생성 · 24시간 경과. 실제 청구 여부와는 별개예요.", href: "/mypage?section=admin&adminTab=payment_center" },
  { key: "checkoutHelp", label: "교환권 사용 문의", unit: "건", hint: "아직 처리하지 않은 결제창 관련 문의", href: "/mypage?section=admin&adminTab=one_on_one_contact" },
  { key: "vouchers", label: "교환권 보상 신청", unit: "건", hint: "검토 대기 및 추가 자료 요청 중", href: "/mypage?section=admin&adminTab=one_on_one_contact" },
  { key: "profileReview", label: "자동 프로필 검수", unit: "건", hint: "자동 검수 후 확인이 필요하거나 검수에 실패한 건", href: "/mypage?section=admin&adminTab=card_ai_review" },
  { key: "datingReports", label: "매칭 신고", unit: "건", hint: "아직 처리하지 않은 지원·1:1 신고", href: "/admin/dating/cards" },
  { key: "support", label: "고객 문의", unit: "건", hint: "아직 답변하지 않은 문의", href: "/admin/support" },
] as const;

export type AdminOperationKey = (typeof ADMIN_OPERATION_ROWS)[number]["key"];
export type AdminOperationCounts = Record<AdminOperationKey, number | null>;
