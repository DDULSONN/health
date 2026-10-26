// Display labels only. Stored statuses and matching rules are unchanged.
export function openCardStatusLabel(status: string): string {
  switch (status) {
    case "public": return "공개 중";
    case "pending": return "공개 대기";
    case "expired": return "공개 종료";
    case "hidden": return "숨김";
    default: return "상태 확인 중";
  }
}
