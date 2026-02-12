import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/** GET /api/mypage/posts — 내가 쓴 글 (free / bodycheck) */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("posts")
    .select("*")
    .eq("user_id", user.id)
    .in("type", ["free", "bodycheck"])
    .eq("is_hidden", false)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    console.error("[GET /api/mypage/posts]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const posts = (data ?? []).filter(
    (p) => !(p as Record<string, unknown>).is_deleted
  );

  return NextResponse.json({ posts });
}
