import { NextResponse } from "next/server";
import { requireAdminRoute } from "@/lib/admin-route";

type RouteCtx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: RouteCtx) {
  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    is_banned?: boolean;
    reason?: string | null;
  };

  if (typeof body.is_banned !== "boolean") {
    return NextResponse.json({ error: "밴 상태 값이 필요합니다." }, { status: 400 });
  }

  const patch = {
    is_banned: body.is_banned,
    banned_reason: body.is_banned ? body.reason?.trim() || "커뮤니티 운영 정책 위반" : null,
    banned_at: body.is_banned ? new Date().toISOString() : null,
  };

  const { error } = await auth.admin.from("profiles").update(patch).eq("user_id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, user_id: id, ...patch });
}
