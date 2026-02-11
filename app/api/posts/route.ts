import { createClient } from "@/lib/supabase/server";
import { containsProfanity, getRateLimitRemaining } from "@/lib/moderation";
import { NextResponse } from "next/server";

const POST_COOLDOWN_MS = 30_000;

/** GET /api/posts — 피드 목록 (프로필을 별도 조회하여 FK join 의존 제거) */
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
    query = query.neq("type", "free");
  } else if (tab === "free") {
    query = query.eq("type", "free");
  }

  if (type && type !== "all") query = query.eq("type", type);

  const { data: posts, count, error } = await query;

  if (error) {
    console.error("[GET /api/posts]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // 프로필을 별도로 조회하여 머지
  const userIds = [...new Set((posts ?? []).map((p) => p.user_id as string))];
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

  const enriched = (posts ?? []).map((p) => ({
    ...p,
    profiles: profileMap.get(p.user_id as string) ?? null,
  }));

  return NextResponse.json({ posts: enriched, total: count ?? 0, page });
}

/** POST /api/posts — 글 작성 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const body = await request.json();
  const { type, title, content, payload_json, images } = body;

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
      [squat, bench, deadlift].some((v) => typeof v === "number" && isNaN(v))
    ) {
      return NextResponse.json({ error: "유효한 기록을 입력해주세요." }, { status: 400 });
    }
  }

  if (type === "1rm" && payload_json) {
    const { oneRmKg } = payload_json as Record<string, number>;
    if (!oneRmKg || isNaN(oneRmKg)) {
      return NextResponse.json({ error: "유효한 1RM 값이 필요합니다." }, { status: 400 });
    }
  }

  // rate limit
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

  // NaN 방지
  let cleanPayload = payload_json ?? null;
  if (cleanPayload && typeof cleanPayload === "object") {
    cleanPayload = Object.fromEntries(
      Object.entries(cleanPayload).map(([k, v]) => [
        k,
        typeof v === "number" && isNaN(v) ? 0 : v,
      ])
    );
  }

  // 이미지 URL 정리
  const cleanImages = Array.isArray(images)
    ? images
        .filter((url: unknown) => typeof url === "string" && url.startsWith("http"))
        .slice(0, 3)
    : [];

  const insertData: Record<string, unknown> = {
    user_id: user.id,
    type,
    title,
    content: content ?? null,
    payload_json: cleanPayload,
  };

  // images 컬럼이 있을 때만 포함 (migration_v2 실행 전에는 생략)
  if (cleanImages.length > 0) {
    insertData.images = cleanImages;
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
