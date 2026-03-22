import { buildSignedImageUrl, extractStorageObjectPathFromBuckets } from "@/lib/images";
import { getDatingOneOnOneWriteStatus, getProfilePhoneVerification } from "@/lib/dating-1on1";
import { createAdminClient } from "@/lib/supabase/server";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { NextResponse } from "next/server";

type InputPayload = {
  id?: string;
  sex?: string;
  name?: string;
  birth_year?: number | string;
  height_cm?: number | string;
  job?: string;
  region?: string;
  intro_text?: string;
  strengths_text?: string;
  preferred_partner_text?: string;
  smoking?: string;
  workout_frequency?: string | null;
  photo_paths?: string[];
  consent_fake_info?: boolean;
  consent_no_show?: boolean;
  consent_fee?: boolean;
  consent_privacy?: boolean;
};

const SEX_VALUES = new Set(["male", "female"]);
const SMOKING_VALUES = new Set(["non_smoker", "occasional", "smoker"]);
const WORKOUT_VALUES = new Set(["none", "1_2", "3_4", "5_plus"]);

function normalizePath(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim();
  if (!trimmed) return "";
  return extractStorageObjectPathFromBuckets(trimmed, ["dating-1on1-photos"]) ?? trimmed;
}

function toCurrentAge(birthYear: number | null | undefined): number | null {
  if (!birthYear || !Number.isFinite(birthYear)) return null;
  return new Date().getFullYear() - birthYear + 1;
}

function toInt(value: number | string | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  if (typeof value === "string" && value.trim().length > 0) {
    const n = Number(value);
    if (Number.isFinite(n)) return Math.round(n);
  }
  return null;
}

export async function GET(req: Request) {
  const { user } = await getRequestAuthContext(req);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("dating_1on1_cards")
    .select(
      "id,sex,name,birth_year,height_cm,job,region,intro_text,strengths_text,preferred_partner_text,smoking,workout_frequency,status,photo_paths,admin_note,admin_tags,reviewed_at,created_at"
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    console.error("[GET /api/dating/1on1/my] failed", error);
    return NextResponse.json({ error: "Failed to load 1:1 requests." }, { status: 500 });
  }

  const items = (data ?? []).map((row) => {
    const paths = Array.isArray(row.photo_paths)
      ? row.photo_paths
          .map((path) => normalizePath(path))
          .filter((path): path is string => typeof path === "string" && path.length > 0)
      : [];
    const photo_signed_urls = paths
      .map((path) => buildSignedImageUrl("dating-1on1-photos", path))
      .filter((url) => url.length > 0);

    return {
      ...row,
      age: toCurrentAge(row.birth_year),
      photo_signed_urls,
    };
  });

  return NextResponse.json({ items });
}

