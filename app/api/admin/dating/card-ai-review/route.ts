import { NextResponse } from "next/server";
import { requireAdminRoute } from "@/lib/admin-route";
import { recordAdminAuditEvent } from "@/lib/admin-audit";
import { promotePendingCardsBySex } from "@/lib/dating-cards-queue";
import { sendDatingEmailToAddressDetailed } from "@/lib/dating-swipe";
import { buildSignedImageUrlAllowRaw, extractStorageObjectPathFromBuckets } from "@/lib/images";
import { createAdminClient } from "@/lib/supabase/server";

type SourceType =
  | "open_card"
  | "paid_card"
  | "one_on_one"
  | "open_card_application"
  | "paid_card_application"
  | "one_on_one_application";
type ReviewMode = "rules" | "ai";
type SuspicionLevel = "clear" | "low" | "medium" | "high";
type AdminClient = ReturnType<typeof createAdminClient>;

type ReviewPayload = {
  source?: unknown;
  limit?: unknown;
  includeClear?: unknown;
  mode?: unknown;
};

type ReviewActionPayload = {
  action?: unknown;
  sourceType?: unknown;
  source_type?: unknown;
  cardId?: unknown;
  card_id?: unknown;
  summary?: unknown;
  flags?: unknown;
  fields?: unknown;
};

type CandidateCard = {
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
};

type CardReview = {
  suspicionLevel: SuspicionLevel;
  flags: string[];
  summary: string;
  photoFlags: string[];
  textFlags: string[];
  raw: Record<string, unknown>;
};

type ActionCard = {
  sourceType: SourceType;
  cardId: string;
  userId: string;
  status: string | null;
  displayName: string | null;
  sex: "male" | "female" | null;
};

type EditableFields = {
  displayName: string;
  job: string;
  region: string;
  intro: string;
  strengths: string;
  ideal: string;
  preferredPartner: string;
  instagramId: string;
};

const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const SOURCE_TYPES: SourceType[] = [
  "open_card",
  "paid_card",
  "one_on_one",
  "open_card_application",
  "paid_card_application",
  "one_on_one_application",
];
const SUSPICIOUS_LEVELS = new Set<SuspicionLevel>(["medium", "high"]);
const TEST_TEXT_PATTERNS = [/테스트|test|asdf|qwer|ㄹㄹ|ㅁㄴㅇ|ㅇㅇㅇ/i];
const EXTERNAL_CONTACT_PATTERNS = [
  /https?:\/\/|www\.|open\.kakao|t\.me|instagram\.com|bit\.ly|linktr\.ee/i,
  /오픈\s*카톡|오픈\s*채팅|카카오톡|카톡\s*(아이디|id|문의|주세요|ㄱ)|디엠|dm\s*(주세요|문의|ㄱ)|텔레그램|telegram|라인\s*(id|아이디)?|line\s*(id)?/i,
];
const DIRECT_CONTACT_PATTERNS = [
  /(?:010|011|016|017|018|019)[-\s.)]*(?:\d[-\s.]*){7,8}/,
  /\b01[016789][^\d]{0,3}\d{3,4}[^\d]{0,3}\d{4}\b/,
  /(카카오톡|카톡|오픈카톡|오픈채팅|kakao|kakaotalk).{0,18}(아이디|id|검색|추가|친추|연락|주세요|주세용|보내|남겨)/i,
  /(카카오톡|카톡|kakao|kakaotalk)\s*[:：]?\s*[A-Za-z0-9._-]{2,}/i,
  /(인스타|instagram|insta|ig|디엠|dm).{0,18}(아이디|id|계정|검색|팔로우|연락|주세요|주세용|보내|남겨)/i,
  /(^|[^A-Za-z0-9._])@[A-Za-z0-9._]{3,}/i,
  /(라인|line|텔레그램|telegram|텔레)\s*[:：]?\s*[A-Za-z0-9._-]{2,}/i,
  /(연락처|연락|번호|전화|문자).{0,16}(주세요|주세용|가능|해요|할게|남겨|교환|010|카톡|카카오|인스타|dm|디엠)/i,
];

const COMMERCIAL_PATTERNS = [
  /(광고|홍보|협찬|제휴|업체)\s*(문의|가능|환영|주세요|받아요)/i,
  /(부업|수익|투자|코인|토토|바카라|카지노|대출|리딩방|공구)\s*(문의|모집|가능|추천|링크)?/i,
  /(이벤트|무료)\s*(참여|모집|신청|링크|쿠폰)/i,
];
const UNSAFE_PATTERNS = [/조건\s*만남|조건만남|스폰|성인\s*만남|19금|불법|계좌|입금|후원|대가\s*성/i];

function cleanText(value: unknown, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function parseLimit(value: unknown, mode: ReviewMode) {
  const num = Number(value);
  const fallback = mode === "rules" ? 50 : 12;
  const max = mode === "rules" ? 200 : 25;
  if (!Number.isFinite(num)) return fallback;
  return Math.min(Math.max(Math.floor(num), 1), max);
}

function normalizeSource(value: unknown): SourceType | "all" {
  const source = cleanText(value, 30);
  return SOURCE_TYPES.includes(source as SourceType) ? (source as SourceType) : "all";
}

function normalizeMode(value: unknown): ReviewMode {
  return cleanText(value, 20) === "rules" ? "rules" : "ai";
}

function normalizeAction(value: unknown) {
  const action = cleanText(value, 40);
  return action === "delete_card" || action === "send_warning_email" || action === "update_fields" ? action : "";
}

function cleanArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => cleanText(item, 80)).filter(Boolean).slice(0, 8);
}

function emptyEditableFields(): EditableFields {
  return {
    displayName: "",
    job: "",
    region: "",
    intro: "",
    strengths: "",
    ideal: "",
    preferredPartner: "",
    instagramId: "",
  };
}

