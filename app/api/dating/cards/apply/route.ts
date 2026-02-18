import { getKstDayRangeUtc } from "@/lib/dating-open";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type ApiErrorCode =
  | "BAD_REQUEST"
  | "NICKNAME_REQUIRED"
  | "DAILY_APPLY_LIMIT"
  | "DUPLICATE_APPLICATION"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INTERNAL_SERVER_ERROR";

type DbErrorShape = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
};

function normalizeInstagramId(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(/^@+/, "").replace(/\s+/g, "");
}

function validInstagramId(value: string) {
  return /^[A-Za-z0-9._]{1,30}$/.test(value);
}

function sanitizeText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function toInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n)) return Math.round(n);
  }
  return null;
}

function toDbErrorShape(error: unknown): DbErrorShape {
  if (!error || typeof error !== "object") return {};
  const e = error as Record<string, unknown>;
  return {
    code: typeof e.code === "string" ? e.code : null,
    message: typeof e.message === "string" ? e.message : null,
    details: typeof e.details === "string" ? e.details : null,
    hint: typeof e.hint === "string" ? e.hint : null,
  };
}

function maskPayloadForLog(body: unknown) {
  const b = (body ?? {}) as Record<string, unknown>;
  const photoPaths = Array.isArray(b.photo_paths)
    ? b.photo_paths.filter((item): item is string => typeof item === "string")
    : [];

  return {
    card_id: typeof b.card_id === "string" ? b.card_id : null,
    age: b.age ?? null,
    height_cm: b.height_cm ?? null,
    region: typeof b.region === "string" ? b.region.slice(0, 50) : null,
    job: typeof b.job === "string" ? b.job.slice(0, 50) : null,
    training_years: b.training_years ?? null,
    intro_text_len: typeof b.intro_text === "string" ? b.intro_text.trim().length : 0,
    instagram_id_masked: typeof b.instagram_id === "string" ? `${b.instagram_id.slice(0, 2)}***` : null,
    photo_paths_count: photoPaths.length,
    consent: Boolean(b.consent),
  };
}

function errorResponse(
  status: number,
  code: ApiErrorCode,
  message: string,
  details?: string | null,
  extra?: Record<string, unknown>
) {
  return NextResponse.json(
    {
      code,
      message,
      details: details ?? null,
      ...extra,
    },
    { status }
  );
}

