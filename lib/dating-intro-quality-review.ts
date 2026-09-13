// Admin-only review signals, not submission requirements or automatic sanctions.
export type DatingIntroQualityReview = {
  level: "clear" | "medium";
  flags: string[];
};

const FIELD_LABELS = {
  intro: "자기소개",
  strengths: "내 강점",
  ideal: "이상형",
  idealType: "이상형",
  preferredPartner: "원하는 상대",
} as const;
type TextField = keyof typeof FIELD_LABELS;
const MIN_INTRO_LETTERS = 8;
const FILLER_ONLY = /^(?:안녕하세요|안녕하세용|안녕하세욤|안녕|반갑습니다|반가워요|잘부탁드립니다|잘부탁드려요|잘부탁해요|잘부탁합니다|좋은하루되세요|잘지내봐요|hellothere|hello|hi|nicetomeetyou)+$/u;
const PLACEHOLDER_ONLY = /^(?:없음|없어요|없습니다|몰라요|모르겠어요|아무거나|아무내용|내용없음|소개없음|비공개|나중에|나중에작성|나중에적을게요|나중에작성할게요|추후작성|추후작성예정|작성예정|작성중|준비중|수정예정|테스트|test|testing|asdf|qwer|zxcv|tbd|none|comingsoon|askme)+$/u;

function normalize(value: unknown) {
  return typeof value === "string"
    ? value.slice(0, 4000).normalize("NFKC").toLowerCase()
      .replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, "").trim()
    : "";
}

function lettersOnly(value: string) {
  // Spaces, emoji, digits and isolated Hangul jamo must not pad the introduction length.
  return value.replace(/[^\p{L}]/gu, "")
    .replace(/[\u1100-\u11ff\u3130-\u318f\ua960-\ua97f\ud7b0-\ud7ff]/g, "");
}

function repetitionDominates(value: string) {
  const compact = value.replace(/[^\p{L}\p{N}]/gu, "");
  if (compact.length < 8) return false;
  const repetitions = [...compact.matchAll(/([\p{L}\p{N}]{1,12})\1{3,}/gu)]
    .reduce((length, match) => length + match[0].length, 0);
  return repetitions / compact.length >= 0.6;
}

export function reviewDatingIntroQuality(sourceType: string, texts: Record<string, unknown>): DatingIntroQualityReview {
  // Open cards have no intro field. Paid cards may be copied from an open card,
  // leaving intro empty; in that case the strengths field is the introduction.
  let primaryField: TextField;
  if (sourceType === "open_card") primaryField = "strengths";
  else if (sourceType === "paid_card") primaryField = normalize(texts.intro) ? "intro" : "strengths";
  else if (["one_on_one", "one_on_one_application", "open_card_application", "paid_card_application"].includes(sourceType)) primaryField = "intro";
  else return { level: "clear", flags: [] };

  const flags: string[] = [];
  for (const [key, label] of Object.entries(FIELD_LABELS)) {
    const value = normalize(texts[key]);
    // Optional/missing supporting fields are not missing introductions.
    if (!value && key !== primaryField) continue;
    const letters = lettersOnly(value);
    let reason = "";
    if (!value) reason = "소개 내용이 없음";
    else if (!letters) reason = "자음·숫자·기호 위주로 소개 내용 부족";
    else if (FILLER_ONLY.test(letters)) reason = "인사말만 있어 소개 내용 부족";
    else if (PLACEHOLDER_ONLY.test(letters)) reason = "임시·무의미한 소개 문구 의심";
    else if (repetitionDominates(value)) reason = "반복 문자·문구 위주로 소개 내용 부족";
    else if (key === primaryField && [...letters].length < MIN_INTRO_LETTERS) reason = "소개 내용이 너무 짧음 (공백·기호 제외 8자 미만)";
    if (reason) flags.push(`${label}: ${reason}`);
  }
  return { level: flags.length ? "medium" : "clear", flags };
}
