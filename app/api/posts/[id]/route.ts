import { createClient } from "@/lib/supabase/server";
import { containsProfanity } from "@/lib/moderation";
import { NextResponse } from "next/server";

type RouteCtx = { params: Promise<{ id: string }> };

/** GET /api/posts/[id] — 게시글 상세 + 댓글 */
export async function GET(_request: Request, { params }: RouteCtx) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: post, error: postErr } = await supabase
    .from("posts")
    .select("*")
    .eq("id", id)
    .single();

  if (postErr || !post) {
    if (postErr) console.error("[GET /api/posts/[id]]", postErr.message);
    return NextResponse.json(
      { error: "게시글을 찾을 수 없습니다." },
      { status: 404 }
    );
  }

  const { data: authorProfile } = await supabase
    .from("profiles")
    .select("nickname, role")
    .eq("user_id", post.user_id)
    .single();

  const { data: comments } = await supabase
    .from("comments")
    .select("*")
    .eq("post_id", id)
    .eq("is_hidden", false)
    .order("created_at", { ascending: true });

  const commentUserIds = [
    ...new Set((comments ?? []).map((c) => c.user_id as string)),
  ];
  const commentProfileMap = new Map<string, { nickname: string }>();

  if (commentUserIds.length > 0) {
    const { data: commentProfiles } = await supabase
      .from("profiles")
      .select("user_id, nickname")
      .in("user_id", commentUserIds);

    for (const p of commentProfiles ?? []) {
      commentProfileMap.set(p.user_id, { nickname: p.nickname });
    }
  }

  const enrichedComments = (comments ?? []).map((c) => ({
    ...c,
    profiles: commentProfileMap.get(c.user_id as string) ?? null,
  }));

  return NextResponse.json({
    post: { ...post, profiles: authorProfile ?? null },
    comments: enrichedComments,
  });
}

/** PATCH /api/posts/[id] — 게시글 수정 (본인 + free/bodycheck만) */
export async function PATCH(request: Request, { params }: RouteCtx) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const { data: post } = await supabase
    .from("posts")
    .select("user_id, type")
    .eq("id", id)
    .single();

  if (!post) {
    return NextResponse.json({ error: "게시글을 찾을 수 없습니다." }, { status: 404 });
  }

  if (post.user_id !== user.id) {
    return NextResponse.json({ error: "본인의 글만 수정할 수 있습니다." }, { status: 403 });
  }

  if (!["free", "bodycheck"].includes(post.type)) {
    return NextResponse.json(
      { error: "기록 공유 글은 수정할 수 없습니다." },
      { status: 400 }
    );
  }

  const body = await request.json();
  const { title, content, images } = body;

  if (title !== undefined && !title.trim()) {
    return NextResponse.json({ error: "제목을 입력해주세요." }, { status: 400 });
  }

  if (
    (title && containsProfanity(title)) ||
    (content && containsProfanity(content))
  ) {
    return NextResponse.json({ error: "부적절한 표현이 포함되어 있습니다." }, { status: 400 });
  }

  const updateData: Record<string, unknown> = {};
  if (title !== undefined) updateData.title = title.trim();
  if (content !== undefined) updateData.content = content.trim() || null;
  if (images !== undefined) {
    updateData.images = Array.isArray(images)
      ? images
          .filter((u: unknown) => typeof u === "string" && u.startsWith("http"))
          .slice(0, 3)
      : [];
  }

  const { error } = await supabase
    .from("posts")
    .update(updateData)
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) {
    console.error("[PATCH /api/posts/[id]]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

/** DELETE /api/posts/[id] — soft delete + 삭제 로그 */
export async function DELETE(_request: Request, { params }: RouteCtx) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const { data: post } = await supabase
    .from("posts")
    .select("*")
    .eq("id", id)
    .single();

  if (!post) {
    return NextResponse.json({ error: "게시글을 찾을 수 없습니다." }, { status: 404 });
  }

  if (post.user_id !== user.id) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("user_id", user.id)
      .single();

    if (profile?.role !== "admin") {
      return NextResponse.json({ error: "본인의 글만 삭제할 수 있습니다." }, { status: 403 });
    }
  }

  // 삭제 로그
  const { error: logErr } = await supabase.from("deleted_logs").insert({
    post_id: post.id,
    user_id: user.id,
    title_snapshot: post.title,
    content_snapshot: post.content,
    payload_snapshot: post.payload_json,
  });

  if (logErr) {
    console.error("[DELETE /api/posts/[id]] log error:", logErr.message);
  }

  // soft delete
  const { error } = await supabase
    .from("posts")
    .update({
      is_deleted: true,
      deleted_at: new Date().toISOString(),
      deleted_by: user.id,
    })
    .eq("id", id);

  if (error) {
    console.error("[DELETE /api/posts/[id]]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
