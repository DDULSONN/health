// Administrator review signals only. Never use these heuristics to reject, edit or ban a member.
export type DatingContactTextReview = { level: "clear" | "medium" | "high"; flags: string[] };

const PROSE_FIELDS: Record<string, string> = {
  intro: "자기소개", strengths: "내 강점", ideal: "이상형", idealType: "이상형", preferredPartner: "원하는 상대",
};
const EXPLICIT_FIELDS = { name: "이름", job: "직업", ...PROSE_FIELDS };
const NORMAL_WORDS = new Set((
  "hello thanks thank welcome profile instagram crossfit fitness pilates running swimming hiking cycling climbing " +
  "workout training exercise travel music movies coffee reading cooking positive honest kindness kindhearted " +
  "friendly cheerful sincere introvert extrovert active healthy happy stable calm lover girl boy woman man " +
  "seoul korea korean english japanese language developer engineer designer manager nurse teacher student " +
  "microsoft google samsung apple azure cloud techno uxui mbti mbit enfp entp infp intp enfj entj infj intj " +
  "esfp estp isfp istp esfj estj isfj istj adhD youtube netflix spotify esports baseball basketball football " +
  "volleyball badminton tennis weekend business university family friends relationship marriage myself " +
  "sometimes never always hobbies personality interested christian catholic buddhist vegan vegetarian " +
  "next.js node.js react.js vue.js asp.net dot.net spring.boot vitaminb12 omega3 gpt4 chatgpt4 covid19"
).toLowerCase().split(/\s+/));

const normalize = (value: unknown) => typeof value === "string" ? value.slice(0, 4000).normalize("NFKC")
  .replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, "") : "";
const PHONE = /(?<!\d)(?:0[\s().-]*1[\s().-]*[016789]|\+?82[\s().-]*1[\s().-]*0)(?:[\s().-]*\d){7,8}(?!\d)/g;
const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const LINK = /https?:\/\/[^\s<>]+|www\.[^\s<>]+|(?:instagram\.com|open\.kakao\.com|t\.me|linktr\.ee|bit\.ly)\/[A-Za-z0-9_./?=&%-]+/gi;
// Boundaries prevent online/온라인, bright, 본인스타일 and 디엠씨역 from becoming contact requests.
const SOCIAL = "(?<![A-Za-z가-힣])(?:인\\s*스\\s*타(?:그램)?|인별|카\\s*톡|카\\s*카\\s*오(?:톡)?|오픈\\s*(?:카톡|채팅)|오카|옾챗|ㅋ\\s*ㅌ|ᄏ\\s*ᄐ|라인|텔레그램|텔레|instagram|insta|kakaotalk|kakao|telegram|line|ig|ins|dm|디엠)(?![A-Za-z])";
const LABELED_HANDLE = new RegExp(SOCIAL + "\\s*(?:아이디|아이뒤|계정|id)?\\s*(?:은|는)?\\s*[:：=]?\\s*(@?[A-Za-z0-9._]{3,30})(?![A-Za-z0-9._])", "gi");
const GENERIC_ID = /(?:아이디|아이뒤|계정|\bid\b)\s*(?:은|는)?\s*[:：=]?\s*(@?[A-Za-z0-9._]{3,30})(?![A-Za-z0-9._])/gi;
const SOCIAL_INVITE = new RegExp(SOCIAL + "(?:으로|로|에서)?\\s*(?:연락|메시지|쪽지|디엠|dm|팔로우|친추|친구\\s*추가|검색)?\\s*(?:주세요|주세용|보내|남겨|부탁|환영|해주)", "gi");
const HANDLE_INVITE = /(?<![A-Za-z0-9._])(@?[A-Za-z0-9._]{3,30})\s*(?:으로|로|여기로|쪽으로)\s*(?:연락|메시지|쪽지|디엠|dm|보내|주세요|주세용)/gi;
const HANDLE = /(?<![A-Za-z0-9._])@?[A-Za-z0-9._]{3,30}(?![A-Za-z0-9._])/g;

