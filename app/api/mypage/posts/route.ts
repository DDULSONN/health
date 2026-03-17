import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

const MY_POSTS_SELECT =
  "id,user_id,type,title,content,payload_json,images,gender,score_sum,vote_count,great_count,good_count,normal_count,rookie_count,is_hidden,is_deleted,created_at";

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
    .select(MY_POSTS_SELECT)
    .eq("user_id", user.id)
    .eq("type", "free")
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
