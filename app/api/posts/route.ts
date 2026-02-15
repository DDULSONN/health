import { createClient } from "@/lib/supabase/server";
import { containsProfanity, getRateLimitRemaining } from "@/lib/moderation";
import { NextResponse } from "next/server";
import type { BodycheckGender } from "@/lib/community";
import { fetchUserCertSummaryMap } from "@/lib/cert-summary";

const POST_COOLDOWN_MS = 30_000;
const RECORD_TYPES = ["lifts", "1rm", "helltest"];
const BODYCHECK_TYPES = ["photo_bodycheck"];

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type");
  const tab = searchParams.get("tab");
  const page = Math.max(1, Number(searchParams.get("page") ?? 1));
  const limit = 20;
  const offset = (page - 1) * limit;

  const supabase = await createClient();

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

  const visible = (posts ?? []).filter(
    (p) => !(p as Record<string, unknown>).is_deleted
  );

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

  const enriched = visible.map((p) => ({
    ...p,
    profiles: profileMap.get(p.user_id as string) ?? null,
    cert_summary: null,
  }));

  const certSummaryMap = await fetchUserCertSummaryMap(userIds, supabase);
  for (const post of enriched) {
    post.cert_summary = certSummaryMap.get(post.user_id as string) ?? null;
  }

  return NextResponse.json({ posts: enriched, total: count ?? 0, page });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
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
      return NextResponse.json({ error: "유효한 기록을 입력해주세요." }, { status: 400 });
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
        .filter((url: unknown) => typeof url === "string" && url.startsWith("http"))
        .slice(0, 3)
    : [];

  if (type === "photo_bodycheck") {
    if (gender !== "male" && gender !== "female") {
      return NextResponse.json(
        { error: "사진 몸평 게시글은 성별(male/female)이 필수입니다." },
        { status: 400 }
      );
    }
    if (cleanImages.length < 1 || cleanImages.length > 3) {
      return NextResponse.json(
        { error: "사진 몸평 게시글은 사진 1~3장이 필요합니다." },
        { status: 400 }
      );
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
      return NextResponse.json(
        { error: "오늘은 이미 기록을 공유했어요. 내일 다시 시도해주세요." },
        { status: 429 }
      );
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
      { error: `${Math.ceil(remaining / 1000)}초 후에 다시 시도해주세요.` },
      { status: 429 }
    );
  }

  let cleanPayload = payload_json ?? null;
  if (cleanPayload && typeof cleanPayload === "object") {
    cleanPayload = Object.fromEntries(
      Object.entries(cleanPayload).map(([k, v]) => [
        k,
        typeof v === "number" && Number.isNaN(v) ? 0 : v,
      ])
    );
  }

  const insertData: Record<string, unknown> = {
    user_id: user.id,
    type,
    title: title.trim(),
    content: content?.trim() ? content.trim() : null,
    payload_json: cleanPayload,
  };

  if (cleanImages.length > 0) {
    insertData.images = cleanImages;
  }

  if (type === "photo_bodycheck") {
    insertData.gender = gender;
    insertData.score_sum = 0;
    insertData.vote_count = 0;
    insertData.great_count = 0;
    insertData.good_count = 0;
    insertData.normal_count = 0;
    insertData.rookie_count = 0;
  }

  const { data, error } = await supabase
    .from("posts")
    .insert(insertData)
    .select("id")
    .single();

  if (error) {
    console.error("[POST /api/posts]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ id: data.id }, { status: 201 });
}
