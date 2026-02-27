import { isAllowedAdminUser } from "@/lib/admin";
import { buildSignedImageUrl, extractStorageObjectPathFromBuckets } from "@/lib/images";
import { getDatingOneOnOneWriteStatus, isPhoneVerified } from "@/lib/dating-1on1";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

type InputPayload = {
  name?: string;
  birth_year?: number | string;
  height_cm?: number | string;
  job?: string;
  region?: string;
  phone?: string;
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

const SMOKING_VALUES = new Set(["non_smoker", "occasional", "smoker"]);
const WORKOUT_VALUES = new Set(["none", "1_2", "3_4", "5_plus"]);

function toInt(value: number | string | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  if (typeof value === "string" && value.trim().length > 0) {
    const n = Number(value);
    if (Number.isFinite(n)) return Math.round(n);
  }
  return null;
}

function normalizePath(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim();
  if (!trimmed) return "";
  return extractStorageObjectPathFromBuckets(trimmed, ["dating-1on1-photos"]) ?? trimmed;
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isAllowedAdminUser(user.id, user.email)) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("dating_1on1_cards")
    .select(
      "id,user_id,name,birth_year,height_cm,job,region,phone,intro_text,strengths_text,preferred_partner_text,smoking,workout_frequency,status,photo_paths,created_at"
    )
    .order("created_at", { ascending: false })
    .limit(300);

  if (error) {
    console.error("[GET /api/dating/1on1/cards] failed", error);
    return NextResponse.json({ error: "Failed to load cards." }, { status: 500 });
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
      photo_signed_urls,
    };
  });

  return NextResponse.json({ items });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isAllowedAdminUser(user.id, user.email)) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const admin = createAdminClient();
  const writeStatus = await getDatingOneOnOneWriteStatus(admin);
  if (writeStatus !== "approved") {
    return NextResponse.json({ error: "Writing is paused." }, { status: 403 });
  }

  if (!isPhoneVerified(user)) {
    return NextResponse.json({ error: "Phone verification is required." }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as InputPayload | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const name = (body.name ?? "").trim();
  const birthYear = toInt(body.birth_year);
  const heightCm = toInt(body.height_cm);
  const job = (body.job ?? "").trim();
  const region = (body.region ?? "").trim();
  const phone = (body.phone ?? "").replace(/[^0-9]/g, "");
  const introText = (body.intro_text ?? "").trim();
  const strengthsText = (body.strengths_text ?? "").trim();
  const preferredPartnerText = (body.preferred_partner_text ?? "").trim();
  const smoking = (body.smoking ?? "").trim();
  const workoutFrequencyRaw = body.workout_frequency;
  const workoutFrequency =
    typeof workoutFrequencyRaw === "string" && workoutFrequencyRaw.trim().length > 0
      ? workoutFrequencyRaw.trim()
      : null;

  const fakeInfoConsent = body.consent_fake_info === true;
  const noShowConsent = body.consent_no_show === true;
  const feeConsent = body.consent_fee === true;
  const privacyConsent = body.consent_privacy === true;

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
  if (phone.length < 9 || phone.length > 15) {
    return NextResponse.json({ error: "Phone number must be 9-15 digits." }, { status: 400 });
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
  if (!fakeInfoConsent || !noShowConsent || !feeConsent || !privacyConsent) {
    return NextResponse.json({ error: "All consent checkboxes are required." }, { status: 400 });
  }

  const rawPaths = Array.isArray(body.photo_paths) ? body.photo_paths : [];
  const photoPaths = rawPaths
    .map((path) => normalizePath(path))
    .filter((path): path is string => typeof path === "string" && path.length > 0)
    .slice(0, 4);

  if (photoPaths.length === 0) {
    return NextResponse.json({ error: "At least one photo is required." }, { status: 400 });
  }

  const { data, error } = await admin
    .from("dating_1on1_cards")
    .insert({
      user_id: user.id,
      name,
      birth_year: birthYear,
      height_cm: heightCm,
      job,
      region,
      phone,
      intro_text: introText,
      strengths_text: strengthsText,
      preferred_partner_text: preferredPartnerText,
      smoking,
      workout_frequency: workoutFrequency,
      photo_paths: photoPaths,
      consent_fake_info: fakeInfoConsent,
      consent_no_show: noShowConsent,
      consent_fee: feeConsent,
      consent_privacy: privacyConsent,
      status: "submitted",
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("[POST /api/dating/1on1/cards] failed", error);
    return NextResponse.json({ error: "Failed to create card." }, { status: 500 });
  }

  return NextResponse.json({ id: data.id }, { status: 201 });
}

