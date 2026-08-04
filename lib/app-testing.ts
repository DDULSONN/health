export const APP_TEST_APPLICATION_TABLE = "app_test_applications";
export const APP_TEST_FEEDBACK_TABLE = "app_test_feedback";

export const APP_TEST_STATUSES = ["pending", "invited", "testing", "completed"] as const;
export type AppTestStatus = (typeof APP_TEST_STATUSES)[number];

export const APP_TEST_STATUS_LABELS: Record<AppTestStatus, string> = {
  pending: "초대 대기",
  invited: "초대 완료",
  testing: "테스트 중",
  completed: "참여 완료",
};

export const APP_TEST_FEEDBACK_CATEGORIES = ["general", "bug", "usability", "payment", "other"] as const;
export type AppTestFeedbackCategory = (typeof APP_TEST_FEEDBACK_CATEGORIES)[number];

export const APP_TEST_FEEDBACK_CATEGORY_LABELS: Record<AppTestFeedbackCategory, string> = {
  general: "전반적인 의견",
  bug: "오류 제보",
  usability: "사용성 개선",
  payment: "결제 관련",
  other: "기타",
};

export function isAppTestTableMissing(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String(error.code ?? "") : "";
  const message = "message" in error ? String(error.message ?? "").toLowerCase() : "";
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    message.includes("schema cache") ||
    ((message.includes(APP_TEST_APPLICATION_TABLE) || message.includes(APP_TEST_FEEDBACK_TABLE)) &&
      (message.includes("does not exist") || message.includes("could not find")))
  );
}
