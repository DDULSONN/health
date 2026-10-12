// Status copy contains no profile, contact details, or unverified deletion claims.
export type OneOnOneStatusNotice = { title: string; body: string };
export const ONE_ON_ONE_NOTICE_TYPES = [
  "dating_1on1_selection_received", "dating_1on1_match_accepted", "dating_1on1_match_canceled",
  "dating_1on1_contact_nudge", "dating_1on1_contact_exchanged",
];
export function oneOnOneEndedNotice(reason: unknown, role?: string): OneOnOneStatusNotice | null {
  switch (reason) {
    case "source_skipped": return { title: "철회된 1:1 요청", body: role === "source"
      ? "내가 보낸 요청을 철회해 더 이상 응답을 기다리지 않아요."
      : "요청을 보낸 상대가 철회해 받은 요청 목록에서 빠졌어요. 이미 받은 문자·메일은 그대로 남을 수 있어요." };
    case "candidate_rejected": return { title: "종료된 1:1 요청", body: role === "candidate"
      ? "내가 거절한 요청이에요. 더 이상 수락을 기다리는 요청이 아니에요."
      : "상대가 요청을 거절해 이번 매칭이 종료됐어요." };
    case "source_declined": return { title: "종료된 1:1 요청", body: role === "source"
      ? "내가 최종 수락을 하지 않아 이번 매칭이 종료됐어요."
      : "상대가 최종 수락을 하지 않아 이번 매칭이 종료됐어요." };
    case "admin_canceled": return { title: "취소된 1:1 매칭", body: "매칭이 취소되어 더 이상 진행할 수 없어요. 취소 전에 받은 문자·메일은 그대로 남을 수 있어요." };
    case "account_deleted": return { title: "상대 회원이 탈퇴했어요", body: "상대 회원의 탈퇴로 관련 프로필과 매칭 내역이 삭제됐어요. 탈퇴 전에 받은 문자·메일은 그대로 남을 수 있어요." };
    case "profile_deleted": return { title: "프로필이 삭제된 매칭", body: "이 매칭에 연결된 프로필이 삭제되어 더 이상 진행할 수 없어요. 삭제 전에 받은 문자·메일은 그대로 남을 수 있어요." };
    case "removed": return { title: "삭제된 1:1 매칭 내역", body: "이 알림에 연결된 매칭 내역이 삭제됐어요. 남아 있는 기록으로는 정확한 삭제 사유를 확인할 수 없어요." };
    default: return null;
  }
}
export function oneOnOneLookupNotice(): OneOnOneStatusNotice {
  return { title: "1:1 상태 확인 필요", body: "최신 상태를 불러오지 못했어요. 요청이 취소되거나 삭제됐다는 뜻은 아니에요. 잠시 후 다시 확인해 주세요." };
}
export function oneOnOneCurrentNotice(match: { state?: string; contact_exchange_status?: string }, role: string): OneOnOneStatusNotice | null {
  const ended = oneOnOneEndedNotice(match.state, role);
  if (ended) return ended;
  if (match.contact_exchange_status === "canceled") return oneOnOneEndedNotice("admin_canceled", role);
  if (["approved", "exchanged"].includes(match.contact_exchange_status ?? ""))
    return { title: "연락처를 교환한 매칭", body: "이미 연락처 교환이 완료된 매칭이에요. 받은 요청이 아닌 매칭 내역에서 확인해 주세요." };
  if (match.state === "mutual_accepted")
    return { title: "서로 수락한 1:1 매칭", body: "이미 서로 수락해 받은 요청 목록에서 진행 중인 매칭으로 이동했어요." };
  if (match.state === "candidate_accepted")
    return { title: "최종 수락을 기다리는 매칭", body: "수락 이후 최종 확인 단계에 있어요. 매칭 내역에서 현재 상태를 확인해 주세요." };
  return null;
}
