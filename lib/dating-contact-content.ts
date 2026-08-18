export type DatingContactSignal =
  | "phone"
  | "email"
  | "external_link"
  | "explicit_contact_request"
  | "social_handle";

export const DATING_CONTACT_CONTENT_ERROR =
  "소개 내용에는 전화번호, 이메일, 외부 링크, 카카오톡·인스타그램 등 외부 계정 아이디를 작성할 수 없습니다.";

const PHONE_PATTERNS = [
  /(?:010|011|016|017|018|019)[-\s.)]*(?:\d[-\s.]*){7,8}/,
  /\b01[016789][^\d]{0,3}\d{3,4}[^\d]{0,3}\d{4}\b/,
];

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+\s*@\s*[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const EXTERNAL_LINK_PATTERN =
  /(?:https?:\/\/|www\.|open\.kakao|t\.me|instagram\.com|instagr\.am|bit\.ly|linktr\.ee|discord\.gg|(?:[a-z0-9-]+\.)+(?:com|net|org|io|me|kr|co\.kr)(?:\/|\b))/i;
const EXPLICIT_CONTACT_PATTERN =
  /(?:오픈\s*카톡|오픈\s*채팅|카카오톡|카톡|kakao(?:talk)?|인스타(?:그램)?|instagram|insta|\big\b|디엠|\bdm\b|텔레그램|telegram|라인|\bline\b).{0,24}(?:아이디|\bid\b|계정|검색|추가|친추|팔로우|연락|문의|메시지|주세요|주세용|보내|남겨)/i;
const GENERAL_CONTACT_REQUEST_PATTERN =
  /(?:연락처|연락|번호|전화|문자).{0,16}(?:주세요|주세용|가능|해요|할게|남겨|교환|010|카톡|카카오|인스타|\bdm\b|디엠)/i;
const LABELED_HANDLE_PATTERN =
  /(?:카카오톡|카톡|kakao(?:talk)?|인스타(?:그램)?|instagram|insta|\big\b|텔레그램|telegram|라인|\bline\b)\s*(?:아이디|\bid\b|계정)?\s*[:：=]?\s*@?[A-Za-z0-9][A-Za-z0-9._-]{2,29}/i;
const AT_HANDLE_PATTERN = /(^|[^A-Za-z0-9._-])@[A-Za-z0-9][A-Za-z0-9._]{2,29}(?=$|[^A-Za-z0-9._-])/i;

// A long, lowercase ASCII token split into at least three words with underscores
// or dots is overwhelmingly likely to be a deliberately unlabelled SNS ID in
// Korean dating-profile prose. Requiring three segments avoids common values
// such as ENFP_T and workout codes such as 3_4.
const UNLABELLED_HANDLE_PATTERN =
  /(^|[^A-Za-z0-9._-])[a-z0-9]{2,}(?:[._][a-z0-9]{2,}){2,}(?=$|[^A-Za-z0-9._-])/i;

function normalizeContactText(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
    .trim();
}

export function findDatingContactSignals(value: unknown): DatingContactSignal[] {
  const text = normalizeContactText(value);
  if (!text) return [];
  const compactHandleText = text.replace(/\s*([._])\s*/g, "$1");

  const signals: DatingContactSignal[] = [];
  if (PHONE_PATTERNS.some((pattern) => pattern.test(text))) signals.push("phone");
  if (EMAIL_PATTERN.test(text)) signals.push("email");
  if (EXTERNAL_LINK_PATTERN.test(text)) signals.push("external_link");
  if (EXPLICIT_CONTACT_PATTERN.test(text) || GENERAL_CONTACT_REQUEST_PATTERN.test(text)) {
    signals.push("explicit_contact_request");
  }
  if (
    LABELED_HANDLE_PATTERN.test(compactHandleText) ||
    AT_HANDLE_PATTERN.test(compactHandleText) ||
    UNLABELLED_HANDLE_PATTERN.test(compactHandleText)
  ) {
    signals.push("social_handle");
  }

  return signals;
}

export function findDatingContactFields(fields: Record<string, unknown>) {
  return Object.entries(fields)
    .map(([field, value]) => ({ field, signals: findDatingContactSignals(value) }))
    .filter((item) => item.signals.length > 0);
}

export function datingContactReviewFlags(value: unknown) {
  const signals = findDatingContactSignals(value);
  const flags: string[] = [];

  if (signals.includes("phone")) flags.push("전화번호 직접 노출 의심");
  if (signals.includes("email")) flags.push("이메일 직접 노출 의심");
  if (signals.includes("external_link")) flags.push("외부 연락/링크 유도 의심");
  if (signals.includes("explicit_contact_request")) flags.push("연락처/외부 계정 선노출 의심");
  if (signals.includes("social_handle")) flags.push("외부 계정 ID 직접 노출 의심");

  return flags;
}
