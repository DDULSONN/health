import { normalizeOneOnOneMatchId, oneOnOneMatchHref } from "@/lib/dating-1on1-match-navigation";

function matchEmailFooter(matchId?: string) {
  return `\n${normalizeOneOnOneMatchId(matchId) ? `https://helchang.com${oneOnOneMatchHref(matchId)}\n` : ""}안내 발송 후 취소·탈퇴 등으로 상태가 달라질 수 있어요. 링크에서 현재 상태를 확인해 주세요.`;
}
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

export function buildDatingApplicationReceivedNotification(
  applicantDisplayNickname: string
): PushAndEmailNotification {
  const nickname = safeNickname(applicantDisplayNickname, "회원");

  return {
    pushTitle: "오픈카드에 새 지원이 도착했어요",
    pushBody: `${nickname}님이 오픈카드에 지원했어요.`,
    emailSubject: "오픈카드에 새 지원이 도착했어요",
    emailText: `${nickname}님이 오픈카드에 지원했어요.\n마이페이지에서 지원 내역을 확인해 주세요.`,
  };
}

export function buildDatingApplicationAcceptedNotification(
  cardDisplayNickname: string
): PushAndEmailNotification {
  const nickname = safeNickname(cardDisplayNickname, "오픈카드");

  return {
    pushTitle: "오픈카드 지원이 수락됐어요",
    pushBody: `${nickname} 지원이 수락됐어요.`,
    emailSubject: "오픈카드 지원이 수락됐어요",
    emailText: `${nickname} 지원이 수락됐어요.\n마이페이지에서 연결 상태와 다음 안내를 확인해 주세요.`,
  };
}

export function buildOneOnOneSelectionReceivedNotification(
  sourceName: string,
  candidateName: string,
  matchId?: string,
): PushAndEmailNotification {
  const source = safeNickname(sourceName, "상대");
  const candidate = safeNickname(candidateName, "내 카드");

  return {
    pushTitle: "1:1 소개팅 요청이 도착했어요",
    pushBody: `${source}님이 ${candidate} 카드에 관심을 보냈어요.`,
    emailSubject: "1:1 소개팅 요청이 도착했어요",
    emailText: `${source}님이 ${candidate} 카드에 관심을 보냈어요.\n마이페이지에서 수락 또는 거절을 진행해 주세요.${matchEmailFooter(matchId)}`,
  };
}

export function buildOneOnOneAcceptedNotification(counterpartyName: string, matchId?: string): PushAndEmailNotification {
  const name = safeNickname(counterpartyName, "상대");

  return {
    pushTitle: "1:1 소개팅 요청이 수락됐어요",
    pushBody: `${name}님과 번호 교환 단계로 이어졌어요.`,
    emailSubject: "1:1 소개팅 요청이 수락됐어요",
    emailText: `${name}님이 1:1 소개팅 요청을 수락했어요.\n마이페이지에서 번호 교환 요청과 다음 안내를 확인해 주세요.${matchEmailFooter(matchId)}`,
  };
}
