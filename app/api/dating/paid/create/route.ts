import { createAdminClient, createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

type CreateBody = {
  gender?: unknown;
  age?: unknown;
  region?: unknown;
  height_cm?: unknown;
  job?: unknown;
  training_years?: unknown;
  strengths_text?: unknown;
  ideal_text?: unknown;
  intro_text?: unknown;
  instagram_id?: unknown;
  photo_visibility?: unknown;
  blur_thumb_path?: unknown;
  photo_paths?: unknown;
};

function toText(value: unknown, max: number) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

function toInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.round(parsed);
  }
  return null;
}

function normalizeInstagramId(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/^@+/, "").replace(/\s+/g, "");
}

function json(status: number, payload: Record<string, unknown>) {
  return NextResponse.json(payload, { status });
}

export async function POST(req: Request) {
  const requestId = crypto.randomUUID();
  console.log(`[dating-paid-create] ${requestId} start`);

  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError) {
      console.error(`[dating-paid-create] ${requestId} auth error`, authError);
      return json(401, { ok: false, code: "UNAUTHORIZED", requestId, message: "로그인이 필요합니다." });
    }
    if (!user) {
      return json(401, { ok: false, code: "UNAUTHORIZED", requestId, message: "로그인이 필요합니다." });
    }

    const body = ((await req.json().catch(() => null)) ?? {}) as CreateBody;
    const gender = body.gender === "M" || body.gender === "F" ? body.gender : "";
    const age = toInt(body.age);
    const region = toText(body.region, 50);
    const heightCm = toInt(body.height_cm);
    const job = toText(body.job, 80);
    const trainingYears = toInt(body.training_years);
    const strengthsText = toText(body.strengths_text, 300);
    const idealText = toText(body.ideal_text, 1000);
    const introText = toText(body.intro_text, 1000);
    const instagramId = normalizeInstagramId(body.instagram_id);
    const photoVisibility = body.photo_visibility === "public" ? "public" : "blur";
    const blurThumbPath = toText(body.blur_thumb_path, 500);
    const photoPaths = Array.isArray(body.photo_paths)
      ? body.photo_paths.filter((x): x is string => typeof x === "string" && x.length > 0)
      : [];

    if (!gender) return json(400, { ok: false, code: "VALIDATION_ERROR", requestId, message: "성별을 확인해주세요." });
    if (!instagramId || !/^[A-Za-z0-9._]{1,30}$/.test(instagramId)) {
      return json(400, { ok: false, code: "VALIDATION_ERROR", requestId, message: "인스타그램 아이디 형식을 확인해주세요." });
    }
    if (photoPaths.length < 1) {
      return json(400, { ok: false, code: "VALIDATION_ERROR", requestId, message: "사진은 최소 1장 필요합니다." });
    }
    if (photoVisibility === "blur" && !blurThumbPath) {
      return json(400, { ok: false, code: "VALIDATION_ERROR", requestId, message: "블러 썸네일 경로가 필요합니다." });
    }
    if (!photoPaths.every((path) => path.startsWith(`cards/${user.id}/raw/`))) {
      return json(400, { ok: false, code: "VALIDATION_ERROR", requestId, message: "사진 경로가 올바르지 않습니다." });
    }
    if (blurThumbPath && !blurThumbPath.startsWith(`cards/${user.id}/blur/`)) {
      return json(400, { ok: false, code: "VALIDATION_ERROR", requestId, message: "블러 썸네일 경로가 올바르지 않습니다." });
    }

    const adminClient = createAdminClient();
    const profileRes = await adminClient
      .from("profiles")
      .select("nickname")
      .eq("user_id", user.id)
      .maybeSingle();

    if (profileRes.error) {
      console.error(`[dating-paid-create] ${requestId} profile error`, profileRes.error);
      return json(500, { ok: false, code: "PROFILE_READ_FAILED", requestId, message: "프로필 정보를 불러오지 못했습니다." });
    }

    const nickname = toText(profileRes.data?.nickname ?? "", 30);
    if (!nickname) {
      return json(400, { ok: false, code: "NICKNAME_REQUIRED", requestId, message: "닉네임 설정 후 이용 가능합니다." });
    }

    const insertRes = await adminClient
      .from("dating_paid_cards")
      .insert({
        user_id: user.id,
        nickname,
        gender,
        age,
        region: region || null,
        height_cm: heightCm,
        job: job || null,
        training_years: trainingYears,
        strengths_text: strengthsText || null,
        ideal_text: idealText || null,
        intro_text: introText || null,
        instagram_id: instagramId,
        photo_visibility: photoVisibility,
        blur_thumb_path: blurThumbPath || null,
        photo_paths: photoPaths,
        status: "pending",
      })
      .select("id")
      .single();

    if (insertRes.error || !insertRes.data) {
      console.error(`[dating-paid-create] ${requestId} insert error`, insertRes.error);
      return json(500, {
        ok: false,
        code: "CREATE_FAILED",
        requestId,
        message: "유료 신청 생성에 실패했습니다.",
      });
    }

    return json(200, { ok: true, requestId, paidCardId: insertRes.data.id });
  } catch (error) {
    console.error(`[dating-paid-create] ${requestId} unhandled`, error);
    return json(500, { ok: false, code: "INTERNAL_SERVER_ERROR", requestId, message: "서버 오류가 발생했습니다." });
  }
}