export async function PATCH(req: Request) {
  const { user } = await getRequestAuthContext(req);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as InputPayload | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const cardId = typeof body.id === "string" ? body.id.trim() : "";
  if (!cardId) {
    return NextResponse.json({ error: "Card id is required." }, { status: 400 });
  }

  const admin = createAdminClient();
  const writeStatus = await getDatingOneOnOneWriteStatus(admin);
  if (writeStatus !== "approved") {
    return NextResponse.json({ error: "Writing is paused." }, { status: 403 });
  }

  const phoneState = await getProfilePhoneVerification(admin, user.id);
  if (!phoneState.phoneVerified || !phoneState.phoneE164) {
    return NextResponse.json({ error: "Phone verification is required." }, { status: 403 });
  }

  const currentRes = await admin
    .from("dating_1on1_cards")
    .select("id,status,photo_paths")
    .eq("id", cardId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (currentRes.error) {
    console.error("[PATCH /api/dating/1on1/my] current fetch failed", currentRes.error);
    return NextResponse.json({ error: "Failed to load current request." }, { status: 500 });
  }
  if (!currentRes.data) {
    return NextResponse.json({ error: "Request not found." }, { status: 404 });
  }
  if (currentRes.data.status !== "submitted") {
    return NextResponse.json({ error: "Only submitted requests can be edited." }, { status: 409 });
  }

  const sex = (body.sex ?? "").trim();
  const name = (body.name ?? "").trim();
  const birthYear = toInt(body.birth_year);
  const heightCm = toInt(body.height_cm);
  const job = (body.job ?? "").trim();
  const region = (body.region ?? "").trim();
  const introText = (body.intro_text ?? "").trim();
  const strengthsText = (body.strengths_text ?? "").trim();
  const preferredPartnerText = (body.preferred_partner_text ?? "").trim();
  const smoking = (body.smoking ?? "").trim();
  const workoutFrequencyRaw = body.workout_frequency;
  const workoutFrequency =
    typeof workoutFrequencyRaw === "string" && workoutFrequencyRaw.trim().length > 0
      ? workoutFrequencyRaw.trim()
      : null;

  if (!SEX_VALUES.has(sex)) {
    return NextResponse.json({ error: "Sex value is invalid." }, { status: 400 });
  }
  if (!name || name.length > 30) {
    return NextResponse.json({ error: "Name must be 1-30 characters." }, { status: 400 });
  }
  if (birthYear == null || birthYear < 1960 || birthYear > 2010) {
    return NextResponse.json({ error: "Birth year must be between 1960 and 2010." }, { status: 400 });
  }
  if (heightCm == null || heightCm < 120 || heightCm > 230) {
    return NextResponse.json({ error: "Height must be between 120 and 230 cm." }, { status: 400 });
  }
  if (!job || job.length > 80) {
    return NextResponse.json({ error: "Job must be 1-80 characters." }, { status: 400 });
  }
  if (!region || region.length > 80) {
    return NextResponse.json({ error: "Region must be 1-80 characters." }, { status: 400 });
  }
  if (!introText || introText.length > 2000) {
    return NextResponse.json({ error: "Introduction must be 1-2000 characters." }, { status: 400 });
  }
  if (!strengthsText || strengthsText.length > 1000) {
    return NextResponse.json({ error: "Strengths must be 1-1000 characters." }, { status: 400 });
  }
  if (!preferredPartnerText || preferredPartnerText.length > 1000) {
    return NextResponse.json({ error: "Preferred partner must be 1-1000 characters." }, { status: 400 });
  }
  if (!SMOKING_VALUES.has(smoking)) {
    return NextResponse.json({ error: "Smoking value is invalid." }, { status: 400 });
  }
  if (workoutFrequency && !WORKOUT_VALUES.has(workoutFrequency)) {
    return NextResponse.json({ error: "Workout frequency value is invalid." }, { status: 400 });
  }

  const nextPhotoPathsRaw = Array.isArray(body.photo_paths) ? body.photo_paths : null;
  const nextPhotoPaths = nextPhotoPathsRaw
    ? nextPhotoPathsRaw
        .map((path) => normalizePath(path))
        .filter((path): path is string => typeof path === "string" && path.length > 0)
        .slice(0, 2)
    : null;

  if (nextPhotoPaths && nextPhotoPaths.length !== 2) {
    return NextResponse.json({ error: "Exactly two photos are required." }, { status: 400 });
  }

  const existingPhotoPaths = Array.isArray(currentRes.data.photo_paths)
    ? currentRes.data.photo_paths
        .map((path) => normalizePath(path))
        .filter((path): path is string => typeof path === "string" && path.length > 0)
        .slice(0, 2)
    : [];

  const finalPhotoPaths = nextPhotoPaths ?? existingPhotoPaths;
  if (finalPhotoPaths.length !== 2) {
    return NextResponse.json({ error: "Exactly two photos are required." }, { status: 400 });
  }

  const updatePayload = {
    sex,
    name,
    birth_year: birthYear,
    height_cm: heightCm,
    job,
    region,
    intro_text: introText,
    strengths_text: strengthsText,
    preferred_partner_text: preferredPartnerText,
    smoking,
    workout_frequency: workoutFrequency,
    photo_paths: finalPhotoPaths,
    consent_fake_info: body.consent_fake_info === true,
    consent_no_show: body.consent_no_show === true,
    consent_fee: body.consent_fee === true,
    consent_privacy: body.consent_privacy === true,
  };

  const { error } = await admin
    .from("dating_1on1_cards")
    .update(updatePayload)
    .eq("id", cardId)
    .eq("user_id", user.id)
    .eq("status", "submitted");

  if (error) {
    console.error("[PATCH /api/dating/1on1/my] update failed", error);
    return NextResponse.json({ error: "Failed to update request." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id: cardId });
}

export async function DELETE(req: Request) {
  const { user } = await getRequestAuthContext(req);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const cardId = (searchParams.get("id") ?? "").trim();
  if (!cardId) {
    return NextResponse.json({ error: "Card id is required." }, { status: 400 });
  }

  const admin = createAdminClient();
  const currentRes = await admin
    .from("dating_1on1_cards")
    .select("id")
    .eq("id", cardId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (currentRes.error) {
    console.error("[DELETE /api/dating/1on1/my] current fetch failed", currentRes.error);
    return NextResponse.json({ error: "Failed to load current request." }, { status: 500 });
  }
  if (!currentRes.data) {
    return NextResponse.json({ error: "Request not found." }, { status: 404 });
  }

  const deleteRes = await admin
    .from("dating_1on1_cards")
    .delete()
    .eq("id", cardId)
    .eq("user_id", user.id);

  if (deleteRes.error) {
    console.error("[DELETE /api/dating/1on1/my] delete failed", deleteRes.error);
    return NextResponse.json({ error: "Failed to delete request." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id: cardId, deleted: true });
}
