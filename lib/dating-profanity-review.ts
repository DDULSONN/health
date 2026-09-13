// Admin review only. A keyword match is not proof of harassment and must never auto-ban.
export type DatingProfanityReview = {
  level: "clear" | "medium" | "high";
  flags: string[];
};

const FIELD_LABELS: Record<string, string> = {
  displayName: "이름/닉네임",
  name: "이름",
  job: "직업",
  intro: "자기소개",
  strengths: "내 강점",
  ideal: "이상형",
  idealType: "이상형",
  preferredPartner: "원하는 상대",
};

type Rule = { level: "medium" | "high"; label: string; pattern: RegExp; compact?: boolean };
const RULES: Rule[] = [
  {
    level: "high",
    label: "욕설·비하 표현 의심",
    compact: true,
    // Keep digits except for bounded, explicit obfuscations. Do not flag 시발점/도시 발전,
    // 질병 신호/발병 신고, 전염병/감염병, or 존나단 just because they contain part of a word.
    pattern: /씨{1,6}[0-9]{0,2}[발벌빨]|(?<!택)시{1,6}[0-9]{0,2}발(?!점|역|지|전|표|송|생|권|시간|열차|버스|기점)|개(?:새끼|색기|새기)|(?<![질발])병[0-9]{0,2}신|지[0-9]{0,2}랄|좆|존나(?!단)|미친(?:놈|년)|씹(?:새끼|새기|년|놈|창)|느금마|니(?:애미|애비)|(?<![전감])염병/gu,
  },
  {
    level: "medium",
    label: "초성 욕설 의심",
    compact: true,
    // NFKC turns compatibility consonants into Hangul leading jamo; accept both.
    // Boundaries prevent extracting a curse from a longer, unrelated initials sequence.
    pattern: /(?:(?<![\u1100-\u11ff\u3130-\u318f])|(?<=[ㅋᄏㅎᄒ]))(?:[ㅅᄉㅆᄊ][ㅂᄇ]|[ㅂᄇ][ㅅᄉ]|[ㅈᄌ][ㄹᄅㄴᄂ]|[ㄱᄀ][ㅅᄉ][ㄲᄁ])+(?:(?![\u1100-\u11ff\u3130-\u318f])|(?=[ㅋᄏㅎᄒ]))/gu,
  },
  {
    level: "high",
    label: "영문 욕설 의심",
    // ASCII boundaries permit Korean suffixes/underscores, without matching class,
    // assistant, Scunthorpe, shiitake, or ordinary words such as shift/shirt.
    pattern: /(?<![a-z0-9])(?:f[\s._*-]{0,3}u[\s._*-]{0,3}c[\s._*-]{0,3}k(?:ing|ed|er|ers|s)?|f\*{1,3}c?k|motherfucker(?:s)?|s[\s._*-]{0,3}h[\s._*-]{0,3}[i1!][\s._*-]{0,3}t|bullshit|b[\s._*-]{0,3}[i1!][\s._*-]{0,3}t[\s._*-]{0,3}c[\s._*-]{0,3}h(?:es)?|asshole(?:s)?|bastard(?:s)?|cunt(?:s)?)(?![a-z0-9])/giu,
  },
];

function normalizedText(value: unknown) {
  return typeof value === "string"
    ? value.slice(0, 4000).normalize("NFKC").toLowerCase()
      .replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, "")
    : "";
}

function readableHit(value: string) {
  // Isolated initial consonants should still look like ㅅㅂ, not unfamiliar decomposed glyphs.
  const consonants = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
  return value.replace(/[\u1100-\u1112]/g, (char) => consonants[char.charCodeAt(0) - 0x1100]).slice(0, 24);
}

export function reviewDatingProfanity(texts: Record<string, unknown>): DatingProfanityReview {
  const flags = new Set<string>();
  let level: DatingProfanityReview["level"] = "clear";
  for (const [key, label] of Object.entries(FIELD_LABELS)) {
    const text = normalizedText(texts[key]);
    if (!text) continue;
    const compact = text.replace(/[\s\p{P}\p{S}]/gu, "");
    for (const rule of RULES) {
      const hit = (rule.compact ? compact : text).matchAll(rule.pattern).next().value;
      if (!hit) continue;
      flags.add(`${label}: ${rule.label} (감지: ${readableHit(hit[0])})`);
      if (level === "clear" || rule.level === "high") level = rule.level;
    }
  }
  return { level, flags: [...flags].slice(0, 10) };
}
