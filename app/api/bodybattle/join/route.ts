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
const INTERNAL_IMAGE_PATH_PREFIXES = ["/i/public-lite/community/", "/i/signed/community/"];
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

function normalizeImageUrl(value: string, request: Request): string | null {
  try {
    const requestUrl = new URL(request.url);
    const url = new URL(value, requestUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.origin === requestUrl.origin) {
      if (!INTERNAL_IMAGE_PATH_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) return null;
      return `${url.pathname}${url.search}`;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function isAllowedImageUrl(value: string, request: Request): boolean {
  try {
    const requestUrl = new URL(request.url);
    const url = new URL(value, requestUrl);
    if (url.origin === requestUrl.origin) {
      return INTERNAL_IMAGE_PATH_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
    }
    if (url.protocol !== "https:") return false;
    const hostname = url.hostname.toLowerCase();
    return ALLOWED_IMAGE_DOMAINS.some((allowed) => hostname === allowed || hostname.endsWith(`.${allowed}`));
  } catch {
    return false;
  }
}

async function validateRemoteImage(url: string, request: Request) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const targetUrl = new URL(url, request.url);
    const headRes = await fetch(targetUrl, {
      method: "HEAD",
      redirect: "manual",
      signal: controller.signal,
      cache: "no-store",
    });
    if (!headRes.ok) return "이미지 주소에 접근할 수 없습니다.";
    const contentType = (headRes.headers.get("content-type") ?? "").toLowerCase();
    if (contentType && !contentType.startsWith("image/")) {
      return "이미지 파일만 사용할 수 있습니다.";
    }
    const contentLength = Number(headRes.headers.get("content-length") ?? 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_BYTES) {
      return "이미지 용량은 8MB 이하여야 합니다.";
    }
    return null;
  } catch {
    return "이미지 주소 검증에 실패했습니다.";
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
    return NextResponse.json({ ok: false, message: "로그인이 필요합니다." }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as JoinBody;
  const seasonId = (body.season_id ?? "").trim();
  const gender = body.gender;
  const consentPolicy = body.consent_policy === true;
  const consentInstagramReels = body.consent_instagram_reels === true;
  const rawImageUrls = Array.isArray(body.image_urls) ? body.image_urls : [];
  const normalizedImageUrls = rawImageUrls
    .map((url) => (typeof url === "string" ? normalizeImageUrl(url.trim(), request) : null))
    .filter((url): url is string => Boolean(url))
    .filter((url) => url.length > 0)
    .slice(0, 2);

  if (!seasonId) {
    return NextResponse.json({ ok: false, message: "시즌 정보가 없습니다." }, { status: 400 });
  }
  if (gender !== "male" && gender !== "female") {
    return NextResponse.json({ ok: false, message: "성별 정보가 올바르지 않습니다." }, { status: 400 });
  }
  if (!consentPolicy || !consentInstagramReels) {
    return NextResponse.json({ ok: false, message: "필수 동의 항목을 모두 체크해 주세요." }, { status: 400 });
  }
  if (normalizedImageUrls.length < 1) {
    return NextResponse.json({ ok: false, message: "사진을 최소 1장 업로드해 주세요." }, { status: 400 });
  }
  if (rawImageUrls.some((url) => typeof url !== "string" || !normalizeImageUrl(url.trim(), request))) {
    return NextResponse.json({ ok: false, message: "이미지 주소 형식이 올바르지 않습니다." }, { status: 400 });
  }
  if (normalizedImageUrls.some((url) => !isAllowedImageUrl(url, request))) {
    return NextResponse.json({ ok: false, message: "허용되지 않은 이미지 주소입니다." }, { status: 400 });
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
    return NextResponse.json({ ok: false, message: "해당 시즌을 찾지 못했습니다." }, { status: 404 });
  }

  const nowIso = new Date().toISOString();
  if (seasonRes.data.status !== "active" || seasonRes.data.start_at > nowIso || seasonRes.data.end_at <= nowIso) {
    return NextResponse.json({ ok: false, message: "현재 신청 가능한 시즌이 아닙니다." }, { status: 400 });
  }

  const imageChecks = await Promise.all(normalizedImageUrls.map((url) => validateRemoteImage(url, request)));
  const imageCheckError = imageChecks.find((message) => Boolean(message));
  if (imageCheckError) {
    return NextResponse.json({ ok: false, message: imageCheckError }, { status: 400 });
  }

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
      { ok: false, message: "이미 검수가 끝난 신청서는 수정할 수 없습니다." },
      { status: 409 }
    );
  }

  const dupChecks = await Promise.all(
    normalizedImageUrls.map((url) =>
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
    return NextResponse.json({ ok: false, message: "같은 시즌에 중복 사진은 등록할 수 없습니다." }, { status: 409 });
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
    image_urls: normalizedImageUrls,
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
