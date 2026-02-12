import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/** GET /api/mypage/deleted — 내가 삭제한 글 (deleted_logs) */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("deleted_logs")
    .select("*")
    .eq("user_id", user.id)
    .order("deleted_at", { ascending: false })
    .limit(50);

  if (error) {
    console.error("[GET /api/mypage/deleted]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ logs: data ?? [] });
}
