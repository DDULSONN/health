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
    emailText: `${nickname}님이 오픈카드에 지원했어요.\n아래 링크에서 받은 지원을 확인해 주세요.\nhttps://helchang.com/mypage?section=matching#open-card-received`,
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
    emailText: `${nickname} 지원이 수락됐어요.\n아래 링크에서 연결 상태와 다음 안내를 확인해 주세요.\nhttps://helchang.com/mypage?section=matching#open-card-applied`,
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
    emailText: `${source}님이 ${candidate} 카드에 관심을 보냈어요.\n아래 링크에서 상대 프로필을 보고 수락 또는 거절할 수 있어요.${matchEmailFooter(matchId)}`,
  };
}

export function buildOneOnOneAcceptedNotification(counterpartyName: string, matchId?: string): PushAndEmailNotification {
  const name = safeNickname(counterpartyName, "상대");

  return {
    pushTitle: "1:1 소개팅 요청이 수락됐어요",
    pushBody: `${name}님과 번호 교환 단계로 이어졌어요.`,
    emailSubject: "1:1 소개팅 요청이 수락됐어요",
    emailText: `${name}님이 1:1 소개팅 요청을 수락했어요.\n아래 링크에서 두 분의 매칭 상태를 확인해 주세요.${matchEmailFooter(matchId)}`,
  };
}

export function buildOneOnOnePendingReminder(matchId: string, kind: "selection_pending_24h" | "mutual_pending_24h") {
  const selection = kind === "selection_pending_24h";
  return {
    emailSubject: selection ? "짐툴 · 아직 응답하지 않은 1:1 요청이 있어요" : "짐툴 · 서로 수락한 1:1 매칭을 확인해 주세요",
    emailText: selection
      ? "아직 응답하지 않은 1:1 요청이 있어요.\n받은 요청을 모아 보고, 마음에 드는 분에게 수락으로 답해 주세요.\n원하지 않는 요청은 거절할 수 있어요. 수락만으로 결제되지는 않아요.\nhttps://helchang.com/community/dating/cards?tab=one_on_one&focus=incoming#one-on-one-incoming\n안내 발송 후 취소·탈퇴 등으로 상태가 달라질 수 있어요. 링크에서 현재 상태를 확인해 주세요."
      : "서로 수락한 1:1 매칭이 아직 진행 중이에요.\n아래 링크에서 상대 프로필과 현재 상태를 확인할 수 있어요." + matchEmailFooter(matchId),
  };
}
