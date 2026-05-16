import { NextResponse } from "next/server";
import { requireAdminRoute } from "@/lib/admin-route";
import { ensureAllowedMutationOrigin } from "@/lib/request-origin";

type RouteCtx = { params: Promise<{ id: string }> };

export async function DELETE(request: Request, { params }: RouteCtx) {
  const originError = ensureAllowedMutationOrigin(request);
  if (originError) return originError;

  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const { data: entry, error: entryError } = await auth.admin
    .from("community_fit_room_entries")
    .select("id,user_id,image_path,deleted_at")
    .eq("id", id)
    .maybeSingle();

  if (entryError || !entry) {
    return NextResponse.json({ error: "인증 사진을 찾지 못했습니다." }, { status: 404 });
  }

  if (!entry.deleted_at) {
    const { error } = await auth.admin
      .from("community_fit_room_entries")
      .update({
        deleted_at: new Date().toISOString(),
        deleted_by_user_id: auth.user.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) {
      console.error("[DELETE /api/community/fit-room/[id]] failed", error);
      return NextResponse.json({ error: "삭제 처리에 실패했습니다." }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}
