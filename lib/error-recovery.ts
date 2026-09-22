export type RecoveryContext = {
  area: string;
  canRetry: boolean;
  description: string;
  reviewHref?: string;
  reviewLabel?: string;
};
export function getErrorRecoveryContext(pathname: string): RecoveryContext {
  // Do not replay payment/auth callbacks or action pages by remounting them.
  if (/^\/payments(?:\/|$)/.test(pathname)) return {
    area: "결제", canRetry: false,
    description: "결제 결과를 이 화면에서 확인하지 못했어요. 다시 결제하기 전에 내 결제 내역을 확인해 주세요.",
    reviewHref: "/mypage?section=payment", reviewLabel: "결제 내역 확인",
  };
  if (/^\/(?:auth|verify-email|login|signup|account-deletion)(?:\/|$)/.test(pathname)) return {
    area: "계정", canRetry: false, description: "계정 처리 결과를 확인한 뒤 다시 진행해 주세요. 같은 요청을 자동으로 보내지 않아요.",
    reviewHref: "/login", reviewLabel: "로그인 화면으로",
  };
  if (pathname === "/onboarding/dating") return {
    area: "프로필 작성", canRetry: false,
    description: "등록을 눌렀다면 내 프로필에서 저장 여부를 먼저 확인해 주세요. 임시저장된 글은 그대로 두며, 사진은 다시 선택해야 할 수 있어요.",
    reviewHref: "/mypage?section=matching", reviewLabel: "내 프로필 확인",
  };
  if (pathname === "/phone-verification") return {
    area: "휴대폰 인증", canRetry: true,
    description: "인증 화면을 다시 불러올 수 있어요. 인증 문자는 자동으로 재발송하지 않아요.",
  };
  if (["/", "/landing", "/community/dating/cards", "/mypage", "/notifications"].includes(pathname)) return {
    area: pathname === "/mypage" ? "마이페이지" : pathname === "/notifications" ? "알림" : "매칭 홈",
    canRetry: true,
    description: "잠시 후 화면을 다시 불러와 주세요. 결제나 지원 버튼을 누른 직후라면 내역을 먼저 확인해 주세요.",
    reviewHref: "/mypage?section=matching", reviewLabel: "내 매칭 확인",
  };
  return {
    area: "사이트", canRetry: false,
    description: "요청을 자동으로 다시 보내지 않았어요. 처리 중이었다면 내역을 확인한 뒤 다시 이용해 주세요.",
    reviewHref: "/mypage", reviewLabel: "마이페이지로",
  };
}
export function getSafeErrorDigest(error: { digest?: string }): string {
  return typeof error.digest === "string" && /^[a-zA-Z0-9_-]{4,80}$/.test(error.digest) ? error.digest : "";
}
export function recoverySupportText(reference: string, area: string, time: string) {
  // Never include location.href/search, error.message/stack or user data.
  return ["짐툴 화면 오류 문의", "문의 코드: " + reference, "화면: " + area, "발생 시각: " + time,
    "어떤 버튼을 누른 뒤 발생했는지 알려 주세요. 비밀번호·인증번호·전화번호는 보내지 마세요."].join("\n");
}
