import { createAdminClient, createClient } from "@/lib/supabase/server";
import { containsProfanity, getRateLimitRemaining } from "@/lib/moderation";
import { checkRouteRateLimit, extractClientIp } from "@/lib/request-rate-limit";
import { getCachedSignedUrlWithBucket } from "@/lib/signed-url-cache";
import { NextResponse } from "next/server";
import type { BodycheckGender } from "@/lib/community";
import { fetchUserCertSummaryMap } from "@/lib/cert-summary";
import { getConfirmedUserOrResponse } from "@/lib/auth-confirmed";

const POST_COOLDOWN_MS = 30_000;
const RECORD_TYPES = ["lifts", "1rm", "helltest"];
const BODYCHECK_TYPES = ["photo_bodycheck"];
const BODYCHECK_LIST_IMAGE_WIDTH = 960;
const BODYCHECK_LIST_IMAGE_QUALITY = 72;
const COMMUNITY_LIST_TRANSFORM = { width: 1200, quality: 78 };
const COMMUNITY_SIGNED_URL_TTL_SEC = 3600;

async function resolveCommunityImageUrl(
  supabase: Awaited<ReturnType<typeof createClient>>,
  adminClient: ReturnType<typeof createAdminClient>,
  requestId: string,
  raw: unknown,
  counters: { signCalls: number; cacheHit: number; cacheMiss: number }
): Promise<string | null> {
  const url = toCommunityPublicUrl(supabase, raw);
  if (!url) return null;
  const marker = "/storage/v1/object/public/community/";
  const idx = url.indexOf(marker);
  if (idx < 0) return url;
  const path = url.slice(idx + marker.length).split("?")[0] ?? "";
  if (!path) return url;

  const signed = await getCachedSignedUrlWithBucket({
    requestId,
    bucket: "community",
    path,
    cachePath: `${path}::list:w${COMMUNITY_LIST_TRANSFORM.width}:q${COMMUNITY_LIST_TRANSFORM.quality}`,
    ttlSec: COMMUNITY_SIGNED_URL_TTL_SEC,
    getSignCallCount: () => counters.signCalls,
    createSignedUrl: async (bucket, p, ttlSec) => {
      counters.signCalls += 1;
      const transformed = await adminClient.storage
        .from(bucket)
        .createSignedUrl(p, ttlSec, { transform: COMMUNITY_LIST_TRANSFORM });
      if (!transformed.error && transformed.data?.signedUrl) return transformed.data.signedUrl;
      const fallback = await adminClient.storage.from(bucket).createSignedUrl(p, ttlSec);
      if (fallback.error || !fallback.data?.signedUrl) return "";
      return fallback.data.signedUrl;
    },
  });
  if (signed.cacheStatus === "hit") counters.cacheHit += 1;
  if (signed.cacheStatus === "miss") counters.cacheMiss += 1;
  if (signed.url) return signed.url;
  return url;
}

function toCommunityPublicUrl(supabase: Awaited<ReturnType<typeof createClient>>, raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value) return null;

  const publicPathToken = "/storage/v1/object/public/community/";
  const renderPathToken = "/storage/v1/render/image/public/community/";
  const publicIdx = value.indexOf(publicPathToken);
  if (publicIdx >= 0) {
    const path = value.slice(publicIdx + publicPathToken.length).split("?")[0] ?? "";
    if (!path) return null;
    return supabase.storage.from("community").getPublicUrl(path).data.publicUrl;
  }
  const renderIdx = value.indexOf(renderPathToken);
  if (renderIdx >= 0) {
    const path = value.slice(renderIdx + renderPathToken.length).split("?")[0] ?? "";
    if (!path) return null;
    return supabase.storage.from("community").getPublicUrl(path).data.publicUrl;
  }
  if (value.startsWith("http://") || value.startsWith("https://")) return value;

  const publicPrefix = "/storage/v1/object/public/community/";
  let path = value;
  if (path.startsWith(publicPrefix)) {
    path = path.slice(publicPrefix.length);
  } else if (path.startsWith("storage/v1/object/public/community/")) {
    path = path.slice("storage/v1/object/public/community/".length);
  } else if (path.startsWith("community/")) {
    path = path.slice("community/".length);
  } else if (path.startsWith("/")) {
    path = path.slice(1);
  }
  if (!path) return null;
  return supabase.storage.from("community").getPublicUrl(path).data.publicUrl;
}

