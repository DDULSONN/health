export type OneOnOneNameReview = {
  suspicious: boolean;
  level: "medium" | "high";
  flags: string[];
};

const PHONE_PATTERN = /(?:010|011|016|017|018|019)[-\s.)]*(?:\d[-\s.]*){7,8}/i;
const SOCIAL_KEYWORD_PATTERN =
  /(카\s*톡|카\s*카\s*오|ㅋ\s*ㅌ|오\s*픈\s*(카\s*톡|채\s*팅)|오카|옾챗|오픈채팅|open\s*(kakao|chat)|kakao|kakaotalk|인\s*스\s*타|인별|instagram|insta|\big\b|디엠|\bdm\b|텔레그램|telegram|텔레|라인|\bline\b)/i;
const LINK_PATTERN = /https?:\/\/|www\.|open\.kakao|t\.me|instagram\.com|linktr\.ee|bit\.ly/i;
const HANDLE_PATTERN = /(^|[^A-Za-z0-9._])@[A-Za-z0-9._]{2,}/i;
const LABELED_ID_PATTERN = /(아이디|\bid\b|계정)\s*(은|는|:|：|=)?\s*[A-Za-z0-9._-]{2,}/i;
const HANDLE_LIKE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{2,}$/i;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

function cleanName(value: unknown) {
  return String(value ?? "").trim().replace(/\s{2,}/g, " ").slice(0, 120);
}

export function reviewOneOnOneName(value: unknown): OneOnOneNameReview {
  const name = cleanName(value);
  const flags: string[] = [];

  if (!name) {
    return { suspicious: true, level: "high", flags: ["이름이 비어 있음"] };
  }

  const compactDigits = name.replace(/\D/g, "");
  if (PHONE_PATTERN.test(name) || (/^01[016789]/.test(compactDigits) && compactDigits.length >= 10)) {
    flags.push("휴대폰 번호 기재 의심");
  }
  if (EMAIL_PATTERN.test(name)) flags.push("이메일 주소 기재 의심");
  if (LINK_PATTERN.test(name)) flags.push("외부 링크 기재 의심");
  if (SOCIAL_KEYWORD_PATTERN.test(name)) flags.push("SNS/메신저 계정 기재 의심");
  if (HANDLE_PATTERN.test(name)) flags.push("SNS 핸들 기재 의심");
  if (LABELED_ID_PATTERN.test(name)) flags.push("외부 계정 ID 기재 의심");
  if (!PHONE_PATTERN.test(name) && HANDLE_LIKE_PATTERN.test(name) && /[._-]/.test(name)) {
    flags.push("외부 계정 형식 의심");
  }
  if (HANDLE_LIKE_PATTERN.test(name) && /[A-Za-z]/.test(name) && /\d/.test(name)) {
    flags.push("영문·숫자 아이디 형식 의심");
  }

  const uniqueFlags = Array.from(new Set(flags));
  const high = uniqueFlags.some((flag) => /휴대폰|이메일|링크|SNS\/메신저|계정 ID/.test(flag));
  return {
    suspicious: uniqueFlags.length > 0,
    level: high ? "high" : "medium",
    flags: uniqueFlags,
  };
}