export async function POST(req: Request) {
  let requestBody: unknown = null;
  let uid: string | null = null;

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    uid = user?.id ?? null;

    if (!user) {
      return errorResponse(401, "FORBIDDEN", "로그인이 필요합니다.");
    }

    requestBody = await req.json().catch(() => null);
    if (!requestBody) {
      return errorResponse(400, "BAD_REQUEST", "잘못된 요청입니다.");
    }

    const body = requestBody as Record<string, unknown>;
    const cardId = sanitizeText(body.card_id, 100);
    const age = toInt(body.age);
    const heightCm = toInt(body.height_cm);
    const trainingYears = toInt(body.training_years);
    const region = sanitizeText(body.region, 30);
    const job = sanitizeText(body.job, 50);
    const introText = sanitizeText(body.intro_text, 1000);
    const instagramId = normalizeInstagramId(body.instagram_id);
    const consent = Boolean(body.consent);
    const photoPathsRaw = body.photo_paths;
    const photoPaths = Array.isArray(photoPathsRaw)
      ? photoPathsRaw.filter((item): item is string => typeof item === "string" && item.length > 0)
      : [];

    if (!cardId) {
      return errorResponse(400, "BAD_REQUEST", "카드 정보가 올바르지 않습니다.", "card_id is required");
    }
    if (!instagramId) {
      return errorResponse(400, "BAD_REQUEST", "인스타그램 아이디를 입력해주세요.", "instagram_id is required");
    }
    if (!validInstagramId(instagramId)) {
      return errorResponse(
        400,
        "BAD_REQUEST",
        "인스타그램 아이디 형식이 올바르지 않습니다. (@ 제외, 영문/숫자/._, 최대 30자)"
      );
    }
    if (!introText) {
      return errorResponse(400, "BAD_REQUEST", "자기소개를 입력해주세요.", "intro_text is required");
    }
    if (!consent) {
      return errorResponse(400, "BAD_REQUEST", "동의가 필요합니다.", "consent is required");
    }
    if (photoPaths.length !== 2) {
      return errorResponse(400, "BAD_REQUEST", "지원 사진은 2장이 필요합니다.", "photo_paths must contain exactly 2");
    }
    if (!photoPaths.every((path) => path.startsWith(`card-applications/${user.id}/`))) {
      return errorResponse(400, "BAD_REQUEST", "업로드 경로가 올바르지 않습니다.");
    }
    if (age == null || age < 19 || age > 99) {
      return errorResponse(400, "BAD_REQUEST", "나이를 확인해주세요.");
    }
    if (heightCm == null || heightCm < 120 || heightCm > 230) {
      return errorResponse(400, "BAD_REQUEST", "키를 확인해주세요.");
    }
    if (trainingYears == null || trainingYears < 0 || trainingYears > 50) {
      return errorResponse(400, "BAD_REQUEST", "운동경력을 확인해주세요.");
    }

    const profileRes = await supabase
      .from("profiles")
      .select("nickname")
      .eq("user_id", user.id)
      .maybeSingle();

    if (profileRes.error) {
      const dbError = toDbErrorShape(profileRes.error);
      return errorResponse(
        dbError.code === "42501" ? 403 : 500,
        dbError.code === "42501" ? "FORBIDDEN" : "INTERNAL_SERVER_ERROR",
        "지원 처리 중 오류가 발생했습니다.",
        dbError.code ?? dbError.message ?? null
      );
    }

    const applicantDisplayNickname = sanitizeText(profileRes.data?.nickname, 20);
    if (!applicantDisplayNickname) {
      return errorResponse(400, "NICKNAME_REQUIRED", "닉네임 설정 후 이용 가능합니다.", null, {
        profile_edit_url: "/mypage",
      });
    }

    const cardRes = await supabase
      .from("dating_cards")
      .select("id, owner_user_id, status, expires_at")
      .eq("id", cardId)
      .single();

    if (cardRes.error || !cardRes.data) {
      return errorResponse(404, "NOT_FOUND", "카드를 찾을 수 없습니다.");
    }

    const card = cardRes.data;
    if (card.status !== "public" || !card.expires_at || new Date(card.expires_at).getTime() <= Date.now()) {
      return errorResponse(400, "BAD_REQUEST", "지원 가능한 카드가 아닙니다.");
    }
    if (card.owner_user_id === user.id) {
      return errorResponse(400, "BAD_REQUEST", "본인 카드에는 지원할 수 없습니다.");
    }

    const { startUtcIso, endUtcIso } = getKstDayRangeUtc();
    const countRes = await supabase
      .from("dating_card_applications")
      .select("id", { head: true, count: "exact" })
      .eq("applicant_user_id", user.id)
      .in("status", ["submitted", "accepted", "rejected"])
      .gte("created_at", startUtcIso)
      .lt("created_at", endUtcIso);

    if (countRes.error) {
      const dbError = toDbErrorShape(countRes.error);
      return errorResponse(
        dbError.code === "42501" ? 403 : 500,
        dbError.code === "42501" ? "FORBIDDEN" : "INTERNAL_SERVER_ERROR",
        "지원 처리 중 오류가 발생했습니다.",
        dbError.code ?? dbError.message ?? null
      );
    }

    if ((countRes.count ?? 0) >= 2) {
      return errorResponse(429, "DAILY_APPLY_LIMIT", "하루 2회 지원 가능, 내일 다시");
    }

    const payload = {
      card_id: cardId,
      applicant_user_id: user.id,
      applicant_display_nickname: applicantDisplayNickname,
      age,
      height_cm: heightCm,
      region,
      job,
      training_years: trainingYears,
      intro_text: introText,
      instagram_id: instagramId,
      photo_paths: photoPaths,
      status: "submitted" as const,
    };

    const insertRes = await supabase
      .from("dating_card_applications")
      .insert(payload)
      .select("id")
      .single();

    if (insertRes.error) {
      const dbError = toDbErrorShape(insertRes.error);
      if (dbError.code === "23505") {
        return errorResponse(409, "DUPLICATE_APPLICATION", "이미 해당 카드에 지원하셨어요.");
      }
      if (dbError.code === "42501") {
        return errorResponse(403, "FORBIDDEN", "권한이 없어 지원할 수 없습니다.", dbError.code);
      }
      if (dbError.code === "23502") {
        return errorResponse(
          400,
          "BAD_REQUEST",
          "필수값이 누락되었습니다. 인스타그램/자기소개/사진 2장을 확인해주세요.",
          dbError.code
        );
      }
      return errorResponse(500, "INTERNAL_SERVER_ERROR", "지원 처리 중 오류가 발생했습니다.", dbError.code ?? dbError.message ?? null);
    }

    return NextResponse.json({ id: insertRes.data.id }, { status: 200 });
  } catch (error) {
    const dbError = toDbErrorShape(error);
    console.error("[POST /api/dating/cards/apply] unhandled error", {
      uid,
      payload: maskPayloadForLog(requestBody),
      dbError,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(
      500,
      "INTERNAL_SERVER_ERROR",
      "지원 처리 중 오류가 발생했습니다.",
      dbError.code ?? dbError.message ?? (error instanceof Error ? error.message : "unknown error")
    );
  }
}
