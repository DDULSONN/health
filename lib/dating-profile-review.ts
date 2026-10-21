import { reviewOneOnOneName } from "@/lib/dating-1on1-name-review";
import { reviewDatingSexualText } from "@/lib/dating-sexual-text-review";
import { reviewDatingIntroQuality } from "@/lib/dating-intro-quality-review";
import { reviewDatingProfanity } from "@/lib/dating-profanity-review";
import { reviewDatingContactText } from "@/lib/dating-contact-text-review";
import { buildSignedImageUrlAllowRaw, extractStorageObjectPathFromBuckets } from "@/lib/images";
import { reviewContentFingerprint, reviewFindingsFingerprint } from "@/lib/dating-review-confirmation";

export type SourceType =
  | "open_card"
  | "paid_card"
  | "one_on_one"
  | "open_card_application"
  | "paid_card_application"
  | "one_on_one_application";
export type SuspicionLevel = "clear" | "low" | "medium" | "high";
export type CandidateCard = {
  sourceType: SourceType;
  cardId: string;
  userId: string | null;
  status: string | null;
  displayName: string;
  age: number | null;
  region: string | null;
  texts: Record<string, string>;
  photoPaths: string[];
  bucket: string;
  previewUrls: string[];
  createdAt: string | null;
  editLocked?: boolean;
};

export type CardReview = {
  suspicionLevel: SuspicionLevel;
  flags: string[];
  summary: string;
  photoFlags: string[];
  textFlags: string[];
  raw: Record<string, unknown>;
};

export const REVIEW_RULES_VERSION = "2026-10-21-context-aware-v5";

const COMMERCIAL_PATTERNS = [
  /(광고|홍보|협찬|제휴|업체)\s*(문의|가능|환영|주세요|받아요)/i,
  // Ordinary jobs/hobbies (체대출신, 외부업무, 코인노래방, 투자 공부) are not solicitations.
  /(?:^|[\s.,!?])(?:부업|수익|투자|코인|토토|바카라|카지노|대출|리딩방|공구)\s*(?:(?:을|를|에|로|으로|관련|원금|고수익|수익|참여|상품|종목|방)\s*){0,2}(?:문의|모집|가능|추천|링크|보장|안내|상담|해드|시켜드|도와드)/i,
  /(이벤트|무료)\s*(참여|모집|신청|링크|쿠폰)/i,
];
const UNSAFE_PATTERNS = [/조건\s*만남|조건만남|스폰|성인\s*만남|19금|불법|계좌|입금|후원|대가\s*성/i];