function cleanEditableFields(value: unknown): EditableFields {
  if (!value || typeof value !== "object") return emptyEditableFields();
  const raw = value as Record<string, unknown>;
  return {
    displayName: cleanText(raw.displayName, 80),
    job: cleanText(raw.job, 80),
    region: cleanText(raw.region, 80),
    intro: cleanText(raw.intro, 2000),
    strengths: cleanText(raw.strengths, 1000),
    ideal: cleanText(raw.ideal, 1000),
    preferredPartner: cleanText(raw.preferredPartner, 1000),
    instagramId: cleanText(raw.instagramId, 80),
  };
}

function getSiteUrl() {
  return (process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL || "https://helchang.com").replace(/\/+$/, "");
}

function getCardEditPath(sourceType: SourceType, cardId: string) {
  if (sourceType === "open_card") return `/dating/card/new?editId=${encodeURIComponent(cardId)}`;
  if (sourceType === "paid_card") return `/dating/paid?editId=${encodeURIComponent(cardId)}`;
  return `/dating/1on1?editId=${encodeURIComponent(cardId)}`;
}

function normalizePhotoPath(raw: unknown, buckets: string[]) {
  const value = cleanText(raw, 500);
  if (!value) return "";
  return extractStorageObjectPathFromBuckets(value, buckets) ?? value.replace(/^\/+/, "");
}

function pathsFromUnknown(raw: unknown, buckets: string[]) {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => normalizePhotoPath(item, buckets)).filter(Boolean).slice(0, 3);
}

function sourceLabel(value: SourceType) {
  if (value === "open_card") return "오픈카드";
  if (value === "paid_card") return "유료카드";
  if (value === "one_on_one") return "1대1 카드";
  if (value === "open_card_application") return "오픈카드 지원";
  if (value === "paid_card_application") return "유료카드 지원";
  return "1대1 지원";
}

function likelyTextFlags(texts: Record<string, string>) {
  const reviewTexts = Object.entries(texts)
    .filter(([key]) => !/instagram|job/i.test(key))
    .map(([, value]) => value.trim())
    .filter(Boolean);
  const merged = reviewTexts.join(" ").trim();
  const flags: string[] = [];

  if (merged.length > 0 && merged.length < 8) flags.push("소개 문구가 거의 없음");
  if (TEST_TEXT_PATTERNS.some((pattern) => pattern.test(merged))) {
    flags.push("테스트/장난성 문구");
  }
  if (/([가-힣A-Za-z0-9])\1{4,}/u.test(merged)) flags.push("반복 문자 과다");
  if (/010[-\s]?\d{3,4}[-\s]?\d{4}/.test(merged)) flags.push("전화번호 직접 노출 의심");
  if (DIRECT_CONTACT_PATTERNS.some((pattern) => pattern.test(merged))) flags.push("연락처/외부 계정 선노출 의심");
  if (EXTERNAL_CONTACT_PATTERNS.some((pattern) => pattern.test(merged))) flags.push("외부 연락/링크 유도 의심");
  if (COMMERCIAL_PATTERNS.some((pattern) => pattern.test(merged))) flags.push("광고/상업성 문구 의심");
  if (UNSAFE_PATTERNS.some((pattern) => pattern.test(merged))) flags.push("부적절/위험 키워드");

  return flags;
}

function ruleReview(card: CandidateCard): CardReview {
  const photoFlags: string[] = [];
  const textFlags = likelyTextFlags(card.texts);
  const flags: string[] = [];
  const requiredTextFields = Object.entries(card.texts).filter(([key]) => !/instagram|job/i.test(key));

  if (!card.displayName) flags.push("닉네임/이름 없음");
  if (card.photoPaths.length === 0) photoFlags.push("사진 없음");
  if (card.photoPaths.length === 1 && card.sourceType !== "paid_card") photoFlags.push("사진 1장만 등록");

  for (const [key, value] of requiredTextFields) {
    const trimmed = value.trim();
    if (!trimmed) {
      textFlags.push(`${key} 비어 있음`);
    }
  }

  flags.push(...photoFlags, ...textFlags);
  const uniqueFlags = Array.from(new Set(flags)).slice(0, 10);
  const hasSeriousFlag = uniqueFlags.some((flag) =>
    ["연락처", "외부 계정", "광고", "상업", "전화번호", "링크"].some((keyword) => flag.includes(keyword))
  );
  const suspicionLevel: SuspicionLevel =
    hasSeriousFlag || uniqueFlags.length >= 4
      ? "high"
      : uniqueFlags.length >= 2
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
    raw: { provider: "rules", version: "2026-05-23-2" },
  };
}

function parseAiJson(text: string): CardReview | null {
  const jsonText = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const firstBrace = jsonText.indexOf("{");
  const lastBrace = jsonText.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) return null;

  try {
    const parsed = JSON.parse(jsonText.slice(firstBrace, lastBrace + 1)) as Record<string, unknown>;
    const rawLevel = cleanText(parsed.suspicionLevel, 20);
    const suspicionLevel: SuspicionLevel =
      rawLevel === "high" || rawLevel === "medium" || rawLevel === "low" || rawLevel === "clear" ? rawLevel : "low";
    const flags = cleanArray(parsed.flags);
    const photoFlags = cleanArray(parsed.photoFlags);
    const textFlags = cleanArray(parsed.textFlags);

    return {
      suspicionLevel,
      flags: Array.from(new Set([...flags, ...photoFlags, ...textFlags])).slice(0, 10),
      summary: cleanText(parsed.summary, 500) || "AI 검수 결과 요약 없음",
      photoFlags,
      textFlags,
      raw: parsed,
    };
  } catch {
    return null;
  }
}

function extractGeminiText(payload: unknown) {
  const data = payload as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  return data.candidates?.flatMap((candidate) => candidate.content?.parts ?? []).map((part) => part.text ?? "").join("\n").trim() ?? "";
}

async function downloadImagePart(admin: AdminClient, bucket: string, path: string) {
  const buckets = bucket === "dating-card-photos" ? ["dating-card-photos", "dating-photos"] : [bucket];

  for (const bucketName of buckets) {
    const res = await admin.storage.from(bucketName).download(path);
    if (res.data && !res.error) {
      const buffer = Buffer.from(await res.data.arrayBuffer());
      if (buffer.byteLength > 0) {
        return {
          inlineData: {
            mimeType: res.data.type || "image/jpeg",
            data: buffer.toString("base64"),
          },
        };
      }
    }
  }

  return null;
}

