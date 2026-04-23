export const DATING_CHAT_REPORT_REASONS = [
  "욕설·비방",
  "성희롱·불쾌한 발언",
  "광고·홍보·사기 의심",
  "개인정보 요구·외부 유도",
  "기타 운영정책 위반",
] as const;

export type DatingChatReportReason = (typeof DATING_CHAT_REPORT_REASONS)[number];

export function isDatingChatReportReason(value: string): value is DatingChatReportReason {
  return (DATING_CHAT_REPORT_REASONS as readonly string[]).includes(value);
}
