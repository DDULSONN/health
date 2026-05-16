import { NextResponse } from "next/server";
import { requireAdminRoute } from "@/lib/admin-route";
import { ensureAllowedMutationOrigin } from "@/lib/request-origin";

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteCtx) {
  const originError = ensureAllowedMutationOrigin(request);
  if (originError) return originError;

  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { reaction?: unknown };
  const reaction = body.reaction === "up" || body.reaction === "down" ? body.reaction : "none";

  const { data: entry, error: entryError } = await auth.admin
    .from("community_fit_room_entries")
    .select("id,expires_at,deleted_at")
    .eq("id", id)
    .maybeSingle();

  if (entryError || !entry || entry.deleted_at || Date.parse(entry.expires_at) <= Date.now()) {
    return NextResponse.json({ error: "반응할 수 없는 인증입니다." }, { status: 404 });
  }

  if (reaction === "none") {
    const { error } = await auth.admin
      .from("community_fit_room_reactions")
      .delete()
      .eq("entry_id", id)
      .eq("user_id", auth.user.id);
    if (error) {
      console.error("[POST /api/community/fit-room/[id]/reaction] delete failed", error);
      return NextResponse.json({ error: "반응 취소에 실패했습니다." }, { status: 500 });
    }
    return NextResponse.json({ ok: true, reaction: null });
  }

  const { error } = await auth.admin.from("community_fit_room_reactions").upsert(
    {
      entry_id: id,
      user_id: auth.user.id,
      reaction,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "entry_id,user_id" }
  );

  if (error) {
    console.error("[POST /api/community/fit-room/[id]/reaction] upsert failed", error);
    return NextResponse.json({ error: "반응 저장에 실패했습니다." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, reaction });
}
