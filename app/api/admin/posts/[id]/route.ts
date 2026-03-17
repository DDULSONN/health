import { NextResponse } from "next/server";
import { requireAdminRoute } from "@/lib/admin-route";

type RouteCtx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: RouteCtx) {
  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    is_hidden?: boolean;
    is_deleted?: boolean;
    resolve_reports?: boolean;
  };

  const { data: post, error: postError } = await auth.admin
    .from("posts")
    .select("id,user_id,title,content,payload_json,is_hidden,is_deleted")
    .eq("id", id)
    .maybeSingle();

  if (postError || !post) {
    return NextResponse.json({ error: "게시글을 찾을 수 없습니다." }, { status: 404 });
  }

  const patch: Record<string, unknown> = {};
  if (typeof body.is_hidden === "boolean") patch.is_hidden = body.is_hidden;
  if (body.is_deleted === true && !post.is_deleted) {
    patch.is_deleted = true;
    patch.deleted_at = new Date().toISOString();
    patch.deleted_by = auth.user.id;
  }

  if (Object.keys(patch).length > 0) {
    if (patch.is_deleted === true) {
      const { error: logError } = await auth.admin.from("deleted_logs").insert({
        post_id: post.id,
        user_id: auth.user.id,
        title_snapshot: post.title,
        content_snapshot: post.content,
        payload_snapshot: post.payload_json,
      });
      if (logError) {
        console.error("[PATCH /api/admin/posts/[id]] delete log error", logError.message);
      }
    }

    const { error } = await auth.admin.from("posts").update(patch).eq("id", id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  if (body.resolve_reports) {
    const { error: reportError } = await auth.admin
      .from("reports")
      .update({ resolved: true })
      .eq("target_type", "post")
      .eq("target_id", id)
      .eq("resolved", false);

    if (reportError) {
      return NextResponse.json({ error: reportError.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}
