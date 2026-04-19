export const DATING_CARD_REPORT_REASON_OPTIONS = [
  { code: "fake_profile", label: "허위 정보 / 사칭 의심" },
  { code: "explicit_content", label: "부적절한 사진 / 노출" },
  { code: "abuse_harassment", label: "욕설 / 괴롭힘 / 불쾌한 표현" },
  { code: "commercial_spam", label: "영업 / 광고 / 외부 유도" },
  { code: "safety_risk", label: "미성년 의심 / 안전상 위험" },
] as const;

export type DatingCardReportReasonCode = (typeof DATING_CARD_REPORT_REASON_OPTIONS)[number]["code"];

const DATING_CARD_REPORT_REASON_LABEL_MAP = new Map(
  DATING_CARD_REPORT_REASON_OPTIONS.map((item) => [item.code, item.label])
);

export function isDatingCardReportReasonCode(value: string): value is DatingCardReportReasonCode {
  return DATING_CARD_REPORT_REASON_LABEL_MAP.has(value as DatingCardReportReasonCode);
}

export function getDatingCardReportReasonLabel(code: DatingCardReportReasonCode) {
  return DATING_CARD_REPORT_REASON_LABEL_MAP.get(code) ?? "기타 신고";
}

export function buildDatingCardReportReasonText(code: DatingCardReportReasonCode, detail: string) {
  const label = getDatingCardReportReasonLabel(code);
  const trimmedDetail = detail.trim();
  if (!trimmedDetail) return label;
  return `${label}\n상세: ${trimmedDetail}`;
}
