// Deliberately deterministic: only whole-message FAQ matches may send a reply.
// Free text, policy disputes and mixed requests always go to an operator.
export const SUPPORT_AUTO_PREFIX = "[자동 안내]";
export const SUPPORT_AUTO_START = "2026-11-28T07:10:00.000Z";
export type SupportSource = { category: string; subject: string; message: string };
export type SupportTriage = { kind: "simple" | "important"; reason: string; summary: string; draft: string; topic: string };
const normalize = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[\s?!？！，,.。~ㅋㅎ:：]/g, "");
const topics = [
  { id: "profile_create", label: "프로필 등록 방법", re: /^(?:(?:1대1|11|오픈카드|소개팅)?프로필|소개글)(?:은|을|는)?(?:어떻게|어디서|어디에서)(?:등록|작성|올리)(?:하나요|해요|하면되나요|나요|면되나요|죠|는건가요)$/, answer: "사이트의 오픈카드 또는 1대1 화면에서 ‘프로필 작성하기’를 눌러 사진과 소개글을 입력해 주세요. 프로필 등록은 무료이며, 연락처 교환 등 일부 기능에는 별도 요금이 있습니다. 본인 사진과 실제 정보를 사용하고, 외부 연락처는 소개글에 적지 말아 주세요." },
  { id: "profile_edit", label: "프로필 수정 방법", re: /^(?:(?:1대1|11|오픈카드|소개팅)?프로필|소개글|프로필사진)(?:은|을|는)?(?:어떻게|어디서|어디에서)(?:수정|변경)(?:하나요|해요|하면되나요|하죠|할수있나요)$/, answer: "마이페이지의 ‘매칭’에서 해당 오픈카드 또는 1대1 프로필을 찾아 수정해 주세요. 사진이나 소개글을 변경한 후 저장하면 됩니다. 수정 버튼이 없거나 저장되지 않는 경우, 어느 화면에서 발생했는지와 표시된 오류를 새 문의로 알려주세요." },
  { id: "matching", label: "1대1 매칭 이용 방법", re: /^(?:1대1|11)(?:매칭|소개팅)(?:은|을|는)?(?:어떻게)(?:이용|진행|사용)(?:하나요|해요|되나요|하면되나요)$/, answer: "1대1 화면에서 본인 프로필을 등록한 뒤 후보를 확인하고 마음에 드는 분에게 요청할 수 있습니다. 상대방의 응답과 진행 상황은 마이페이지 ‘매칭’에서 확인해 주세요. 연락처 교환은 해당 화면에서 조건과 결제 금액을 확인한 뒤 진행하며, 요청만으로 만남이 보장되지는 않습니다." },
  { id: "inquiry_history", label: "문의 답변 확인 방법", re: /^(?:문의|문의답변|답변)(?:은|를|을|는)?(?:어디서|어디에서|어떻게)(?:보나요|확인하나요|확인해요|볼수있나요)$/, answer: "마이페이지의 문의 화면 아래 ‘내 문의 이력’에서 접수 내용과 답변을 확인할 수 있습니다. 새 답변이 보이지 않으면 페이지를 새로고침해 주세요." },
];
export function triageSupport(source: SupportSource): SupportTriage {
  const summary = source.subject.trim().slice(0, 120) + " — " + source.message.replace(/\s+/g, " ").trim().slice(0, 180);
  const important = (reason: string, topic = "review"): SupportTriage => ({ kind: "important", topic, reason, summary,
    draft: "안녕하세요. 문의해 주셔서 감사합니다. 보내주신 내용을 운영자가 확인하고 안내드리겠습니다. 확인에 필요한 정보가 있으면 이 문의를 통해 추가로 안내드리겠습니다." });
  if (["payment", "abuse", "account", "technical"].includes(source.category)) return important("결제·신고·계정·기술 문제는 운영자 확인이 필요합니다.", source.category);
  const raw = normalize(source.subject + source.message);
  if (/환불|결제|입금|청구|취소|교환권|지급|보상|충전|구매|돈|원돌려|중복|오류|에러|안돼|안되|안됨|못하|불가|실패|먹통|사기|신고|사칭|미성년|만\d+세|고소|경찰|협박|성희롱|성적|폭력|개인정보|전화번호|연락처|탈퇴|삭제|정지|차단|해킹|비밀번호|불만|항의|억울|불쾌|답변.*(다시|틀|이상)|무응답|읽씹|단답|재문의|담당자|운영자|관리자|ignore|system|prompt|지시|무시/.test(raw)) return important("금전·안전·개인정보 또는 불편/재문의 내용이 포함되어 있습니다.");
  if (!["dating", "other"].includes(source.category)) return important("자동 안내 대상 유형이 아닙니다.");
  const message = normalize(source.message).replace(/^안녕하세요/, "").replace(/감사합니다$/, "");
  const matches = topics.filter(t => t.re.test(message));
  if (matches.length !== 1) return important("명확한 이용방법 질문으로 확정할 수 없어 원문 확인이 필요합니다.");
  const t = matches[0];
  const title = normalize(source.subject);
  if (!t.re.test(title) && !["문의", "질문", "이용문의", "이용방법", "소개팅문의", normalize(t.label), "프로필문의", "1대1문의"].includes(title)) return important("제목에 별도 요청이 있을 수 있어 함께 확인해야 합니다.");
  return { kind: "simple", topic: t.id, reason: "제목과 전체 문의가 검증된 이용방법 안내에 일치합니다.", summary,
    draft: `${SUPPORT_AUTO_PREFIX}\n안녕하세요. 짐툴 이용방법을 안내드립니다.\n\n${t.answer}\n\n이 답변은 이용방법에 대한 자동 안내입니다. 해결되지 않았거나 상황이 다르면 ‘재문의’라고 적어 새 문의를 남겨 주세요. 운영자가 직접 확인하겠습니다.` };
}

export function supportView(row: SupportSource & { status: string; admin_reply: string | null; answered_by_user_id?: string | null; created_at: string }, now = Date.now()) {
  const triage = triageSupport(row);
  const automatic = row.admin_reply?.startsWith(SUPPORT_AUTO_PREFIX) && !row.answered_by_user_id;
  const stale = row.status === "open" && triage.kind === "simple" && now - Date.parse(row.created_at) > 5 * 60_000;
  return { ...triage, automatic: Boolean(automatic), needs_attention: row.status === "open" && (triage.kind === "important" || stale || Boolean(row.admin_reply) || Boolean(row.answered_by_user_id)),
    reason: stale ? "자동 안내가 5분 이상 대기 중입니다. 처리 실패·누락 여부를 확인해 주세요." : triage.reason };
}