function extractThumbImages(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") return [];
  const raw = (payload as { thumb_images?: unknown }).thumb_images;
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === "string" && item.startsWith("http")).slice(0, 3);
}

export async function GET(request: Request) {
  const requestId = crypto.randomUUID();
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type");
  const tab = searchParams.get("tab");
  const page = Math.max(1, Number(searchParams.get("page") ?? 1));
  const limit = 20;
  const offset = (page - 1) * limit;

  const supabase = await createClient();
  const adminClient = createAdminClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const ip = extractClientIp(request);
  const rateLimit = await checkRouteRateLimit({
    requestId,
    scope: "posts-list",
    userId: user?.id ?? null,
    ip,
    userLimitPerMin: 40,
    ipLimitPerMin: 160,
    path: "/api/posts",
  });
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." }, { status: 429 });
  }

  let query = supabase
    .from("posts")
    .select("*", { count: "exact" })
    .eq("is_hidden", false)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (tab === "records") {
    query = query.in("type", RECORD_TYPES);
  } else if (tab === "free") {
    query = query.eq("type", "free");
  } else if (tab === "photo_bodycheck") {
    query = query.in("type", BODYCHECK_TYPES);
  }

  if (type && type !== "all") query = query.eq("type", type);

  const { data: posts, count, error } = await query;

  if (error) {
    console.error("[GET /api/posts]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const visible = (posts ?? []).filter((p) => !(p as Record<string, unknown>).is_deleted);
  const userIds = [...new Set(visible.map((p) => p.user_id as string))];

  const profileMap = new Map<string, { nickname: string; role: string }>();
  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("user_id, nickname, role")
      .in("user_id", userIds);

    for (const p of profiles ?? []) {
      profileMap.set(p.user_id, { nickname: p.nickname, role: p.role });
    }
  }

  const signCounters = { signCalls: 0, cacheHit: 0, cacheMiss: 0 };
  const enriched = await Promise.all(visible.map(async (p) => {
    const originalImages = Array.isArray((p as Record<string, unknown>).images)
      ? (
          await Promise.all(
            ((p as Record<string, unknown>).images as unknown[]).map((img) =>
              resolveCommunityImageUrl(supabase, adminClient, requestId, img, signCounters)
            )
          )
        ).filter((img): img is string => typeof img === "string")
      : [];
    const thumbImages = (
      await Promise.all(
        extractThumbImages((p as { payload_json?: unknown }).payload_json).map((img) =>
          resolveCommunityImageUrl(supabase, adminClient, requestId, img, signCounters)
        )
      )
    ).filter((img): img is string => typeof img === "string");
    return {
      ...p,
      images: originalImages,
      thumb_images: thumbImages,
      profiles: profileMap.get(p.user_id as string) ?? null,
      cert_summary: null,
    };
  }));

  const certSummaryMap = await fetchUserCertSummaryMap(userIds, supabase);
  for (const post of enriched) {
    post.cert_summary = certSummaryMap.get(post.user_id as string) ?? null;
  }
  const transformedBodycheckImages = enriched.reduce((acc, post) => {
    if ((post.type as string) !== "photo_bodycheck") return acc;
    const thumbImages = (post as { thumb_images?: unknown }).thumb_images;
    return acc + (Array.isArray(thumbImages) ? thumbImages.length : 0);
  }, 0);
  console.log(
    `[posts.metrics] requestId=${requestId} path=/api/posts page=${page} totalPosts=${enriched.length} transformedBodycheckImages=${transformedBodycheckImages}`
  );
  const signedTotal = signCounters.cacheHit + signCounters.cacheMiss;
  const cacheHitRatePct = signedTotal > 0 ? Math.round((signCounters.cacheHit / signedTotal) * 1000) / 10 : 0;
  console.log(
    `[posts.signedUrl] requestId=${requestId} path=/api/posts signCalls=${signCounters.signCalls} cacheHit=${signCounters.cacheHit} cacheMiss=${signCounters.cacheMiss} cacheHitRatePct=${cacheHitRatePct}`
  );

  return NextResponse.json(
    { posts: enriched, total: count ?? 0, page },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        Pragma: "no-cache",
        Expires: "0",
        "CDN-Cache-Control": "no-store",
        "Vercel-CDN-Cache-Control": "no-store",
      },
    }
  );
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const ip = extractClientIp(request);
  const supabase = await createClient();
  const guard = await getConfirmedUserOrResponse(supabase);
  if (guard.response) return guard.response;
  const user = guard.user;
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const rateLimit = await checkRouteRateLimit({
    requestId,
    scope: "posts-create",
    userId: user.id,
    ip,
    userLimitPerMin: 10,
    ipLimitPerMin: 60,
    path: "/api/posts",
  });
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." }, { status: 429 });
  }

  const body = await request.json();
  const { type, title, content, payload_json, images, gender } = body as {
    type?: string;
    title?: string;
    content?: string | null;
    payload_json?: Record<string, unknown> | null;
    images?: unknown[];
    gender?: BodycheckGender;
  };

  if (!type || !title) {
    return NextResponse.json({ error: "type과 title은 필수입니다." }, { status: 400 });
  }

  if (containsProfanity(title) || (content && containsProfanity(content))) {
    return NextResponse.json({ error: "부적절한 표현이 포함되어 있습니다." }, { status: 400 });
  }

  if (type === "lifts" && payload_json) {
    const { squat, bench, deadlift } = payload_json as Record<string, number>;
    if (
      (!squat && !bench && !deadlift) ||
      [squat, bench, deadlift].some((v) => typeof v === "number" && Number.isNaN(v))
    ) {
      return NextResponse.json({ error: "유효한 기록을 입력해 주세요." }, { status: 400 });
    }
  }

  if (type === "1rm" && payload_json) {
    const { oneRmKg } = payload_json as Record<string, number>;
    if (!oneRmKg || Number.isNaN(oneRmKg)) {
      return NextResponse.json({ error: "유효한 1RM 값이 필요합니다." }, { status: 400 });
    }
  }

  const cleanImages = Array.isArray(images)
    ? images
        .map((url: unknown) => toCommunityPublicUrl(supabase, url))
        .filter((url): url is string => typeof url === "string")
        .slice(0, 3)
    : [];

  if (type === "photo_bodycheck") {
    if (gender !== "male" && gender !== "female") {
      return NextResponse.json({ error: "사진 몸평은 성별(male/female)이 필수입니다." }, { status: 400 });
    }
    if (cleanImages.length < 1 || cleanImages.length > 3) {
      return NextResponse.json({ error: "사진 몸평 게시글은 사진 1~3장이 필요합니다." }, { status: 400 });
    }
  }

  if (RECORD_TYPES.includes(type)) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { count } = await supabase
      .from("posts")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .in("type", RECORD_TYPES)
      .gte("created_at", today.toISOString());

    if ((count ?? 0) >= 1) {
      return NextResponse.json({ error: "오늘은 이미 기록을 공유했어요. 내일 다시 시도해 주세요." }, { status: 429 });
    }
  }

  const { data: lastPost } = await supabase
    .from("posts")
    .select("created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  const remaining = getRateLimitRemaining(lastPost?.created_at ?? null, POST_COOLDOWN_MS);
  if (remaining > 0) {
    return NextResponse.json(
      { error: `${Math.ceil(remaining / 1000)}초 후에 다시 시도해 주세요.` },
      { status: 429 }
    );
  }

  let cleanPayload = payload_json ?? null;
  if (cleanPayload && typeof cleanPayload === "object") {
    const normalizedPayload = Object.fromEntries(
      Object.entries(cleanPayload).map(([k, v]) => [k, typeof v === "number" && Number.isNaN(v) ? 0 : v])
    );
    if (type === "photo_bodycheck" && Array.isArray(normalizedPayload.thumb_images)) {
      normalizedPayload.thumb_images = normalizedPayload.thumb_images
        .map((url: unknown) => toCommunityPublicUrl(supabase, url))
        .filter((url): url is string => typeof url === "string")
        .slice(0, 3);
    }
    cleanPayload = normalizedPayload;
  }

  const insertData: Record<string, unknown> = {
    user_id: user.id,
    type,
    title: title.trim(),
    content: content?.trim() ? content.trim() : null,
    payload_json: cleanPayload,
  };

  if (cleanImages.length > 0) insertData.images = cleanImages;

  if (type === "photo_bodycheck") {
    insertData.gender = gender;
    insertData.score_sum = 0;
    insertData.vote_count = 0;
    insertData.great_count = 0;
    insertData.good_count = 0;
    insertData.normal_count = 0;
    insertData.rookie_count = 0;
  }

  const { data, error } = await supabase.from("posts").insert(insertData).select("id").single();

  if (error) {
    console.error("[POST /api/posts]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ id: data.id }, { status: 201 });
}

