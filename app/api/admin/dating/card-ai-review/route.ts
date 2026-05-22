import { NextResponse } from "next/server";
import { requireAdminRoute } from "@/lib/admin-route";
import { buildSignedImageUrlAllowRaw, extractStorageObjectPathFromBuckets } from "@/lib/images";
import { createAdminClient } from "@/lib/supabase/server";

type SourceType = "open_card" | "paid_card" | "one_on_one";
type ReviewMode = "rules" | "ai";
type SuspicionLevel = "clear" | "low" | "medium" | "high";
type AdminClient = ReturnType<typeof createAdminClient>;

type ReviewPayload = {
  source?: unknown;
  limit?: unknown;
  includeClear?: unknown;
  mode?: unknown;
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

const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const SOURCE_TYPES: SourceType[] = ["open_card", "paid_card", "one_on_one"];
const SUSPICIOUS_LEVELS = new Set<SuspicionLevel>(["medium", "high"]);
const LOW_EFFORT_PATTERNS = [
  /ㅋㅋ|ㅎㅎ|ㅈㅅ|ㅇㅇ|ㄱㄱ|테스트|test|asdf|qwer/i,
  /대충|몰라|모름|아무나|없음|비밀|나중에|직접\s*물어/i,
  /장난|광고|홍보|협찬|업체|문의|무료|이벤트/i,
  /오픈\s*카톡|카카오톡|카톡|텔레그램|디엠|dm|line|라인/i,
  /https?:\/\/|www\.|open\.kakao|t\.me|instagram\.com/i,
];

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

function cleanArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => cleanText(item, 80)).filter(Boolean).slice(0, 8);
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
  return "1대1 카드";
}

function likelyTextFlags(texts: Record<string, string>) {
  const merged = Object.values(texts).join(" ").trim();
  const flags: string[] = [];

  if (merged.length < 12) flags.push("전체 소개 문구가 너무 짧음");
  if (LOW_EFFORT_PATTERNS.some((pattern) => pattern.test(merged))) {
    flags.push("장난/광고/외부유도 의심 문구");
  }
  if (/([가-힣A-Za-z0-9])\1{4,}/u.test(merged)) flags.push("반복 문자 과다");
  if (/010[-\s]?\d{3,4}[-\s]?\d{4}/.test(merged)) flags.push("전화번호 직접 노출 의심");
  if (/(만남\s*알바|조건|스폰|성인|19금|불법|도박|카지노|코인|대출)/i.test(merged)) {
    flags.push("부적절/광고성 키워드");
  }

  return flags;
}

function ruleReview(card: CandidateCard): CardReview {
  const photoFlags: string[] = [];
  const textFlags = likelyTextFlags(card.texts);
  const flags: string[] = [];
  const importantFields = Object.entries(card.texts).filter(([key]) => !/instagram/i.test(key));

  if (!card.displayName) flags.push("닉네임/이름 없음");
  if (card.photoPaths.length === 0) photoFlags.push("사진 없음");
  if (card.photoPaths.length === 1 && card.sourceType !== "paid_card") photoFlags.push("사진 1장만 등록");

  for (const [key, value] of importantFields) {
    const trimmed = value.trim();
    if (!trimmed) {
      textFlags.push(`${key} 비어 있음`);
    } else if (trimmed.length < 8) {
      textFlags.push(`${key} 너무 짧음`);
    }
  }

  flags.push(...photoFlags, ...textFlags);
  const uniqueFlags = Array.from(new Set(flags)).slice(0, 10);
  const suspicionLevel: SuspicionLevel =
    uniqueFlags.some((flag) => /부적절|광고|전화번호|외부유도/.test(flag)) || uniqueFlags.length >= 4
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
    raw: { provider: "rules", version: "2026-05-22-1" },
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

async function fetchCandidates(admin: AdminClient, source: SourceType | "all", limit: number) {
  if (source === "open_card") return fetchOpenCards(admin, limit);
  if (source === "paid_card") return fetchPaidCards(admin, limit);
  if (source === "one_on_one") return fetchOneOnOneCards(admin, limit);

  const eachLimit = Math.max(3, Math.ceil(limit / 3));
  const rows = await Promise.all([fetchOpenCards(admin, eachLimit), fetchPaidCards(admin, eachLimit), fetchOneOnOneCards(admin, eachLimit)]);
  return rows.flat().sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? ""))).slice(0, limit);
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

export async function GET() {
  const guard = await requireAdminRoute();
  if (!guard.ok) return guard.response;

  const { data, error } = await guard.admin
    .from("admin_dating_card_ai_reviews")
    .select("id,source_type,card_id,user_id,card_status,display_name,suspicion_level,flags,summary,photo_flags,text_flags,raw_result,scanned_at")
    .in("suspicion_level", ["medium", "high"])
    .order("scanned_at", { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json({ ok: false, message: "검수 목록을 불러오지 못했습니다.", detail: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, items: data ?? [] });
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
      await saveReview(guard.admin, guard.user.id, card, review);
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
