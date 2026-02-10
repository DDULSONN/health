import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/** GET /api/posts/[id] — 게시글 상세 + 댓글 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: post, error } = await supabase
    .from("posts")
    .select("*, profiles(nickname)")
    .eq("id", id)
    .single();

  if (error || !post) {
    return NextResponse.json({ error: "게시글을 찾을 수 없습니다." }, { status: 404 });
  }

  const { data: comments } = await supabase
    .from("comments")
    .select("*, profiles(nickname)")
    .eq("post_id", id)
    .eq("is_hidden", false)
    .order("created_at", { ascending: true });

  return NextResponse.json({ post, comments: comments ?? [] });
}