function ordinaryToken(value: string) {
  const token = value.toLowerCase().replace(/^@/, "").replace(/\.+$/, "");
  return !/[a-z]/.test(token) || NORMAL_WORDS.has(token)
    || /^[ei_][ns_][ft_][jp_](?:[._-][at])?$/.test(token)
    || /^\d+(?:\.\d+)?(?:cm|kg|km|mm|lbs?|hz|cc|am|pm|rpm|bpm|rm|kcal|ml|gb|mb|xl)$/.test(token)
    || /^(?:sql|html|css|iphone|galaxys|ios|android|gpt|windows|rpe|zone|vitamin[a-z]?|omega|covid)[._]?\d+$/.test(token)
    || /^x[._x]*$/.test(token);
}

export function reviewDatingContactText(texts: Record<string, unknown>): DatingContactTextReview {
  let level: DatingContactTextReview["level"] = "clear";
  const flags = new Set<string>();
  const knownHandle = normalize(texts.instagramId).trim().replace(/^@/, "").toLowerCase();
  for (const [field, label] of Object.entries(EXPLICIT_FIELDS)) {
    const text = normalize(texts[field]);
    if (!text) continue;
    const covered: { start: number; end: number }[] = [];
    function add(kind: string, hit: string, severity: "medium" | "high", start: number, length: number) {
      if (severity === "high" || level === "clear") level = severity;
      if (flags.size < 10) flags.add(`${label}: ${kind} · 감지: ${hit.replace(/\s+/g, " ").slice(0, 60)}`);
      covered.push({ start, end: start + length });
    }
    for (const [pattern, kind] of [[PHONE, "전화번호 직접 노출 의심"], [EMAIL, "외부 이메일 기재 의심"], [LINK, "외부 연락/링크 유도 의심"]] as const) {
      for (const hit of text.matchAll(pattern)) add(kind, hit[0], "high", hit.index!, hit[0].length);
    }
    for (const pattern of [LABELED_HANDLE, GENERIC_ID, HANDLE_INVITE]) {
      for (const hit of text.matchAll(pattern)) {
        // A deliberate ID label/colon or @ is evidence even for common handles.
        const explicitLabel = /[:：=]|아이디|아이뒤|계정|\bid\b/i.test(hit[0].slice(0, -hit[1].length));
        if (ordinaryToken(hit[1]) && !explicitLabel && !hit[1].startsWith("@")) continue;
        add("연락처/외부 계정 선노출 의심", hit[0], "high", hit.index!, hit[0].length);
      }
    }
    for (const hit of text.matchAll(SOCIAL_INVITE)) add("외부 연락 유도 의심", hit[0], "high", hit.index!, hit[0].length);
    for (const hit of text.matchAll(HANDLE)) {
      const token = hit[0], start = hit.index!;
      if (covered.some(range => start < range.end && start + token.length > range.start)) continue;
      // @ and matching registered handles are evidence even if they resemble ordinary words.
      const atHandle = token.startsWith("@") && /[A-Za-z]/.test(token);
      const plain = token.replace(/^@/, "").toLowerCase();
      if (atHandle) { add("외부 계정 표기 의심", token, "high", start, token.length); continue; }
      const known = /^[a-z0-9._]{4,30}$/.test(knownHandle) && plain === knownHandle;
      if (!(field in PROSE_FIELDS) || (ordinaryToken(token) && !known)) continue;
      const lineStart = text.lastIndexOf("\n", start - 1) + 1;
      const lineEnd = text.indexOf("\n", start + token.length);
      const line = text.slice(lineStart, lineEnd < 0 ? text.length : lineEnd).trim();
      const standalone = line === token;
      const structured = /[._]/.test(plain.replace(/\.+$/, ""))
        || (token.length >= 5 && /[a-z]{2}/i.test(token) && /\d{2}/.test(token));
      // A bare all-letter line is uncertain: ask for review, not a deletion or a ban.
      const bareLetters = standalone && /^[a-z]{5,30}$/i.test(token);
      const bareAlphanumeric = standalone && token.length >= 5 && /[a-z]{2}/i.test(token) && /\d/.test(token);
      if (structured || known || bareLetters || bareAlphanumeric) add(known ? "등록 인스타 아이디의 본문 노출 의심" : "외부 계정 형식 확인 필요", token, "medium", start, token.length);
    }
  }
  return { level, flags: [...flags] };
}
