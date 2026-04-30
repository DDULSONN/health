type PushAndEmailNotification = {
  pushTitle: string;
  pushBody: string;
  emailSubject: string;
  emailText: string;
};

function safeNickname(value: string | null | undefined, fallback: string) {
  const trimmed = String(value ?? "").trim();
  return trimmed || fallback;
}

export function buildDatingApplicationReceivedNotification(applicantDisplayNickname: string): PushAndEmailNotification {
  const nickname = safeNickname(applicantDisplayNickname, "회원");

  return {
    pushTitle: "새 지원이 도착했어요",
    pushBody: `${nickname}님이 오픈카드에 지원했어요.`,
    emailSubject: "오픈카드에 새 지원이 도착했어요",
    emailText: `${nickname}님이 오픈카드에 지원했어요.\n마이페이지에서 지원 내용을 확인해 주세요.`,
  };
}

export function buildDatingApplicationAcceptedNotification(cardDisplayNickname: string): PushAndEmailNotification {
  const nickname = safeNickname(cardDisplayNickname, "오픈카드");

  return {
    pushTitle: "지원이 수락됐어요",
    pushBody: `${nickname} 지원이 수락됐어요.`,
    emailSubject: "오픈카드 지원이 수락됐어요",
    emailText: `${nickname} 지원이 수락됐어요.\n마이페이지에서 연결 상태와 다음 안내를 확인해 주세요.`,
  };
}

export function buildOneOnOneSelectionReceivedNotification(
  sourceName: string,
  candidateName: string
): PushAndEmailNotification {
  const source = safeNickname(sourceName, "상대");
  const candidate = safeNickname(candidateName, "내 카드");

  return {
    pushTitle: "1:1 소개팅 요청이 도착했어요",
    pushBody: `${source}님이 ${candidate} 카드에 관심을 보냈어요.`,
    emailSubject: "1:1 소개팅 요청이 도착했어요",
    emailText: `${source}님이 ${candidate} 카드에 관심을 보냈어요.\n마이페이지에서 수락 또는 거절을 진행해 주세요.`,
  };
}

export function buildOneOnOneAcceptedNotification(counterpartyName: string): PushAndEmailNotification {
  const name = safeNickname(counterpartyName, "상대");

  return {
    pushTitle: "1:1 소개팅 요청이 수락됐어요",
    pushBody: `${name}님과 번호 교환 요청 단계로 이어졌어요.`,
    emailSubject: "1:1 소개팅 요청이 수락됐어요",
    emailText: `${name}님이 1:1 소개팅 요청을 수락했어요.\n마이페이지에서 번호 교환 요청과 다음 안내를 확인해 주세요.`,
  };
}
