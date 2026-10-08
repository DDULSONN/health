// Display-only helpers. Never use these labels to authorize a match action.
type MatchDisplayState = {
  role?: "source" | "candidate";
  state?: string;
  contact_exchange_status?: string;
};

export function isIncomingOneOnOneRequest(match: MatchDisplayState) {
  return match.role === "candidate" && match.state === "source_selected";
}

export function getOneOnOneMatchLabel(match: MatchDisplayState) {
  const { role, state } = match;
  if (state === "proposed") return "추천받은 후보";
  if (state === "source_selected") {
    return role === "source" ? "상대 응답 대기" : role === "candidate" ? "내 수락 대기" : "응답 대기";
  }
  if (state === "candidate_accepted") {
    return role === "source" ? "내 수락 대기" : role === "candidate" ? "상대 확인 대기" : "수락 확인 대기";
  }
  if (state === "mutual_accepted") return "서로 수락 완료";
  if (state === "candidate_rejected") return role === "candidate" ? "내가 거절한 요청" : role === "source" ? "상대가 거절한 요청" : "거절된 요청";
  if (state === "source_declined") return role === "source" ? "내가 거절한 요청" : role === "candidate" ? "상대가 거절한 요청" : "거절된 요청";
  if (state === "source_skipped") return role === "source" ? "내가 취소한 요청" : role === "candidate" ? "상대가 취소한 요청" : "취소된 요청";
  if (state === "admin_canceled") return "종료된 매칭";
  return "진행 상태 확인";
}

export function getOneOnOneActionSummary(matches: readonly MatchDisplayState[]) {
  const groups = [
    { label: "받은 요청", count: 0 },
    { label: "내 수락 대기", count: 0 },
    { label: "연락처 교환 대기", count: 0 },
    { label: "상대 응답 대기", count: 0 },
    { label: "상대 확인 대기", count: 0 },
    { label: "추천받은 후보", count: 0 },
  ];
  for (const match of matches) {
    if (isIncomingOneOnOneRequest(match)) groups[0].count++;
    else if (match.state === "candidate_accepted" && match.role === "source") groups[1].count++;
    else if (match.state === "mutual_accepted" && match.contact_exchange_status === "awaiting_applicant_payment") groups[2].count++;
    else if (match.state === "source_selected" && match.role === "source") groups[3].count++;
    else if (match.state === "candidate_accepted" && match.role === "candidate") groups[4].count++;
    else if (match.state === "proposed" && match.role === "source") groups[5].count++;
  }
  const visible = groups.filter((group) => group.count > 0);
  return {
    primary: visible[0] ?? groups[0],
    detail: visible.map((group) => `${group.label} ${group.count}건`).join(" · ") || "대기 중인 요청 없음",
    otherDetail: visible.slice(1).map((group) => `${group.label} ${group.count}건`).join(" · "),
  };
}

export function buildOneOnOneRequestSentMessage(name?: string | null) {
  const cleanName = typeof name === "string" ? name.replace(/[\r\n\t]+/g, " ").trim().slice(0, 30) : "";
  return `${cleanName ? `${cleanName}님에게` : "상대에게"} 매칭 요청을 보냈어요. 진행 상황은 매칭 내역에서 확인할 수 있어요.`;
}
