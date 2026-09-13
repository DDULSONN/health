// Admin review signals only. Never use these heuristics to reject a profile or ban a user.
export type DatingSexualTextReview = {
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

type Rule = {
  level: "medium" | "high";
  label: string;
  pattern: RegExp;
  compact?: boolean;
};

const RULES: Rule[] = [
  {
    level: "high",
    label: "성적 행위·만남 표현 의심",
    compact: true,
    pattern: /섹스|쎅스|섹파|쎅파|(?<![이동])성관계|원나잇|원나이트|노콘|질내사정|애널|오럴|펠라치오|펠라|블로우잡|핸드잡/gu,
  },
  {
    level: "high",
    label: "음란물·노골적인 성적 표현 의심",
    compact: true,
    pattern: /야동|포르노|자위행위|자위기구|성인용품|음경|음핵|클리토리스|정액|젖꼭지/gu,
  },
  {
    level: "high",
    label: "성적 행위·만남 표현 의심",
    // Word boundaries avoid flagging Sussex, sexy, crossfit, etc.
    pattern: /\b(?:s[\s._*-]{0,3}e[\s._*-]{0,3}x|f[\s._*-]{0,3}w[\s._*-]{0,3}b|b[\s._*-]{0,3}d[\s._*-]{0,3}s[\s._*-]{0,3}m|one[\s._-]*night[\s._-]*stand|hook[\s._-]*up|porn|blowjob|handjob)\b/giu,
  },
  {
    level: "high",
    label: "성적 대화·사진 또는 취향 표현 의심",
    compact: true,
    pattern: /속궁합|성욕|성적취향|성적인취향|성적판타지|페티시|패티시|야한(?:대화|사진|영상|얘기|이야기)|19금(?:대화|사진|영상|만남|얘기|가능)|잠자리(?:목적|만남|상대|파트너)|[ㅅᄉ]{2}(?:파트너|상대|할분|하실분|가능|원해|좋아)|sm성향/gu,
  },
  {
    level: "high",
    label: "대가성 성적 만남 의심",
    compact: true,
    pattern: /조건만남|조건부만남|스폰(?:만남|구해|구함|받아|가능)|성인만남/gu,
  },
  {
    level: "medium",
    label: "성적 신체 묘사·조건 확인 필요",
    compact: true,
    pattern: /[a-k]컵|거유|빈유|(?:가슴|유방)(?:이|은|는|도|가|의)?(?:사이즈|크기|큰|크고|커요|작은|작고|작아요|빵빵|풍만)/gu,
  },
  {
    level: "high",
    label: "노골적인 신체 표현 의심",
    // Do not match everyday Korean such as "보지 않아요" or "일찍 자지 못해요".
    pattern: /(?:^|\s)(?:자지|보지)(?=$|\s*(?:크기|사이즈|큰|작은|굵|빨|핥)|(?:가|를|는|에|만)(?:\s|$))/gu,
  },
];

function normalizedText(value: unknown) {
  return typeof value === "string"
    ? value.slice(0, 4000).normalize("NFKC").toLowerCase().replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, "")
    : "";
}

function compactText(value: string) {
  return value.replace(/[\s\p{P}\p{S}]/gu, "");
}

function isRejection(tail: string) {
  // Only a short, immediate refusal counts. A refusal elsewhere must not hide a solicitation.
  const normalized = compactText(tail.slice(0, 55));
  return /^(?:(?:은|는|을|를|도|만|이|가|같은|목적의|목적|제안|요구|하자는분|원하는분|하는분|하시는분|강요하는분|강요)){0,4}(?:안(?:해|하|합|받|원|봐|보)|못(?:해|하|봐|보)|싫|거절|사절|원치|원하지않|하지않|관심없|관심이없|금지|불가)/u.test(normalized);
}

export function reviewDatingSexualText(texts: Record<string, unknown>): DatingSexualTextReview {
  const flags = new Set<string>();
  let level: DatingSexualTextReview["level"] = "clear";

  for (const [key, label] of Object.entries(FIELD_LABELS)) {
    const text = normalizedText(texts[key]);
    if (!text) continue;
    for (const rule of RULES) {
      const target = rule.compact ? compactText(text) : text;
      // matchAll clones the expression, so repeated requests never share a lastIndex cursor.
      const hit = Array.from(target.matchAll(rule.pattern)).some((match) =>
        !isRejection(target.slice((match.index ?? 0) + match[0].length))
      );
      if (!hit) continue;
      flags.add(`${label}: ${rule.label}`);
      if (level === "clear" || rule.level === "high") level = rule.level;
    }
  }

  return { level, flags: [...flags].slice(0, 10) };
}
