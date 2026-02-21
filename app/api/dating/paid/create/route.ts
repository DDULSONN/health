import { createAdminClient, createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

type CreateBody = {
  id?: unknown;
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

type ParsedPaidPayload = {
  id: string;
  gender: "M" | "F" | "";
  age: number | null;
  region: string;
  heightCm: number | null;
  job: string;
  trainingYears: number | null;
  strengthsText: string;
  idealText: string;
  introText: string;
  instagramId: string;
  photoVisibility: "public" | "blur";
  blurThumbPath: string;
  photoPaths: string[];
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

function parsePayload(body: CreateBody): ParsedPaidPayload {
  return {
    id: toText(body.id, 100),
    gender: body.gender === "M" || body.gender === "F" ? body.gender : "",
    age: toInt(body.age),
    region: toText(body.region, 50),
    heightCm: toInt(body.height_cm),
    job: toText(body.job, 80),
    trainingYears: toInt(body.training_years),
    strengthsText: toText(body.strengths_text, 300),
    idealText: toText(body.ideal_text, 1000),
    introText: toText(body.intro_text, 1000),
    instagramId: normalizeInstagramId(body.instagram_id),
    photoVisibility: body.photo_visibility === "public" ? "public" : "blur",
    blurThumbPath: toText(body.blur_thumb_path, 500),
    photoPaths: Array.isArray(body.photo_paths)
      ? body.photo_paths.filter((x): x is string => typeof x === "string" && x.length > 0)
      : [],
  };
}

export async function GET(req: Request) {
  const requestId = crypto.randomUUID();
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return json(401, { ok: false, code: "UNAUTHORIZED", requestId, message: "로그인이 필요합니다." });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id")?.trim() ?? "";
  if (!id) {
    return json(400, { ok: false, code: "VALIDATION_ERROR", requestId, message: "id가 필요합니다." });
  }

  const adminClient = createAdminClient();
  const rowRes = await adminClient
    .from("dating_paid_cards")
    .select("id,gender,age,region,height_cm,job,training_years,strengths_text,ideal_text,intro_text,instagram_id,photo_visibility,blur_thumb_path,photo_paths,status")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (rowRes.error || !rowRes.data) {
    return json(404, { ok: false, code: "NOT_FOUND", requestId, message: "유료 카드를 찾을 수 없습니다." });
  }
  if (rowRes.data.status !== "pending") {
    return json(400, { ok: false, code: "NOT_PENDING", requestId, message: "대기중 카드만 수정할 수 있습니다." });
  }

  return json(200, {
    ok: true,
    requestId,
    card: {
      id: rowRes.data.id,
      gender: rowRes.data.gender,
      age: rowRes.data.age,
      region: rowRes.data.region,
      height_cm: rowRes.data.height_cm,
      job: rowRes.data.job,
      training_years: rowRes.data.training_years,
      strengths_text: rowRes.data.strengths_text,
      ideal_text: rowRes.data.ideal_text,
      intro_text: rowRes.data.intro_text,
      instagram_id: rowRes.data.instagram_id,
      photo_visibility: rowRes.data.photo_visibility === "public" ? "public" : "blur",
      blur_thumb_path: rowRes.data.blur_thumb_path,
      photo_paths: Array.isArray(rowRes.data.photo_paths) ? rowRes.data.photo_paths : [],
    },
  });
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
    const parsed = parsePayload(body);
    const {
      gender,
      age,
      region,
      heightCm,
      job,
      trainingYears,
      strengthsText,
      idealText,
      introText,
      instagramId,
      photoVisibility,
      blurThumbPath,
      photoPaths,
    } = parsed;

    if (!gender) return json(400, { ok: false, code: "VALIDATION_ERROR", requestId, message: "성별을 확인해 주세요." });
    if (!instagramId || !/^[A-Za-z0-9._]{1,30}$/.test(instagramId)) {
      return json(400, { ok: false, code: "VALIDATION_ERROR", requestId, message: "인스타그램 아이디 형식을 확인해 주세요." });
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

    let is3LiftVerified = false;
    if (gender === "M") {
      const certRes = await adminClient
        .from("cert_requests")
        .select("id")
        .eq("user_id", user.id)
        .eq("status", "approved")
        .limit(1)
        .maybeSingle();

      if (certRes.error) {
        console.error(`[dating-paid-create] ${requestId} cert read error`, certRes.error);
        return json(500, { ok: false, code: "CERT_READ_FAILED", requestId, message: "3대 인증 정보를 불러오지 못했습니다." });
      }
      is3LiftVerified = Boolean(certRes.data);
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
        is_3lift_verified: is3LiftVerified,
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
        message: "유료 요청 생성에 실패했습니다.",
      });
    }

    return json(200, { ok: true, requestId, paidCardId: insertRes.data.id });
  } catch (error) {
    console.error(`[dating-paid-create] ${requestId} unhandled`, error);
    return json(500, { ok: false, code: "INTERNAL_SERVER_ERROR", requestId, message: "서버 오류가 발생했습니다." });
  }
}

export async function PATCH(req: Request) {
  const requestId = crypto.randomUUID();
  console.log(`[dating-paid-update] ${requestId} start`);

  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return json(401, { ok: false, code: "UNAUTHORIZED", requestId, message: "로그인이 필요합니다." });
    }

    const body = ((await req.json().catch(() => null)) ?? {}) as CreateBody;
    const parsed = parsePayload(body);
    const {
      id,
      gender,
      age,
      region,
      heightCm,
      job,
      trainingYears,
      strengthsText,
      idealText,
      introText,
      instagramId,
      photoVisibility,
      blurThumbPath,
      photoPaths,
    } = parsed;

    if (!id) return json(400, { ok: false, code: "VALIDATION_ERROR", requestId, message: "id가 필요합니다." });
    if (!gender) return json(400, { ok: false, code: "VALIDATION_ERROR", requestId, message: "성별을 확인해 주세요." });
    if (!instagramId || !/^[A-Za-z0-9._]{1,30}$/.test(instagramId)) {
      return json(400, { ok: false, code: "VALIDATION_ERROR", requestId, message: "인스타그램 아이디 형식을 확인해 주세요." });
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
    const rowRes = await adminClient
      .from("dating_paid_cards")
      .select("id,status")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (rowRes.error || !rowRes.data) {
      return json(404, { ok: false, code: "NOT_FOUND", requestId, message: "유료 카드를 찾을 수 없습니다." });
    }
    if (rowRes.data.status !== "pending") {
      return json(400, { ok: false, code: "NOT_PENDING", requestId, message: "대기중 카드만 수정할 수 있습니다." });
    }

    const profileRes = await adminClient
      .from("profiles")
      .select("nickname")
      .eq("user_id", user.id)
      .maybeSingle();
    if (profileRes.error) {
      console.error(`[dating-paid-update] ${requestId} profile error`, profileRes.error);
      return json(500, { ok: false, code: "PROFILE_READ_FAILED", requestId, message: "프로필 정보를 불러오지 못했습니다." });
    }
    const nickname = toText(profileRes.data?.nickname ?? "", 30);
    if (!nickname) {
      return json(400, { ok: false, code: "NICKNAME_REQUIRED", requestId, message: "닉네임 설정 후 이용 가능합니다." });
    }

    let is3LiftVerified = false;
    if (gender === "M") {
      const certRes = await adminClient
        .from("cert_requests")
        .select("id")
        .eq("user_id", user.id)
        .eq("status", "approved")
        .limit(1)
        .maybeSingle();
      if (certRes.error) {
        console.error(`[dating-paid-update] ${requestId} cert read error`, certRes.error);
        return json(500, { ok: false, code: "CERT_READ_FAILED", requestId, message: "3대 인증 정보를 불러오지 못했습니다." });
      }
      is3LiftVerified = Boolean(certRes.data);
    }

    const updateRes = await adminClient
      .from("dating_paid_cards")
      .update({
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
        is_3lift_verified: is3LiftVerified,
        status: "pending",
      })
      .eq("id", id)
      .eq("user_id", user.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();

    if (updateRes.error || !updateRes.data) {
      console.error(`[dating-paid-update] ${requestId} update error`, updateRes.error);
      return json(500, { ok: false, code: "UPDATE_FAILED", requestId, message: "유료 요청 수정에 실패했습니다." });
    }

    return json(200, { ok: true, requestId, paidCardId: updateRes.data.id });
  } catch (error) {
    console.error(`[dating-paid-update] ${requestId} unhandled`, error);
    return json(500, { ok: false, code: "INTERNAL_SERVER_ERROR", requestId, message: "서버 오류가 발생했습니다." });
  }
}