export function cleanText(value: unknown, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

export function formatOneOnOneDisplayName(name: unknown, nickname: unknown) {
  const cleanName = cleanText(name, 80);
  const cleanNickname = cleanText(nickname, 80);
  if (cleanName && cleanNickname && cleanName !== cleanNickname) return `${cleanName} (닉네임: ${cleanNickname})`;
  return cleanName || cleanNickname;
}

export function sourceLabel(value: SourceType) {
  if (value === "open_card") return "오픈카드";
  if (value === "paid_card") return "유료카드";
  if (value === "one_on_one") return "1대1 카드";
  if (value === "open_card_application") return "오픈카드 지원";
  if (value === "paid_card_application") return "유료카드 지원";
  return "1대1 지원";
}

function likelyTextFlags(texts: Record<string, string>) {
  const reviewTexts = ["intro", "strengths", "ideal", "idealType", "preferredPartner"]
    .map((key) => (texts[key] ?? "").trim())
    .filter(Boolean);
  const flags: string[] = [];

  if (reviewTexts.some(text => COMMERCIAL_PATTERNS.some(pattern => pattern.test(text)))) flags.push("광고/상업성 문구 의심");
  if (reviewTexts.some(text => UNSAFE_PATTERNS.some(pattern => pattern.test(text)))) flags.push("부적절/위험 키워드");

  return flags;
}

export function ruleReview(card: CandidateCard): CardReview {
  const photoFlags: string[] = [];
  const sexualReview = reviewDatingSexualText({ ...card.texts, displayName: card.displayName });
  const qualityReview = reviewDatingIntroQuality(card.sourceType, card.texts);
  const profanityReview = reviewDatingProfanity({ ...card.texts, displayName: card.displayName });
  const contactReview = reviewDatingContactText(card.texts);
  const otherTextFlags = likelyTextFlags(card.texts);
  // Reserve a visible finding for each category before filling the ten-item cap.
  // Repeated handles must not hide a sexual/profanity finding from the administrator.
  const groups = [sexualReview.flags, profanityReview.flags, contactReview.flags, otherTextFlags, qualityReview.flags];
  const textFlags = [...groups.flatMap(group => group.slice(0, 1)), ...groups.flatMap(group => group.slice(1))];
  let nameLevel: SuspicionLevel = "clear";
  if (card.sourceType === "one_on_one" || card.sourceType === "one_on_one_application") {
    const nameReview = reviewOneOnOneName(card.texts.name ?? card.displayName);
    if (nameReview.suspicious) nameLevel = nameReview.level;
    textFlags.push(...nameReview.flags.map((flag) => `이름: ${flag}`));
  }
  const flags: string[] = [];
  const requiredTextFields = Object.entries(card.texts).filter(([key]) => !/instagram|job/i.test(key));

  if (!card.displayName) flags.push("닉네임/이름 없음");
  if (card.photoPaths.length === 0) photoFlags.push("사진 없음");
  if (card.photoPaths.length === 1) photoFlags.push("사진 1장만 등록");

  for (const [key, value] of requiredTextFields) {
    const trimmed = value.trim();
    if (!trimmed) {
      textFlags.push(`${key} 비어 있음`);
    }
  }

  flags.push(...textFlags, ...photoFlags);
  const uniqueFlags = Array.from(new Set(flags)).slice(0, 10);
  const hasSeriousFlag = otherTextFlags.some((flag) =>
    ["연락처", "외부 계정", "광고", "상업", "전화번호", "링크"].some((keyword) => flag.includes(keyword))
  );
  const suspicionLevel: SuspicionLevel =
    sexualReview.level === "high" || profanityReview.level === "high" || contactReview.level === "high" || nameLevel === "high" || hasSeriousFlag || uniqueFlags.length >= 4
      ? "high"
      : sexualReview.level === "medium" || profanityReview.level === "medium" || contactReview.level === "medium" || nameLevel === "medium" || qualityReview.level === "medium" || uniqueFlags.length >= 2
        ? "medium"
        : uniqueFlags.length === 1
          ? "low"
          : "clear";

  return {
    suspicionLevel,
    flags: uniqueFlags,
    summary:
      uniqueFlags.length > 0
        ? `${sourceLabel(card.sourceType)} 일반 검수: ${uniqueFlags.slice(0, 3).join(", ")}`
        : `${sourceLabel(card.sourceType)} 일반 검수상 큰 이상 없음`,
    photoFlags,
    textFlags: Array.from(new Set(textFlags)).slice(0, 10),
    raw: { provider: "rules", version: REVIEW_RULES_VERSION },
  };
}

export function oneOnOneReviewCandidate(row: Record<string, unknown>, nickname?: string): CandidateCard {
  const photoPaths = Array.isArray(row.photo_paths) ? row.photo_paths.map((value) => {
    const raw = cleanText(value, 500);
    return raw ? extractStorageObjectPathFromBuckets(raw, ["dating-1on1-photos"]) ?? raw.replace(/^\/+/, "") : "";
  }).filter(Boolean).slice(0, 3) : [];
  return {
    sourceType: "one_on_one", cardId: cleanText(row.id, 80),
    userId: cleanText(row.user_id, 80) || null, status: cleanText(row.status, 40) || null,
    displayName: formatOneOnOneDisplayName(row.name, nickname),
    age: typeof row.birth_year === "number" ? new Date().getFullYear() - row.birth_year + 1 : null,
    region: cleanText(row.region, 80) || null,
    texts: {
      name: cleanText(row.name, 80), job: cleanText(row.job, 80),
      intro: cleanText(row.intro_text, 2000), strengths: cleanText(row.strengths_text, 2000),
      preferredPartner: cleanText(row.preferred_partner_text, 2000),
    },
    photoPaths, bucket: "dating-1on1-photos",
    previewUrls: photoPaths.slice(0, 2).map(path => buildSignedImageUrlAllowRaw("dating-1on1-photos", path)),
    createdAt: cleanText(row.created_at, 80) || null,
    editLocked: Array.isArray(row.admin_tags) && row.admin_tags.includes("one_on_one_edit_locked"),
  };
}

export function withReviewSnapshot(card: CandidateCard, review: CardReview): CardReview {
  return { ...review, raw: { ...review.raw, confirmationRulesVersion: REVIEW_RULES_VERSION, confirmationSnapshot: {
    contentFingerprint: reviewContentFingerprint(card),
    findingsFingerprint: reviewFindingsFingerprint(review, REVIEW_RULES_VERSION),
  } } };
}
