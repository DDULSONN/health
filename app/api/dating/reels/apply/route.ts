import { ensureAllowedMutationOrigin } from "@/lib/request-origin";
import { createAdminClient } from "@/lib/supabase/server";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function sanitizeText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function toInt(value: unknown) {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? Math.round(n) : null;
}

function normalizeInstagramId(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/^@+/, "").replace(/\s+/g, "").slice(0, 30);
}

function validInstagramId(value: string) {
  return /^[A-Za-z0-9._]{1,30}$/.test(value);
}

function isMissingColumnError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = String((error as { code?: unknown }).code ?? "");
  const message = String((error as { message?: unknown }).message ?? "").toLowerCase();
  return code === "42703" || code === "PGRST204" || message.includes("could not find") || message.includes("column");
}

export async function POST(req: Request) {
  const originError = ensureAllowedMutationOrigin(req);
  if (originError) return originError;

  const { user } = await getRequestAuthContext(req);
  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const listingId = sanitizeText(body?.listing_id, 80);
  const age = toInt(body?.age);
  const heightCm = toInt(body?.height_cm);
  const trainingYears = toInt(body?.training_years);
  const region = sanitizeText(body?.region, 40);
  const job = sanitizeText(body?.job, 40);
  const introText = sanitizeText(body?.intro_text, 600);
  const instagramId = normalizeInstagramId(body?.instagram_id);
  const photoPath = sanitizeText(body?.photo_path, 300);
  const consent = body?.consent === true;

  if (!listingId) return NextResponse.json({ error: "지원할 릴스 매물을 선택해 주세요." }, { status: 400 });
  if (!age || age < 19 || age > 80) return NextResponse.json({ error: "나이를 확인해 주세요." }, { status: 400 });
  if (!heightCm || heightCm < 120 || heightCm > 230) {
    return NextResponse.json({ error: "키를 확인해 주세요." }, { status: 400 });
  }
  if (!region || !job || !introText) {
    return NextResponse.json({ error: "지역, 직업, 소개글을 입력해 주세요." }, { status: 400 });
  }
  if (!validInstagramId(instagramId)) {
    return NextResponse.json({ error: "인스타 아이디를 확인해 주세요. @ 없이 입력하면 됩니다." }, { status: 400 });
  }
  if (photoPath && !photoPath.startsWith(`applications/${user.id}/`)) {
    return NextResponse.json({ error: "사진 업로드 정보가 올바르지 않습니다." }, { status: 400 });
  }
  if (!consent) {
    return NextResponse.json({ error: "개인정보 제공 동의가 필요합니다." }, { status: 400 });
  }

  const admin = createAdminClient();
  let profileRes = await admin
    .from("profiles")
    .select("nickname,phone_verified")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  if ((profileRes.error && isMissingColumnError(profileRes.error)) || (!profileRes.error && !profileRes.data)) {
    profileRes = await admin
      .from("profiles")
      .select("nickname,phone_verified")
      .eq("id", user.id)
      .limit(1)
      .maybeSingle();
  }

  if (profileRes.error) {
    console.error("[POST /api/dating/reels/apply] profile failed", profileRes.error);
    return NextResponse.json({ error: "회원 정보를 확인하지 못했습니다." }, { status: 500 });
  }
  if (profileRes.data?.phone_verified !== true) {
    return NextResponse.json(
      { code: "PHONE_VERIFICATION_REQUIRED", error: "휴대폰 번호 인증 후 지원할 수 있습니다." },
      { status: 403 }
    );
  }

  const listingRes = await admin
    .from("reels_dating_listings")
    .select("id,status")
    .eq("id", listingId)
    .eq("status", "active")
    .maybeSingle();

  if (listingRes.error) {
    console.error("[POST /api/dating/reels/apply] listing failed", listingRes.error);
    return NextResponse.json({ error: "릴스 매물 정보를 확인하지 못했습니다." }, { status: 500 });
  }
  if (!listingRes.data) {
    return NextResponse.json({ error: "현재 지원할 수 없는 릴스 매물입니다." }, { status: 404 });
  }

  const nickname = typeof profileRes.data?.nickname === "string" ? profileRes.data.nickname.trim() : "";

  const insertPayload = {
    listing_id: listingId,
    applicant_user_id: user.id,
    applicant_display_nickname: nickname,
    age,
    height_cm: heightCm,
    region,
    job,
    training_years: trainingYears,
    instagram_id: instagramId,
    intro_text: introText,
    photo_path: photoPath || null,
    status: "submitted",
  };

  let insertRes = await admin
    .from("reels_dating_applications")
    .insert(insertPayload)
    .select("id")
    .single();

  if (insertRes.error && isMissingColumnError(insertRes.error) && !photoPath) {
    const fallbackPayload: Omit<typeof insertPayload, "photo_path"> = {
      listing_id: insertPayload.listing_id,
      applicant_user_id: insertPayload.applicant_user_id,
      applicant_display_nickname: insertPayload.applicant_display_nickname,
      age: insertPayload.age,
      height_cm: insertPayload.height_cm,
      region: insertPayload.region,
      job: insertPayload.job,
      training_years: insertPayload.training_years,
      instagram_id: insertPayload.instagram_id,
      intro_text: insertPayload.intro_text,
      status: insertPayload.status,
    };
    insertRes = await admin.from("reels_dating_applications").insert(fallbackPayload).select("id").single();
  }

  if (insertRes.error) {
    if (insertRes.error.code === "23505") {
      return NextResponse.json({ error: "이미 이 릴스 매물에 지원했습니다." }, { status: 409 });
    }
    console.error("[POST /api/dating/reels/apply] insert failed", insertRes.error);
    return NextResponse.json({ error: "지원 저장에 실패했습니다." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id: insertRes.data.id }, { status: 201 });
}
