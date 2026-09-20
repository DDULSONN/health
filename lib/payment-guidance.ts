import { normalizeDatingApplyReturn } from "@/lib/dating-apply-return";

export { PAYMENT_CARD_NOTICE } from "@/lib/payment-card-notice";

export function normalizeFailureOrderId(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z0-9_-]{6,64}$/.test(value) ? value : null;
}

export function normalizePaymentFailureCode(value: unknown): string {
  return typeof value === "string" && /^[A-Z][A-Z0-9_]{0,79}$/.test(value) ? value : "UNKNOWN";
}

export function getPaymentRecoveryAction(productType: string | null, options: { province?: string | null; returnTo?: string | null } = {}) {
  if (productType === "apply_credits") {
    const returnTo = normalizeDatingApplyReturn(options.returnTo);
    const query = returnTo ? `?${new URLSearchParams({ returnTo })}` : "";
    return { href: `/dating/apply-credits${query}`, label: "지원권 다시 충전하기", description: "지원권 화면에서 다른 카드로 결제를 다시 시작할 수 있어요." };
  }
  if (productType === "city_view") {
    const province = options.province?.trim().slice(0, 40);
    const query = province ? `?${new URLSearchParams({ province })}` : "";
    return { href: `/dating/nearby-view${query}`, label: "가까운 이상형 보기로 돌아가기", description: "선택한 지역을 확인하고 다른 카드로 다시 결제해 주세요." };
  }
  if (productType === "one_on_one_contact_exchange") {
    return { href: "/mypage?section=matching&match=one_on_one", label: "번호 교환으로 돌아가기", description: "매칭 상대를 확인하고 연락처 교환 버튼에서 다시 진행해 주세요." };
  }
  if (productType === "more_view") {
    return { href: "/dating/more-view", label: "열람 화면으로 돌아가기", description: "이용 상태를 확인한 뒤 다시 진행해 주세요." };
  }
  if (productType === "love_fortune_detail") {
    return { href: "/community/dating/cards", label: "오픈카드로 돌아가기", description: "작성 내용을 확인한 뒤 다시 진행해 주세요." };
  }
  // Paid-card drafts and subscription orders already have a validated recovery
  // flow in the payment center. Do not create a new card or charge on page load.
  return { href: "/mypage?section=payment", label: "결제센터에서 이어하기", description: "결제센터에서 구매 상태를 확인하고 '결제 이어하기'를 눌러 주세요." };
}
