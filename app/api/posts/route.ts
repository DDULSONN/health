import { createClient } from "@/lib/supabase/server";
import { containsProfanity, getRateLimitRemaining } from "@/lib/moderation";
import { NextResponse } from "next/server";

const POST_COOLDOWN_MS = 30_000;

/** GET /api/posts — 피드 목록 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type"); // optional filter
  const tab = searchParams.get("tab"); // "records" | "free" | null
  const page = Math.max(1, Number(searchParams.get("page") ?? 1));
  const limit = 20;
  const offset = (page - 1) * limit;

  const supabase = await createClient();

  let query = supabase
    .from("posts")
    .select("*, profiles(nickname, role)", { count: "exact" })
    .eq("is_hidden", false)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (tab === "records") {
    query = query.neq("type", "free");
  } else if (tab === "free") {
    query = query.eq("type", "free");
  }

  if (type && type !== "all") query = query.eq("type", type);

  const { data, count, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ posts: data ?? [], total: count ?? 0, page });
}

/** POST /api/posts — 글 작성 (user_id는 서버 세션에서 추출) */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const body = await request.json();
  const { type, title, content, payload_json } = body;

  if (!type || !title) {
    return NextResponse.json({ error: "type과 title은 필수입니다." }, { status: 400 });
  }

  // 금칙어 체크
  if (containsProfanity(title) || (content && containsProfanity(content))) {
    return NextResponse.json({ error: "부적절한 표현이 포함되어 있습니다." }, { status: 400 });
  }

  // payload 검증 (기록 타입일 때 값 확인)
  if (type === "lifts" && payload_json) {
    const { squat, bench, deadlift } = payload_json as Record<string, number>;
    if ((!squat && !bench && !deadlift) || [squat, bench, deadlift].some((v) => typeof v === "number" && isNaN(v))) {
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

  // NaN 방지: payload_json 내 숫자값 정리
  let cleanPayload = payload_json ?? null;
  if (cleanPayload && typeof cleanPayload === "object") {
    cleanPayload = Object.fromEntries(
      Object.entries(cleanPayload).map(([k, v]) => [
        k,
        typeof v === "number" && isNaN(v) ? 0 : v,
      ])
    );
  }

  const { data, error } = await supabase
    .from("posts")
    .insert({
      user_id: user.id,
      type,
      title,
      content: content ?? null,
      payload_json: cleanPayload,
    })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ id: data.id }, { status: 201 });
}
