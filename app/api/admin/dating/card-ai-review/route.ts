import { NextResponse } from "next/server";
import { requireAdminRoute } from "@/lib/admin-route";
import { buildSignedImageUrlAllowRaw, extractStorageObjectPathFromBuckets } from "@/lib/images";
import { createAdminClient } from "@/lib/supabase/server";

type SourceType = "open_card" | "paid_card" | "one_on_one";
type SuspicionLevel = "clear" | "low" | "medium" | "high";

type ReviewPayload = {
  source?: unknown;
  limit?: unknown;
  includeClear?: unknown;
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

type AiCardReview = {
  suspicionLevel: SuspicionLevel;
  flags: string[];
  summary: string;
  photoFlags: string[];
  textFlags: string[];
  raw: Record<string, unknown>;
};

type AdminClient = ReturnType<typeof createAdminClient>;

const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const SOURCE_TYPES: SourceType[] = ["open_card", "paid_card", "one_on_one"];
const SUSPICIOUS_LEVELS = new Set<SuspicionLevel>(["medium", "high"]);

function parseLimit(value: unknown) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 12;
  return Math.min(Math.max(Math.floor(num), 1), 25);
}

function cleanText(value: unknown, max = 500) {
  return String(value ?? "").trim().slice(0, max);
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

function likelyTextFlags(texts: Record<string, string>) {
  const merged = Object.values(texts).join(" ").trim();
  const flags: string[] = [];
  if (merged.length < 12) flags.push("소개글이 너무 짧음");
  if (/(ㅋㅋ|ㅎㅎ|대충|몰라|아무나|장난|광고|문의|협찬|홍보|오픈카톡|카카오톡|텔레그램|http|https|무료나눔)/i.test(merged)) {
    flags.push("장난/광고/외부유도 의심 문구");
  }
  if (/([가-힣A-Za-z0-9])\1{5,}/.test(merged)) flags.push("반복 문자 과다");
  return flags;
}

function fallbackReview(card: CandidateCard): AiCardReview {
  const flags = likelyTextFlags(card.texts);
  if (card.photoPaths.length === 0) flags.push("사진 없음");
  const suspicionLevel: SuspicionLevel = flags.length >= 2 ? "medium" : flags.length === 1 ? "low" : "clear";
  return {
    suspicionLevel,
    flags,
    summary: flags.length > 0 ? flags.join(", ") : "기본 규칙상 큰 이상 없음",
    photoFlags: card.photoPaths.length === 0 ? ["사진 없음"] : [],
    textFlags: flags,
    raw: { provider: "heuristic" },
  };
}

function parseAiJson(text: string): AiCardReview | null {
  const jsonText = text
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
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

async function downloadImagePart(
  admin: AdminClient,
  bucket: string,
  path: string
) {
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

async function analyzeWithGemini(
  admin: AdminClient,
  apiKey: string,
  model: string,
  card: CandidateCard
): Promise<AiCardReview> {
  const imageParts = (
    await Promise.all(card.photoPaths.slice(0, 2).map((path) => downloadImagePart(admin, card.bucket, path)))
  ).filter(Boolean);

  const heuristic = fallbackReview(card);
  const prompt = [
    "너는 소개팅 서비스의 관리자 검수 보조 AI다.",
    "절대 삭제, 거절, 유저 제재를 결정하지 말고 관리자에게 보여줄 의심 사유만 판단한다.",
    "검수 기준: 빈 사진/흰 화면/검은 화면/캡처/광고/로고/텍스트만 있는 이미지/사람 사진이 아닌 이미지/장난식 소개글/광고성 문구/외부 연락 유도/소개글 비어있음.",
    "외모 평가, 매력 평가, 본인 여부 단정, 성별/나이 추정은 하지 않는다.",
    "정상으로 보이면 clear를 반환한다. 관리자 시간이 아까우니 애매하면 low, 실제 확인 필요하면 medium/high.",
    "반드시 JSON 하나만 반환한다.",
    `카드 종류: ${card.sourceType}`,
    `상태: ${card.status ?? "-"}`,
    `이름/닉네임: ${card.displayName || "-"}`,
    `나이/지역: ${card.age ?? "-"} / ${card.region ?? "-"}`,
    `텍스트: ${JSON.stringify(card.texts)}`,
    `기본 규칙 플래그: ${heuristic.flags.join(", ") || "없음"}`,
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
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }, ...imageParts],
          },
        ],
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
      return { ...heuristic, raw: { provider: "heuristic", geminiStatus: res.status, geminiError: payload } };
    }

    const parsed = parseAiJson(extractGeminiText(payload));
    if (!parsed) return { ...heuristic, raw: { provider: "heuristic", geminiParseFailed: true } };
    return {
      ...parsed,
      flags: Array.from(new Set([...heuristic.flags, ...parsed.flags])).slice(0, 10),
      raw: { provider: "gemini", model, result: parsed.raw },
    };
  } catch (error) {
    return {
      ...heuristic,
      raw: { provider: "heuristic", geminiError: error instanceof Error ? error.message : "unknown" },
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

  return (data ?? []).map((row) => {
    const photoPaths = pathsFromUnknown(row.photo_paths, ["dating-card-photos", "dating-photos"]);
    return {
      sourceType: "open_card",
      cardId: row.id,
      userId: row.owner_user_id,
      status: row.status,
      displayName: cleanText(row.display_nickname, 80),
      age: row.age,
      region: row.region,
      texts: {
        job: cleanText(row.job, 80),
        idealType: cleanText(row.ideal_type, 500),
        strengths: cleanText(row.strengths_text, 500),
        instagramId: cleanText(row.instagram_id, 80),
      },
      photoPaths,
      bucket: "dating-card-photos",
      previewUrls: photoPaths.slice(0, 2).map((path) => buildSignedImageUrlAllowRaw("dating-card-photos", path)),
      createdAt: row.created_at,
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

  return (data ?? []).map((row) => {
    const photoPaths = pathsFromUnknown(row.photo_paths, ["dating-card-photos", "dating-photos"]);
    return {
      sourceType: "paid_card",
      cardId: row.id,
      userId: row.user_id,
      status: row.status,
      displayName: cleanText(row.nickname, 80),
      age: row.age,
      region: row.region,
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
      createdAt: row.created_at,
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
  return (data ?? []).map((row) => {
    const photoPaths = pathsFromUnknown(row.photo_paths, ["dating-1on1-photos"]);
    return {
      sourceType: "one_on_one",
      cardId: row.id,
      userId: row.user_id,
      status: row.status,
      displayName: cleanText(row.name, 80),
      age: typeof row.birth_year === "number" ? currentYear - row.birth_year + 1 : null,
      region: row.region,
      texts: {
        job: cleanText(row.job, 80),
        intro: cleanText(row.intro_text, 500),
        strengths: cleanText(row.strengths_text, 500),
        preferredPartner: cleanText(row.preferred_partner_text, 500),
      },
      photoPaths,
      bucket: "dating-1on1-photos",
      previewUrls: photoPaths.slice(0, 2).map((path) => buildSignedImageUrlAllowRaw("dating-1on1-photos", path)),
      createdAt: row.created_at,
    };
  });
}

async function fetchCandidates(
  admin: AdminClient,
  source: SourceType | "all",
  limit: number
) {
  if (source === "open_card") return fetchOpenCards(admin, limit);
  if (source === "paid_card") return fetchPaidCards(admin, limit);
  if (source === "one_on_one") return fetchOneOnOneCards(admin, limit);

  const eachLimit = Math.max(3, Math.ceil(limit / 3));
  const rows = await Promise.all([fetchOpenCards(admin, eachLimit), fetchPaidCards(admin, eachLimit), fetchOneOnOneCards(admin, eachLimit)]);
  return rows.flat().sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? ""))).slice(0, limit);
}

async function saveReview(
  admin: AdminClient,
  adminUserId: string,
  card: CandidateCard,
  review: AiCardReview
) {
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
    .select("id,source_type,card_id,user_id,card_status,display_name,suspicion_level,flags,summary,photo_flags,text_flags,scanned_at")
    .in("suspicion_level", ["medium", "high"])
    .order("scanned_at", { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json({ ok: false, message: "AI 검수 목록을 불러오지 못했습니다.", detail: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, items: data ?? [] });
}

export async function POST(req: Request) {
  const guard = await requireAdminRoute();
  if (!guard.ok) return guard.response;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ ok: false, message: "GEMINI_API_KEY가 필요합니다." }, { status: 500 });
  }

  const body = (await req.json().catch(() => ({}))) as ReviewPayload;
  const requestedSource = cleanText(body.source, 30);
  const source: SourceType | "all" = SOURCE_TYPES.includes(requestedSource as SourceType) ? (requestedSource as SourceType) : "all";
  const limit = parseLimit(body.limit);
  const includeClear = body.includeClear === true;
  const model = process.env.GEMINI_VISION_MODEL || process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";

  try {
    const candidates = await fetchCandidates(guard.admin, source, limit);
    const scanned = [];

    for (const card of candidates) {
      const review = await analyzeWithGemini(guard.admin, apiKey, model, card);
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
      model,
      scannedCount: scanned.length,
      suspiciousCount: items.length,
      items,
    });
  } catch (error) {
    console.error("[admin card ai review] failed", error);
    return NextResponse.json(
      { ok: false, message: "AI 카드 검수에 실패했습니다.", detail: error instanceof Error ? error.message : "unknown" },
      { status: 500 }
    );
  }
}
