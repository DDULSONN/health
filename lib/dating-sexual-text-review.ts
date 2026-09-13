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
  skipRefusals?: boolean;
};

const RULES: Rule[] = [
  {
    level: "high",
    label: "성적 행위·만남 표현 의심",
    compact: true,
    pattern: /섹스|쎅스|쎽스|섹파|쎅파|섹친|섹프|(?<![이동])성관계|성행위|원나잇트|원나잇|원나이트|노콘|질내사정|질싸|입싸(?!움)|애널|오럴|펠라치오|펠라|블로우잡|핸드잡|폰섹|폰쎅|캠섹|영섹|쓰리썸|스리썸|3썸/gu,
  },
  {
    level: "high",
    label: "음란물·노골적인 성적 표현 의심",
    compact: true,
    pattern: /야동|포르노|자위행위|자위기구|성인용품|음경|음핵|클리토리스|젖꼭지|딜도|오나홀|러브젤|벗방|몸캠|은꼴/gu,
  },
  {
    level: "high",
    label: "성적 행위·만남 표현 의심",
    // ASCII word boundaries allow Korean suffixes and underscores, but not Sussex/sexy.
    // Bounded separators and explicit leetspeak forms avoid rewriting arbitrary words/numbers.
    pattern: /(?<![a-z0-9])(?:s[\s._*-]{0,3}[e3€][\s._*-]{0,3}x|f[\s._*-]{0,3}w[\s._*-]{0,3}b|b[\s._*-]{0,3}d[\s._*-]{0,3}s[\s._*-]{0,3}m|one[\s._-]{0,3}night[\s._-]{0,3}stand|hook[\s._-]{0,3}ups?|p[o0]rn|blowjob|handjob|fuck[\s._-]{0,3}buddy|sex[\s._-]{0,3}partner|sexting|threesome)(?![a-z0-9])/giu,
  },
  {
    level: "high",
    label: "성적 대화·사진 또는 취향 표현 의심",
    compact: true,
    pattern: /속궁합|성욕|성적취향|성적인취향|성적판타지|페티시|패티시|(?:야한|야릇한)(?:대화|사진|영상|얘기|이야기|톡|채팅)|19금(?:대화|사진|영상|만남|얘기|가능|톡|채팅)|잠자리(?:목적|만남|상대|파트너)|sm성향|에셈(?:성향|플레이|가능|파트너)|돔섭|디그레이더|(?:사디스트|마조히스트|돔|섭)(?:성향|플레이)|본디지|초대남|초대녀|(?:커플스와핑|스와핑(?:커플|상대|파트너))/gu,
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
    // Rejecting someone based on a sexual body condition is itself a review signal.
    skipRefusals: false,
    pattern: /[a-k]컵|거유|빈유|왕가슴|(?:가슴|유방)(?:이|은|는|도|가|의)?(?:사이즈|크기|큰|크고|커요|작은|작고|작아요|빵빵|풍만)|대물(?:남|인분|좋아|선호)|소추(?:남|싫|사절)/gu,
  },
  {
    level: "high",
    label: "성적 은어·초성 표현 의심",
    compact: true,
    // Initials such as ㅅㅅ can also be cheering; require a solicitation context.
    pattern: /(?:[ㅅᄉ]{2}|[ㅅᄉ][ㅍᄑ]|[ㅇᄋ][ㄴᄂ][ㅇᄋ]|[ㄴᄂ][ㅋᄏ])(?:파트너|상대|할분|하실분|가능|원해|원함|좋아|구해|구함|만남)|섹[0-9]{1,2}스|[ㅅᄉ][ㅔᅦ][ㄱᄀᆨ][ㅅᄉ][ㅡᅳ]|(?:같이|함께)?떡(?:칠(?:분|사람|상대)|치(?:실분|고싶|러갈|자))|얼싸(?:가능|좋아|해줘|원해)/gu,
  },
  {
    level: "high",
    label: "성적 은어 표현 의심",
    // Do not compact these: 야스오/야스민 and 빨간색 스타일 are not sexual solicitations.
    pattern: /(?<![\p{L}\p{N}])(?:야[\s._*-]{0,3}스|색[\s._*-]{0,3}스)(?=$|[^\p{L}\p{N}]|할|하실|하자|해요|파트너|하고|가능|좋아|원해|구해|구함)/gu,
  },
  {
    level: "high",
    label: "성적인 사진·영상 요구 의심",
    compact: true,
    pattern: /(?:알몸|누드|벗은|노팬티|노브라)(?:사진|영상|인증샷)(?:을|를|도)?(?:보내|교환|주세요|원해|요구)|(?:성기|유두)(?:사진|영상)|(?:노팬티|노브라)(?:만남|플레이)/gu,
  },
  {
    level: "high",
    label: "노골적인 성적 표현 의심",
    compact: true,
    // Health clubs and other businesses also use 정액권/정액제/정액 결제.
    pattern: /정액(?!제|권|결제|요금|구독|지급|수당|저축|적금)|(?:자위)(?:중독|좋아|같이|보여|행동)|(?:[ㅈᄌ]{2}|[ㅂᄇ][ㅈᄌ])(?:크기|사이즈|빨아|핥아)/gu,
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

function isRejection(head: string, tail: string) {
  // Only a short, immediate refusal counts. A refusal elsewhere must not hide a solicitation.
  const normalized = compactText(tail.slice(0, 55));
  if (/^(?:(?:은|는|을|를|도|만|이|가|같은|목적의|목적|제안|요구|하자는분|원하는분|하는분|하시는분|강요하는분|강요)){0,4}(?:안(?:해|하|합|받|원|봐|보|구|찾|만)|못(?:해|하|봐|보)|싫|거절|사절|원치|원하지않|좋아하지않|하지않|할생각없|관심없|관심이없|생각없|생각이없|금지|불가)/u.test(normalized)) return true;
  // English refusals are evaluated on the original spaced text, immediately beside the hit.
  return /\b(?:no|not\s+(?:looking\s+for|interested\s+in|into)|don['’]?t\s+want)\s*$/iu.test(head.slice(-55))
    || /^\s*(?:(?:is|are)\s+)?(?:not\s+(?:for\s+me|interested)|unwanted|no\s+thanks)\b/iu.test(tail);
}

export function reviewDatingSexualText(texts: Record<string, unknown>): DatingSexualTextReview {
  const flags = new Set<string>();
  let level: DatingSexualTextReview["level"] = "clear";

  for (const [key, label] of Object.entries(FIELD_LABELS)) {
    const text = normalizedText(texts[key]);
    if (!text) continue;
    const compact = compactText(text);
    for (const rule of RULES) {
      const target = rule.compact ? compact : text;
      // matchAll clones the expression, so repeated requests never share a lastIndex cursor.
      let hit = "";
      for (const match of target.matchAll(rule.pattern)) {
        const start = match.index ?? 0;
        const end = start + match[0].length;
        if (rule.skipRefusals === false || !isRejection(target.slice(Math.max(0, start - 55), start), target.slice(end, end + 80))) {
          hit = match[0];
          break;
        }
      }
      if (!hit) continue;
      flags.add(`${label}: ${rule.label} (감지: ${hit.slice(0, 24)})`);
      if (level === "clear" || rule.level === "high") level = rule.level;
    }
  }

  return { level, flags: [...flags].slice(0, 10) };
}
