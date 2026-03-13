import { BODY_BATTLE_DEFAULT_RATING } from "@/lib/bodybattle";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

type JoinBody = {
  season_id?: string;
  gender?: "male" | "female";
  image_urls?: string[];
  consent_policy?: boolean;
  consent_instagram_reels?: boolean;
};

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

// SSRF 방지: 허용된 외부 이미지 도메인만 허용
const ALLOWED_IMAGE_DOMAINS = [
  "instagram.com",
  "cdninstagram.com",
  "scontent.cdninstagram.com",
  "fbcdn.net",
  "i.imgur.com",
  "imgur.com",
  "pbs.twimg.com",
  "abs.twimg.com",
];

function isAllowedImageDomain(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    const hostname = url.hostname.toLowerCase();
    return ALLOWED_IMAGE_DOMAINS.some(
      (allowed) => hostname === allowed || hostname.endsWith("." + allowed)
    );
  } catch {
    return false;
  }
}

function isValidHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

async function validateRemoteImage(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const headRes = await fetch(url, {
      method: "HEAD",
      redirect: "manual", // redirect 차단 (SSRF 방지)
      signal: controller.signal,
      cache: "no-store",
    });
    if (!headRes.ok) return "Image URL is not reachable.";
    const contentType = (headRes.headers.get("content-type") ?? "").toLowerCase();
    if (contentType && !contentType.startsWith("image/")) {
      return "URL must point to an image.";
    }
    const contentLength = Number(headRes.headers.get("content-length") ?? 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_BYTES) {
      return "Image is too large (max 8MB).";
    }
    return null;
  } catch {
    return "Failed to validate image URL.";
  } finally {
    clearTimeout(timeout);
  }
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ ok: false, message: "Login is required." }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as JoinBody;
  const seasonId = (body.season_id ?? "").trim();
  const gender = body.gender;
  const consentPolicy = body.consent_policy === true;
  const consentInstagramReels = body.consent_instagram_reels === true;
  const imageUrls = Array.isArray(body.image_urls)
    ? body.image_urls
        .map((url) => (typeof url === "string" ? url.trim() : ""))
        .filter((url) => url.length > 0)
        .slice(0, 2)
    : [];

  if (!seasonId) {
    return NextResponse.json({ ok: false, message: "season_id is required." }, { status: 400 });
  }
  if (gender !== "male" && gender !== "female") {
    return NextResponse.json({ ok: false, message: "gender must be male or female." }, { status: 400 });
  }
  if (!consentPolicy || !consentInstagramReels) {
    return NextResponse.json({ ok: false, message: "Required consents must be accepted." }, { status: 400 });
  }
  if (imageUrls.length < 1) {
    return NextResponse.json({ ok: false, message: "At least one image is required." }, { status: 400 });
  }
  if (imageUrls.some((url) => !isValidHttpUrl(url))) {
    return NextResponse.json({ ok: false, message: "Image URL must be valid http/https URL." }, { status: 400 });
  }
  if (imageUrls.some((url) => !isAllowedImageDomain(url))) {
    return NextResponse.json({ ok: false, message: "Image URL domain is not allowed." }, { status: 400 });
  }

  const admin = createAdminClient();
  const seasonRes = await admin
    .from("bodybattle_seasons")
    .select("id,status,start_at,end_at")
    .eq("id", seasonId)
    .limit(1)
    .maybeSingle();

  if (seasonRes.error) {
    return NextResponse.json({ ok: false, message: seasonRes.error.message }, { status: 500 });
  }
  if (!seasonRes.data) {
    return NextResponse.json({ ok: false, message: "Season not found." }, { status: 404 });
  }

  const nowIso = new Date().toISOString();
  if (seasonRes.data.status !== "active" || seasonRes.data.start_at > nowIso || seasonRes.data.end_at <= nowIso) {
    return NextResponse.json({ ok: false, message: "This season is not open for joining." }, { status: 400 });
  }

  const imageChecks = await Promise.all(imageUrls.map((url) => validateRemoteImage(url)));
  const imageCheckError = imageChecks.find((message) => Boolean(message));
  if (imageCheckError) {
    return NextResponse.json({ ok: false, message: imageCheckError }, { status: 400 });
  }

  // 승인된 항목은 재제출 불가
  const existingEntryRes = await admin
    .from("bodybattle_entries")
    .select("id,moderation_status")
    .eq("season_id", seasonId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (existingEntryRes.error) {
    return NextResponse.json({ ok: false, message: existingEntryRes.error.message }, { status: 500 });
  }
  if (existingEntryRes.data && existingEntryRes.data.moderation_status !== "pending") {
    return NextResponse.json(
      { ok: false, message: "Entry has already been reviewed and cannot be modified." },
      { status: 409 }
    );
  }

  const dupChecks = await Promise.all(
    imageUrls.map((url) =>
      admin
        .from("bodybattle_entries")
        .select("id,user_id")
        .eq("season_id", seasonId)
        .contains("image_urls", [url])
        .neq("user_id", user.id)
        .limit(1)
        .maybeSingle()
    )
  );
  const dupError = dupChecks.find((res) => Boolean(res.error))?.error;
  if (dupError) {
    return NextResponse.json({ ok: false, message: dupError.message }, { status: 500 });
  }
  if (dupChecks.some((res) => Boolean(res.data))) {
    return NextResponse.json({ ok: false, message: "Duplicate image is not allowed in this season." }, { status: 409 });
  }

  const profileRes = await admin.from("profiles").select("nickname").eq("user_id", user.id).maybeSingle();
  if (profileRes.error) {
    return NextResponse.json({ ok: false, message: profileRes.error.message }, { status: 500 });
  }

  const fallbackEmailNickname = String(user.email ?? "")
    .split("@")[0]
    .trim();
  const resolvedNicknameRaw = (profileRes.data?.nickname ?? (fallbackEmailNickname || "익명")).trim();
  const resolvedNickname = resolvedNicknameRaw.slice(0, 24) || "익명";

  const payload = {
    season_id: seasonId,
    user_id: user.id,
    nickname: resolvedNickname,
    gender,
    image_urls: imageUrls,
    rating: BODY_BATTLE_DEFAULT_RATING,
    moderation_status: "pending",
    status: "inactive",
  } as const;

  const upsertRes = await admin
    .from("bodybattle_entries")
    .upsert(payload, {
      onConflict: "season_id,user_id",
    })
    .select("id,season_id,user_id,nickname,gender,moderation_status,status,created_at")
    .single();

  if (upsertRes.error) {
    return NextResponse.json({ ok: false, message: upsertRes.error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, entry: upsertRes.data }, { status: 201 });
}
