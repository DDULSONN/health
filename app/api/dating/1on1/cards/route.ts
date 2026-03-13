import { isAllowedAdminUser } from "@/lib/admin";
import { buildSignedImageUrl, extractStorageObjectPathFromBuckets } from "@/lib/images";
import {
  DATING_ONE_ON_ONE_ACTIVE_STATUSES,
  expireStaleDatingOneOnOneCards,
  getDatingOneOnOneWriteStatus,
  getProfilePhoneVerification,
} from "@/lib/dating-1on1";
import { createAdminClient } from "@/lib/supabase/server";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { NextResponse } from "next/server";

type InputPayload = {
  sex?: string;
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

type AdminCardRow = {
  id: string;
  user_id: string;
  sex: "male" | "female";
  name: string;
  birth_year: number;
  height_cm: number;
  job: string;
  region: string;
  phone: string;
  intro_text: string;
  strengths_text: string;
  preferred_partner_text: string;
  smoking: "non_smoker" | "occasional" | "smoker";
  workout_frequency: "none" | "1_2" | "3_4" | "5_plus" | null;
  status: "submitted" | "reviewing" | "approved" | "rejected";
  photo_paths: string[] | null;
  admin_note?: string | null;
  admin_tags?: string[] | null;
  reviewed_by_user_id?: string | null;
  reviewed_at?: string | null;
  created_at: string;
};

const SEX_VALUES = new Set(["male", "female"]);
const SMOKING_VALUES = new Set(["non_smoker", "occasional", "smoker"]);
const WORKOUT_VALUES = new Set(["none", "1_2", "3_4", "5_plus"]);
const ADMIN_CARD_BATCH_SIZE = 1000;

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

function toCurrentAge(birthYear: number | null | undefined): number | null {
  if (!birthYear || !Number.isFinite(birthYear)) return null;
  return new Date().getFullYear() - birthYear + 1;
}

async function fetchAllAdminCards(admin: ReturnType<typeof createAdminClient>) {
  const rows: AdminCardRow[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await admin
      .from("dating_1on1_cards")
      .select(
        "id,user_id,sex,name,birth_year,height_cm,job,region,phone,intro_text,strengths_text,preferred_partner_text,smoking,workout_frequency,status,photo_paths,admin_note,admin_tags,reviewed_by_user_id,reviewed_at,created_at"
      )
      .order("created_at", { ascending: false })
      .range(from, from + ADMIN_CARD_BATCH_SIZE - 1);

    if (error) throw error;

    const batch = (data ?? []) as AdminCardRow[];
    rows.push(...batch);

    if (batch.length < ADMIN_CARD_BATCH_SIZE) break;
    from += ADMIN_CARD_BATCH_SIZE;
  }

  return rows;
}

export async function GET(req: Request) {
  const { user } = await getRequestAuthContext(req);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isAllowedAdminUser(user.id, user.email)) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const sex = searchParams.get("sex")?.trim() ?? "";
  const region = searchParams.get("region")?.trim() ?? "";
  const status = searchParams.get("status")?.trim() ?? "";
  const q = searchParams.get("q")?.trim() ?? "";
  const minAge = toInt(searchParams.get("minAge") ?? "");
  const maxAge = toInt(searchParams.get("maxAge") ?? "");
  const sort = (searchParams.get("sort") ?? "created_desc").trim();

  const admin = createAdminClient();
  await expireStaleDatingOneOnOneCards(admin).catch((error) => {
    console.error("[GET /api/dating/1on1/cards] stale expire failed", error);
  });
  let data;
  try {
    data = await fetchAllAdminCards(admin);
  } catch (error) {
    console.error("[GET /api/dating/1on1/cards] failed", error);
    return NextResponse.json({ error: "Failed to load cards." }, { status: 500 });
  }

  const normalized = (data ?? []).map((row) => {
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
      age: toCurrentAge(row.birth_year),
    };
  });

  let items = normalized;
  if (sex && SEX_VALUES.has(sex)) {
    items = items.filter((item) => item.sex === sex);
  }
  if (region) {
    items = items.filter((item) => item.region?.includes(region));
  }
  if (status && ["submitted", "reviewing", "approved", "rejected"].includes(status)) {
    items = items.filter((item) => item.status === status);
  }
  if (minAge != null) {
    items = items.filter((item) => (item.age ?? 0) >= minAge);
  }
  if (maxAge != null) {
    items = items.filter((item) => (item.age ?? 999) <= maxAge);
  }
  if (q) {
    const needle = q.toLowerCase();
    items = items.filter((item) => {
      const fields = [
        item.name,
        item.job,
        item.region,
        item.intro_text,
        item.strengths_text,
        item.preferred_partner_text,
        Array.isArray(item.admin_tags) ? item.admin_tags.join(" ") : "",
        typeof item.admin_note === "string" ? item.admin_note : "",
      ];
      return fields.some((field) => String(field ?? "").toLowerCase().includes(needle));
    });
  }

  items = [...items].sort((a, b) => {
    if (sort === "age_asc") return (a.age ?? 0) - (b.age ?? 0);
    if (sort === "age_desc") return (b.age ?? 0) - (a.age ?? 0);
    if (sort === "region_asc") return (a.region ?? "").localeCompare(b.region ?? "", "ko");
    if (sort === "region_desc") return (b.region ?? "").localeCompare(a.region ?? "", "ko");
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  const summarize = (rows: Array<{ status: string }>) => ({
    total: rows.length,
    submitted: rows.filter((r) => r.status === "submitted").length,
    reviewing: rows.filter((r) => r.status === "reviewing").length,
    approved: rows.filter((r) => r.status === "approved").length,
    rejected: rows.filter((r) => r.status === "rejected").length,
  });

  return NextResponse.json({
    items,
    counts_total: summarize(normalized),
    counts_filtered: summarize(items),
  });
}

export async function POST(req: Request) {
  const { user } = await getRequestAuthContext(req);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

  try {
    await expireStaleDatingOneOnOneCards(admin, user.id);
  } catch (error) {
    console.error("[POST /api/dating/1on1/cards] stale expire failed", error);
    return NextResponse.json({ error: "Failed to refresh old requests." }, { status: 500 });
  }

  const duplicateRes = await admin
    .from("dating_1on1_cards")
    .select("id,status,created_at")
    .eq("user_id", user.id)
    .in("status", [...DATING_ONE_ON_ONE_ACTIVE_STATUSES])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (duplicateRes.error) {
    console.error("[POST /api/dating/1on1/cards] duplicate check failed", duplicateRes.error);
    return NextResponse.json({ error: "Failed to check duplicate request." }, { status: 500 });
  }
  if (duplicateRes.data) {
    return NextResponse.json(
      { error: "An active request already exists. Complete it before creating a new one." },
      { status: 409 }
    );
  }

  const body = (await req.json().catch(() => null)) as InputPayload | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const sex = (body.sex ?? "").trim();
  const name = (body.name ?? "").trim();
  const birthYear = toInt(body.birth_year);
  const heightCm = toInt(body.height_cm);
  const job = (body.job ?? "").trim();
  const region = (body.region ?? "").trim();
  const phone = phoneState.phoneE164;
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
  if (!fakeInfoConsent || !noShowConsent || !feeConsent || !privacyConsent) {
    return NextResponse.json({ error: "All consent checkboxes are required." }, { status: 400 });
  }

  const rawPaths = Array.isArray(body.photo_paths) ? body.photo_paths : [];
  const photoPaths = rawPaths
    .map((path) => normalizePath(path))
    .filter((path): path is string => typeof path === "string" && path.length > 0)
    .slice(0, 2);

  if (photoPaths.length !== 2) {
    return NextResponse.json({ error: "Exactly two photos are required." }, { status: 400 });
  }

  const { data, error } = await admin
    .from("dating_1on1_cards")
    .insert({
      user_id: user.id,
      sex,
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