async function analyzeWithGemini(admin: AdminClient, apiKey: string, model: string, card: CandidateCard): Promise<CardReview> {
  const imageParts = (
    await Promise.all(card.photoPaths.slice(0, 2).map((path) => downloadImagePart(admin, card.bucket, path)))
  ).filter(Boolean);
  const heuristic = ruleReview(card);
  const prompt = [
    "특히 1:1 매칭 신청서에 휴대폰 번호, 카카오톡/카톡 ID, 오픈채팅 링크, 인스타/IG 계정, DM 요청, 라인/텔레그램 ID 등 앱 밖 연락처를 적거나 유도하면 high로 판단한다.",
    "너는 소개팅 서비스의 관리자 검수 보조 AI다.",
    "절대 삭제, 거절, 유저 제재를 결정하지 말고 관리자에게 보여줄 의심 사유만 판단한다.",
    "검수 기준: 빈 사진/흰 화면/검은 화면/캡처/광고/로고/텍스트만 있는 이미지/사람 사진이 아닌 이미지/장난식 소개글/광고성 문구/외부 연락 유도/소개글 비어있음.",
    "외모 평가, 매력 평가, 본인 여부 단정, 성별/나이 추정은 하지 않는다.",
    "정상으로 보이면 clear를 반환한다. 애매하면 low, 실제 확인 필요하면 medium/high.",
    "반드시 JSON 하나만 반환한다.",
    `카드 종류: ${card.sourceType}`,
    `상태: ${card.status ?? "-"}`,
    `이름/닉네임: ${card.displayName || "-"}`,
    `나이/지역: ${card.age ?? "-"} / ${card.region ?? "-"}`,
    `텍스트: ${JSON.stringify(card.texts)}`,
    `일반 검수 플래그: ${heuristic.flags.join(", ") || "없음"}`,
    'JSON 형식: {"suspicionLevel":"clear|low|medium|high","flags":["짧은 사유"],"summary":"관리자가 바로 이해할 한 문장","photoFlags":["사진 관련 사유"],"textFlags":["문구 관련 사유"]}',
  ].join("\n");

  try {
    const res = await fetch(`${GEMINI_API_URL}/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }, ...imageParts] }],
        generationConfig: {
          temperature: 0.1,
          topP: 0.7,
          maxOutputTokens: 700,
          responseMimeType: "application/json",
        },
      }),
    });

    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ...heuristic, raw: { ...heuristic.raw, provider: "rules_fallback", geminiStatus: res.status, geminiError: payload } };
    }

    const parsed = parseAiJson(extractGeminiText(payload));
    if (!parsed) return { ...heuristic, raw: { ...heuristic.raw, provider: "rules_fallback", geminiParseFailed: true } };

    return {
      ...parsed,
      flags: Array.from(new Set([...heuristic.flags, ...parsed.flags])).slice(0, 10),
      raw: { provider: "gemini", model, result: parsed.raw, rulesFlags: heuristic.flags },
    };
  } catch (error) {
    return {
      ...heuristic,
      raw: { ...heuristic.raw, provider: "rules_fallback", geminiError: error instanceof Error ? error.message : "unknown" },
    };
  }
}

async function fetchOpenCards(admin: AdminClient, limit: number): Promise<CandidateCard[]> {
  const { data, error } = await admin
    .from("dating_cards")
    .select("id,owner_user_id,status,display_nickname,age,region,job,ideal_type,strengths_text,instagram_id,photo_paths,created_at")
    .in("status", ["pending", "public"])
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;

  return ((data ?? []) as Record<string, unknown>[]).map((row) => {
    const photoPaths = pathsFromUnknown(row.photo_paths, ["dating-card-photos", "dating-photos"]);
    return {
      sourceType: "open_card",
      cardId: cleanText(row.id, 80),
      userId: cleanText(row.owner_user_id, 80) || null,
      status: cleanText(row.status, 40) || null,
      displayName: cleanText(row.display_nickname, 80),
      age: typeof row.age === "number" ? row.age : null,
      region: cleanText(row.region, 80) || null,
      texts: {
        job: cleanText(row.job, 80),
        idealType: cleanText(row.ideal_type, 500),
        strengths: cleanText(row.strengths_text, 500),
        instagramId: cleanText(row.instagram_id, 80),
      },
      photoPaths,
      bucket: "dating-card-photos",
      previewUrls: photoPaths.slice(0, 2).map((path) => buildSignedImageUrlAllowRaw("dating-card-photos", path)),
      createdAt: cleanText(row.created_at, 80) || null,
    };
  });
}

async function fetchPaidCards(admin: AdminClient, limit: number): Promise<CandidateCard[]> {
  const { data, error } = await admin
    .from("dating_paid_cards")
    .select("id,user_id,status,nickname,age,region,job,strengths_text,ideal_text,intro_text,instagram_id,photo_paths,created_at")
    .in("status", ["pending", "approved"])
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;

  return ((data ?? []) as Record<string, unknown>[]).map((row) => {
    const photoPaths = pathsFromUnknown(row.photo_paths, ["dating-card-photos", "dating-photos"]);
    return {
      sourceType: "paid_card",
      cardId: cleanText(row.id, 80),
      userId: cleanText(row.user_id, 80) || null,
      status: cleanText(row.status, 40) || null,
      displayName: cleanText(row.nickname, 80),
      age: typeof row.age === "number" ? row.age : null,
      region: cleanText(row.region, 80) || null,
      texts: {
        job: cleanText(row.job, 80),
        strengths: cleanText(row.strengths_text, 500),
        ideal: cleanText(row.ideal_text, 500),
        intro: cleanText(row.intro_text, 500),
        instagramId: cleanText(row.instagram_id, 80),
      },
      photoPaths,
      bucket: "dating-card-photos",
      previewUrls: photoPaths.slice(0, 2).map((path) => buildSignedImageUrlAllowRaw("dating-card-photos", path)),
      createdAt: cleanText(row.created_at, 80) || null,
    };
  });
}

async function fetchOneOnOneCards(admin: AdminClient, limit: number): Promise<CandidateCard[]> {
  const { data, error } = await admin
    .from("dating_1on1_cards")
    .select("id,user_id,status,name,birth_year,region,job,intro_text,strengths_text,preferred_partner_text,photo_paths,created_at")
    .in("status", ["submitted", "reviewing", "approved"])
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;

  const currentYear = new Date().getFullYear();
  return ((data ?? []) as Record<string, unknown>[]).map((row) => {
    const photoPaths = pathsFromUnknown(row.photo_paths, ["dating-1on1-photos"]);
    return {
      sourceType: "one_on_one",
      cardId: cleanText(row.id, 80),
      userId: cleanText(row.user_id, 80) || null,
      status: cleanText(row.status, 40) || null,
      displayName: cleanText(row.name, 80),
      age: typeof row.birth_year === "number" ? currentYear - row.birth_year + 1 : null,
      region: cleanText(row.region, 80) || null,
      texts: {
        job: cleanText(row.job, 80),
        intro: cleanText(row.intro_text, 500),
        strengths: cleanText(row.strengths_text, 500),
        preferredPartner: cleanText(row.preferred_partner_text, 500),
      },
      photoPaths,
      bucket: "dating-1on1-photos",
      previewUrls: photoPaths.slice(0, 2).map((path) => buildSignedImageUrlAllowRaw("dating-1on1-photos", path)),
      createdAt: cleanText(row.created_at, 80) || null,
    };
  });
}

async function fetchOpenCardApplications(admin: AdminClient, limit: number): Promise<CandidateCard[]> {
  const { data, error } = await admin
    .from("dating_card_applications")
    .select("id,card_id,applicant_user_id,applicant_display_nickname,age,height_cm,region,job,training_years,intro_text,instagram_id,photo_paths,status,created_at")
    .in("status", ["submitted", "accepted"])
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;

  return ((data ?? []) as Record<string, unknown>[]).map((row) => {
    const photoPaths = pathsFromUnknown(row.photo_paths, ["dating-card-photos", "dating-photos"]);
    return {
      sourceType: "open_card_application",
      cardId: cleanText(row.id, 80),
      userId: cleanText(row.applicant_user_id, 80) || null,
      status: cleanText(row.status, 40) || null,
      displayName: cleanText(row.applicant_display_nickname, 80),
      age: typeof row.age === "number" ? row.age : null,
      region: cleanText(row.region, 80) || null,
      texts: {
        targetCardId: cleanText(row.card_id, 80),
        job: cleanText(row.job, 80),
        height: cleanText(row.height_cm, 20),
        trainingYears: cleanText(row.training_years, 20),
        intro: cleanText(row.intro_text, 500),
        instagramId: cleanText(row.instagram_id, 80),
      },
      photoPaths,
      bucket: "dating-card-photos",
      previewUrls: photoPaths.slice(0, 2).map((path) => buildSignedImageUrlAllowRaw("dating-card-photos", path)),
      createdAt: cleanText(row.created_at, 80) || null,
    };
  });
}

async function fetchPaidCardApplications(admin: AdminClient, limit: number): Promise<CandidateCard[]> {
  const { data, error } = await admin
    .from("dating_paid_card_applications")
    .select("id,paid_card_id,applicant_user_id,applicant_display_nickname,age,height_cm,region,job,training_years,intro_text,instagram_id,photo_paths,status,created_at")
    .in("status", ["submitted", "accepted"])
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;

  return ((data ?? []) as Record<string, unknown>[]).map((row) => {
    const photoPaths = pathsFromUnknown(row.photo_paths, ["dating-card-photos", "dating-photos"]);
    return {
      sourceType: "paid_card_application",
      cardId: cleanText(row.id, 80),
      userId: cleanText(row.applicant_user_id, 80) || null,
      status: cleanText(row.status, 40) || null,
      displayName: cleanText(row.applicant_display_nickname, 80),
      age: typeof row.age === "number" ? row.age : null,
      region: cleanText(row.region, 80) || null,
      texts: {
        targetCardId: cleanText(row.paid_card_id, 80),
        job: cleanText(row.job, 80),
        height: cleanText(row.height_cm, 20),
        trainingYears: cleanText(row.training_years, 20),
        intro: cleanText(row.intro_text, 500),
        instagramId: cleanText(row.instagram_id, 80),
      },
      photoPaths,
      bucket: "dating-card-photos",
      previewUrls: photoPaths.slice(0, 2).map((path) => buildSignedImageUrlAllowRaw("dating-card-photos", path)),
      createdAt: cleanText(row.created_at, 80) || null,
    };
  });
}

async function fetchOneOnOneApplications(admin: AdminClient, limit: number): Promise<CandidateCard[]> {
  const cards = await fetchOneOnOneCards(admin, limit);
  return cards.map((card) => ({ ...card, sourceType: "one_on_one_application" }));
}

async function fetchCandidates(admin: AdminClient, source: SourceType | "all", limit: number) {
  if (source === "open_card") return fetchOpenCards(admin, limit);
  if (source === "paid_card") return fetchPaidCards(admin, limit);
  if (source === "one_on_one") return fetchOneOnOneCards(admin, limit);
  if (source === "open_card_application") return fetchOpenCardApplications(admin, limit);
  if (source === "paid_card_application") return fetchPaidCardApplications(admin, limit);
  if (source === "one_on_one_application") return fetchOneOnOneApplications(admin, limit);

  const eachLimit = Math.max(3, Math.ceil(limit / 6));
  const rows = await Promise.all([
    fetchOpenCards(admin, eachLimit),
    fetchPaidCards(admin, eachLimit),
    fetchOneOnOneCards(admin, eachLimit),
    fetchOpenCardApplications(admin, eachLimit),
    fetchPaidCardApplications(admin, eachLimit),
    fetchOneOnOneApplications(admin, eachLimit),
  ]);
  return rows.flat().sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? ""))).slice(0, limit);
}

async function loadCandidateById(admin: AdminClient, sourceType: SourceType, cardId: string): Promise<CandidateCard | null> {
  if (sourceType === "open_card") {
    const { data, error } = await admin
      .from("dating_cards")
      .select("id,owner_user_id,status,display_nickname,age,region,job,ideal_type,strengths_text,instagram_id,photo_paths,created_at")
      .eq("id", cardId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const row = data as Record<string, unknown>;
    const photoPaths = pathsFromUnknown(row.photo_paths, ["dating-card-photos", "dating-photos"]);
    return {
      sourceType,
      cardId: cleanText(row.id, 80),
      userId: cleanText(row.owner_user_id, 80) || null,
      status: cleanText(row.status, 40) || null,
      displayName: cleanText(row.display_nickname, 80),
      age: typeof row.age === "number" ? row.age : null,
      region: cleanText(row.region, 80) || null,
      texts: {
        job: cleanText(row.job, 80),
        idealType: cleanText(row.ideal_type, 500),
        strengths: cleanText(row.strengths_text, 500),
        instagramId: cleanText(row.instagram_id, 80),
      },
      photoPaths,
      bucket: "dating-card-photos",
      previewUrls: photoPaths.slice(0, 2).map((path) => buildSignedImageUrlAllowRaw("dating-card-photos", path)),
      createdAt: cleanText(row.created_at, 80) || null,
    };
  }

  if (sourceType === "paid_card") {
    const { data, error } = await admin
      .from("dating_paid_cards")
      .select("id,user_id,status,nickname,age,region,job,strengths_text,ideal_text,intro_text,instagram_id,photo_paths,created_at")
      .eq("id", cardId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const row = data as Record<string, unknown>;
    const photoPaths = pathsFromUnknown(row.photo_paths, ["dating-card-photos", "dating-photos"]);
    return {
      sourceType,
      cardId: cleanText(row.id, 80),
      userId: cleanText(row.user_id, 80) || null,
      status: cleanText(row.status, 40) || null,
      displayName: cleanText(row.nickname, 80),
      age: typeof row.age === "number" ? row.age : null,
      region: cleanText(row.region, 80) || null,
      texts: {
        job: cleanText(row.job, 80),
        strengths: cleanText(row.strengths_text, 500),
        ideal: cleanText(row.ideal_text, 500),
        intro: cleanText(row.intro_text, 500),
        instagramId: cleanText(row.instagram_id, 80),
      },
      photoPaths,
      bucket: "dating-card-photos",
      previewUrls: photoPaths.slice(0, 2).map((path) => buildSignedImageUrlAllowRaw("dating-card-photos", path)),
      createdAt: cleanText(row.created_at, 80) || null,
    };
  }

  if (sourceType === "open_card_application") {
    const { data, error } = await admin
      .from("dating_card_applications")
      .select("id,card_id,applicant_user_id,applicant_display_nickname,age,height_cm,region,job,training_years,intro_text,instagram_id,photo_paths,status,created_at")
      .eq("id", cardId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const row = data as Record<string, unknown>;
    const photoPaths = pathsFromUnknown(row.photo_paths, ["dating-card-photos", "dating-photos"]);
    return {
      sourceType,
      cardId: cleanText(row.id, 80),
      userId: cleanText(row.applicant_user_id, 80) || null,
      status: cleanText(row.status, 40) || null,
      displayName: cleanText(row.applicant_display_nickname, 80),
      age: typeof row.age === "number" ? row.age : null,
      region: cleanText(row.region, 80) || null,
      texts: {
        targetCardId: cleanText(row.card_id, 80),
        job: cleanText(row.job, 80),
        height: cleanText(row.height_cm, 20),
        trainingYears: cleanText(row.training_years, 20),
        intro: cleanText(row.intro_text, 500),
        instagramId: cleanText(row.instagram_id, 80),
      },
      photoPaths,
      bucket: "dating-card-photos",
      previewUrls: photoPaths.slice(0, 2).map((path) => buildSignedImageUrlAllowRaw("dating-card-photos", path)),
      createdAt: cleanText(row.created_at, 80) || null,
    };
  }

  if (sourceType === "paid_card_application") {
    const { data, error } = await admin
      .from("dating_paid_card_applications")
      .select("id,paid_card_id,applicant_user_id,applicant_display_nickname,age,height_cm,region,job,training_years,intro_text,instagram_id,photo_paths,status,created_at")
      .eq("id", cardId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const row = data as Record<string, unknown>;
    const photoPaths = pathsFromUnknown(row.photo_paths, ["dating-card-photos", "dating-photos"]);
    return {
      sourceType,
      cardId: cleanText(row.id, 80),
      userId: cleanText(row.applicant_user_id, 80) || null,
      status: cleanText(row.status, 40) || null,
      displayName: cleanText(row.applicant_display_nickname, 80),
      age: typeof row.age === "number" ? row.age : null,
      region: cleanText(row.region, 80) || null,
      texts: {
        targetCardId: cleanText(row.paid_card_id, 80),
        job: cleanText(row.job, 80),
        height: cleanText(row.height_cm, 20),
        trainingYears: cleanText(row.training_years, 20),
        intro: cleanText(row.intro_text, 500),
        instagramId: cleanText(row.instagram_id, 80),
      },
      photoPaths,
      bucket: "dating-card-photos",
      previewUrls: photoPaths.slice(0, 2).map((path) => buildSignedImageUrlAllowRaw("dating-card-photos", path)),
      createdAt: cleanText(row.created_at, 80) || null,
    };
  }

  const { data, error } = await admin
    .from("dating_1on1_cards")
    .select("id,user_id,status,name,birth_year,region,job,intro_text,strengths_text,preferred_partner_text,photo_paths,created_at")
    .eq("id", cardId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as Record<string, unknown>;
  const photoPaths = pathsFromUnknown(row.photo_paths, ["dating-1on1-photos"]);
  const currentYear = new Date().getFullYear();
  return {
    sourceType,
    cardId: cleanText(row.id, 80),
    userId: cleanText(row.user_id, 80) || null,
    status: cleanText(row.status, 40) || null,
    displayName: cleanText(row.name, 80),
    age: typeof row.birth_year === "number" ? currentYear - row.birth_year + 1 : null,
    region: cleanText(row.region, 80) || null,
    texts: {
      job: cleanText(row.job, 80),
      intro: cleanText(row.intro_text, 500),
      strengths: cleanText(row.strengths_text, 500),
      preferredPartner: cleanText(row.preferred_partner_text, 500),
    },
    photoPaths,
    bucket: "dating-1on1-photos",
    previewUrls: photoPaths.slice(0, 2).map((path) => buildSignedImageUrlAllowRaw("dating-1on1-photos", path)),
    createdAt: cleanText(row.created_at, 80) || null,
  };
}

function editableFieldsFromCandidate(card: CandidateCard | null): EditableFields {
  if (!card) return emptyEditableFields();
  return {
    displayName: card.displayName,
    job: card.texts.job ?? "",
    region: card.region ?? "",
    intro: card.texts.intro ?? "",
    strengths: card.texts.strengths ?? "",
    ideal: card.texts.ideal ?? card.texts.idealType ?? "",
    preferredPartner: card.texts.preferredPartner ?? "",
    instagramId: card.texts.instagramId ?? "",
  };
}

function requiredText(value: string, fallback: string) {
  return value.trim() || fallback.trim();
}

async function hydrateReviewRows(admin: AdminClient, rows: Record<string, unknown>[]) {
  return Promise.all(
    rows.map(async (row) => {
      const sourceType = normalizeSource(row.source_type);
      const cardId = cleanText(row.card_id, 100);
      const current = sourceType === "all" || !cardId ? null : await loadCandidateById(admin, sourceType, cardId).catch(() => null);
      return {
        ...row,
        sourceType: sourceType === "all" ? row.source_type : sourceType,
        cardId,
        userId: current?.userId ?? (cleanText(row.user_id, 100) || null),
        status: current?.status ?? (cleanText(row.card_status, 40) || null),
        displayName: current?.displayName ?? cleanText(row.display_name, 80),
        age: current?.age ?? null,
        region: current?.region ?? null,
        previewUrls: current?.previewUrls ?? [],
        texts: current?.texts ?? {},
        editableFields: editableFieldsFromCandidate(current),
        createdAt: current?.createdAt ?? null,
      };
    })
  );
}

async function saveReview(admin: AdminClient, adminUserId: string, card: CandidateCard, review: CardReview) {
  const { error } = await admin.from("admin_dating_card_ai_reviews").upsert(
    {
      source_type: card.sourceType,
      card_id: card.cardId,
      user_id: card.userId,
      card_status: card.status,
      display_name: card.displayName,
      suspicion_level: review.suspicionLevel,
      flags: review.flags,
      summary: review.summary,
      photo_flags: review.photoFlags,
      text_flags: review.textFlags,
      raw_result: review.raw,
      scanned_at: new Date().toISOString(),
      admin_user_id: adminUserId,
    },
    { onConflict: "source_type,card_id" }
  );
  if (error) throw error;
}

async function loadActionCard(admin: AdminClient, sourceType: SourceType, cardId: string): Promise<ActionCard | null> {
  if (sourceType === "open_card_application") {
    const { data, error } = await admin
      .from("dating_card_applications")
      .select("id,applicant_user_id,status,applicant_display_nickname")
      .eq("id", cardId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return {
      sourceType,
      cardId: String(data.id),
      userId: String(data.applicant_user_id ?? ""),
      status: data.status ?? null,
      displayName: data.applicant_display_nickname ?? null,
      sex: null,
    };
  }

  if (sourceType === "paid_card_application") {
    const { data, error } = await admin
      .from("dating_paid_card_applications")
      .select("id,applicant_user_id,status,applicant_display_nickname")
      .eq("id", cardId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return {
      sourceType,
      cardId: String(data.id),
      userId: String(data.applicant_user_id ?? ""),
      status: data.status ?? null,
      displayName: data.applicant_display_nickname ?? null,
      sex: null,
    };
  }

  if (sourceType === "open_card") {
    const { data, error } = await admin
      .from("dating_cards")
      .select("id,owner_user_id,status,display_nickname,sex")
      .eq("id", cardId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return {
      sourceType,
      cardId: String(data.id),
      userId: String(data.owner_user_id ?? ""),
      status: data.status ?? null,
      displayName: data.display_nickname ?? null,
      sex: data.sex === "female" ? "female" : data.sex === "male" ? "male" : null,
    };
  }

  if (sourceType === "paid_card") {
    const { data, error } = await admin
      .from("dating_paid_cards")
      .select("id,user_id,status,nickname")
      .eq("id", cardId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return {
      sourceType,
      cardId: String(data.id),
      userId: String(data.user_id ?? ""),
      status: data.status ?? null,
      displayName: data.nickname ?? null,
      sex: null,
    };
  }

  const { data, error } = await admin
    .from("dating_1on1_cards")
    .select("id,user_id,status,name,sex")
    .eq("id", cardId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    sourceType,
    cardId: String(data.id),
    userId: String(data.user_id ?? ""),
    status: data.status ?? null,
    displayName: data.name ?? null,
    sex: data.sex === "female" ? "female" : data.sex === "male" ? "male" : null,
  };
}

async function deleteActionCard(admin: AdminClient, card: ActionCard) {
  if (card.sourceType === "open_card_application") {
    const { error } = await admin.from("dating_card_applications").delete().eq("id", card.cardId);
    if (error) throw error;
    await admin.from("dating_chat_threads").delete().eq("source_kind", "open").eq("source_id", card.cardId);
    return;
  }

  if (card.sourceType === "paid_card_application") {
    const { error } = await admin.from("dating_paid_card_applications").delete().eq("id", card.cardId);
    if (error) throw error;
    await admin.from("dating_chat_threads").delete().eq("source_kind", "paid").eq("source_id", card.cardId);
    return;
  }

  if (card.sourceType === "open_card") {
    const { error } = await admin.from("dating_cards").delete().eq("id", card.cardId);
    if (error) throw error;
    if (card.status === "public" && card.sex) {
      await promotePendingCardsBySex(admin, card.sex).catch((error) => {
        console.error("[admin card review] promote pending after delete failed", error);
      });
    }
    return;
  }

  if (card.sourceType === "paid_card") {
    const { error } = await admin.from("dating_paid_cards").delete().eq("id", card.cardId);
    if (error) throw error;
    return;
  }

  const { error } = await admin.from("dating_1on1_cards").delete().eq("id", card.cardId);
  if (error) throw error;
}

async function updateActionCardFields(admin: AdminClient, card: ActionCard, fields: EditableFields) {
  const current = await loadCandidateById(admin, card.sourceType, card.cardId);
  const existing = editableFieldsFromCandidate(current);
  const merged = { ...existing, ...fields };

  if (card.sourceType === "open_card") {
    const payload = {
      display_nickname: merged.displayName || null,
      job: merged.job || null,
      region: merged.region || null,
      strengths_text: merged.strengths ? merged.strengths.slice(0, 150) : null,
      ideal_type: merged.ideal || null,
      instagram_id: merged.instagramId || null,
    };
    const { error } = await admin.from("dating_cards").update(payload).eq("id", card.cardId);
    if (error) throw error;
    return { displayName: payload.display_nickname };
  }

  if (card.sourceType === "paid_card") {
    const payload = {
      nickname: merged.displayName || null,
      job: merged.job || null,
      region: merged.region || null,
      strengths_text: merged.strengths || null,
      ideal_text: merged.ideal || null,
      intro_text: merged.intro || null,
      instagram_id: merged.instagramId || null,
    };
    const { error } = await admin.from("dating_paid_cards").update(payload).eq("id", card.cardId);
    if (error) throw error;
    return { displayName: payload.nickname };
  }

  if (card.sourceType === "open_card_application") {
    const payload = {
      applicant_display_nickname: requiredText(merged.displayName, existing.displayName),
      job: merged.job || null,
      region: merged.region || null,
      intro_text: requiredText(merged.intro, existing.intro),
      instagram_id: merged.instagramId || null,
    };
    const { error } = await admin.from("dating_card_applications").update(payload).eq("id", card.cardId);
    if (error) throw error;
    return { displayName: payload.applicant_display_nickname };
  }

  if (card.sourceType === "paid_card_application") {
    const payload = {
      applicant_display_nickname: requiredText(merged.displayName, existing.displayName),
      job: merged.job || null,
      region: merged.region || null,
      intro_text: requiredText(merged.intro, existing.intro),
      instagram_id: merged.instagramId || null,
    };
    const { error } = await admin.from("dating_paid_card_applications").update(payload).eq("id", card.cardId);
    if (error) throw error;
    return { displayName: payload.applicant_display_nickname };
  }

  const payload = {
    name: requiredText(merged.displayName, existing.displayName),
    job: requiredText(merged.job, existing.job),
    region: requiredText(merged.region, existing.region),
    intro_text: requiredText(merged.intro, existing.intro),
    strengths_text: requiredText(merged.strengths, existing.strengths),
    preferred_partner_text: requiredText(merged.preferredPartner || merged.ideal, existing.preferredPartner || existing.ideal),
  };
  const { error } = await admin.from("dating_1on1_cards").update(payload).eq("id", card.cardId);
  if (error) throw error;
  return { displayName: payload.name };
}

async function sendCardWarningEmail(admin: AdminClient, card: ActionCard, summary: string, flags: string[]) {
  const userRes = await admin.auth.admin.getUserById(card.userId).catch(() => null);
  const email = userRes?.data?.user?.email?.trim();
  if (!email) return { ok: false, error: "회원 이메일을 찾지 못했습니다." };

  const editUrl = `${getSiteUrl()}${getCardEditPath(card.sourceType, card.cardId)}`;
  const flagText = flags.length > 0 ? `\n확인된 항목: ${flags.slice(0, 5).join(", ")}` : "";
  const subject = "[짐툴] 카드 수정이 필요합니다";
  const text = [
    "안녕하세요, 짐툴입니다.",
    "",
    "등록하신 카드에서 운영 기준상 확인이 필요한 내용이 발견되어 수정 요청드립니다.",
    "사진, 소개글, 외부 연락 유도, 광고성 문구, 부적절한 표현 등이 없는지 확인 후 수정해 주세요.",
    summary ? `검수 요약: ${summary}` : "",
    flagText.trim(),
    "",
    `수정하기: ${editUrl}`,
    "",
    "수정이 어렵거나 문의가 필요하면 짐툴 고객지원으로 연락해 주세요.",
  ]
    .filter(Boolean)
    .join("\n");

  const result = await sendDatingEmailToAddressDetailed(email, subject, text, {
    idempotencyKey: `card-review-warning:${card.sourceType}:${card.cardId}:${Date.now()}`,
  });
  return result.ok ? { ok: true, email } : { ok: false, error: result.error ?? "메일 발송에 실패했습니다." };
}

export async function GET(req: Request) {
  const guard = await requireAdminRoute();
  if (!guard.ok) return guard.response;

  const url = new URL(req.url);
  const source = normalizeSource(url.searchParams.get("source"));
  const includeClear = source !== "all" && String(source).endsWith("_application");
  let query = guard.admin
    .from("admin_dating_card_ai_reviews")
    .select("id,source_type,card_id,user_id,card_status,display_name,suspicion_level,flags,summary,photo_flags,text_flags,raw_result,scanned_at")
    .order("scanned_at", { ascending: false })
    .limit(50);

  if (source !== "all") {
    query = query.eq("source_type", source);
  }
  if (!includeClear) {
    query = query.in("suspicion_level", ["medium", "high"]);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ ok: false, message: "검수 목록을 불러오지 못했습니다.", detail: error.message }, { status: 500 });
  }

  const items = await hydrateReviewRows(guard.admin, ((data ?? []) as Record<string, unknown>[]));
  return NextResponse.json({ ok: true, items });
}

export async function PATCH(req: Request) {
  const guard = await requireAdminRoute();
  if (!guard.ok) return guard.response;

  const body = (await req.json().catch(() => ({}))) as ReviewActionPayload;
  const action = normalizeAction(body.action);
  const sourceType = normalizeSource(body.sourceType ?? body.source_type);
  const cardId = cleanText(body.cardId ?? body.card_id, 100);

  if (!action || sourceType === "all" || !cardId) {
    return NextResponse.json({ ok: false, message: "처리할 카드와 작업을 확인해 주세요." }, { status: 400 });
  }

  try {
    const card = await loadActionCard(guard.admin, sourceType, cardId);
    if (!card || !card.userId) {
      return NextResponse.json({ ok: false, message: "카드를 찾지 못했습니다." }, { status: 404 });
    }

    if (action === "delete_card") {
      await deleteActionCard(guard.admin, card);
      await guard.admin
        .from("admin_dating_card_ai_reviews")
        .update({ card_status: "deleted", scanned_at: new Date().toISOString() })
        .eq("source_type", sourceType)
        .eq("card_id", cardId)
        .then(({ error }) => {
          if (error && error.code !== "42P01" && error.code !== "PGRST205") {
            console.warn("[admin card review] review status update failed", error.message);
          }
        });
      await recordAdminAuditEvent({
        admin: guard.admin,
        adminUser: guard.user,
        request: req,
        action: "dating_card_review_delete",
        targetType: sourceType,
        targetId: cardId,
        metadata: { status: card.status, displayName: card.displayName },
      });
      return NextResponse.json({ ok: true, action, deleted: true, sourceType, cardId });
    }

    if (action === "update_fields") {
      const fields = cleanEditableFields(body.fields);
      const updated = await updateActionCardFields(guard.admin, card, fields);
      await guard.admin
        .from("admin_dating_card_ai_reviews")
        .update({
          display_name: updated.displayName,
          raw_result: {
            admin_edit: {
              edited_at: new Date().toISOString(),
              edited_by_user_id: guard.user.id,
              fields,
            },
          },
          scanned_at: new Date().toISOString(),
        })
        .eq("source_type", sourceType)
        .eq("card_id", cardId)
        .then(({ error }) => {
          if (error && error.code !== "42P01" && error.code !== "PGRST205") {
            console.warn("[admin card review] review edit marker failed", error.message);
          }
        });
      await recordAdminAuditEvent({
        admin: guard.admin,
        adminUser: guard.user,
        request: req,
        action: "dating_card_review_update_fields",
        targetType: sourceType,
        targetId: cardId,
        metadata: { status: card.status, displayName: updated.displayName, fields },
      });
      return NextResponse.json({ ok: true, action, sourceType, cardId, displayName: updated.displayName });
    }

    const mailResult = await sendCardWarningEmail(
      guard.admin,
      card,
      cleanText(body.summary, 500),
      cleanArray(body.flags)
    );
    await recordAdminAuditEvent({
      admin: guard.admin,
      adminUser: guard.user,
      request: req,
      action: "dating_card_review_warning_email",
      targetType: sourceType,
      targetId: cardId,
      status: mailResult.ok ? "success" : "failure",
      metadata: { status: card.status, error: mailResult.ok ? null : mailResult.error },
    });

    if (!mailResult.ok) {
      return NextResponse.json({ ok: false, message: mailResult.error ?? "메일 발송에 실패했습니다." }, { status: 500 });
    }

    return NextResponse.json({ ok: true, action, emailed: true, sourceType, cardId });
  } catch (error) {
    console.error("[admin card review] action failed", error);
    return NextResponse.json(
      { ok: false, message: "검수 카드 처리에 실패했습니다.", detail: error instanceof Error ? error.message : "unknown" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  const guard = await requireAdminRoute();
  if (!guard.ok) return guard.response;

  const body = (await req.json().catch(() => ({}))) as ReviewPayload;
  const mode = normalizeMode(body.mode);
  const source = normalizeSource(body.source);
  const limit = parseLimit(body.limit, mode);
  const includeClear = body.includeClear === true;
  const model = process.env.GEMINI_VISION_MODEL || process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
  const apiKey = process.env.GEMINI_API_KEY;

  if (mode === "ai" && !apiKey) {
    return NextResponse.json({ ok: false, message: "AI 검수에는 GEMINI_API_KEY가 필요합니다. 일반 검수는 바로 사용할 수 있습니다." }, { status: 500 });
  }

  try {
    const candidates = await fetchCandidates(guard.admin, source, limit);
    const scanned = [];

    for (const card of candidates) {
      const review = mode === "rules" ? ruleReview(card) : await analyzeWithGemini(guard.admin, apiKey ?? "", model, card);
      await saveReview(guard.admin, guard.user.id, card, review).catch((saveError) => {
        console.warn("[admin card review] save failed; returning transient result", saveError);
      });
      scanned.push({ ...card, review });
    }

    const items = scanned
      .filter((item) => includeClear || SUSPICIOUS_LEVELS.has(item.review.suspicionLevel))
      .map((item) => ({
        sourceType: item.sourceType,
        cardId: item.cardId,
        userId: item.userId,
        status: item.status,
        displayName: item.displayName,
        age: item.age,
        region: item.region,
        previewUrls: item.previewUrls,
        texts: item.texts,
        editableFields: editableFieldsFromCandidate(item),
        createdAt: item.createdAt,
        review: item.review,
      }));

    return NextResponse.json({
      ok: true,
      mode,
      model: mode === "ai" ? model : "rules",
      scannedCount: scanned.length,
      suspiciousCount: items.length,
      items,
    });
  } catch (error) {
    console.error("[admin card review] failed", error);
    return NextResponse.json(
      { ok: false, message: "카드 검수에 실패했습니다.", detail: error instanceof Error ? error.message : "unknown" },
      { status: 500 }
    );
  }
}
