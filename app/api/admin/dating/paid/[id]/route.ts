import { isAdminEmail } from "@/lib/admin";
import { ensureAllowedMutationOrigin } from "@/lib/request-origin";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

function parseAdminUserIds() {
  return (process.env.ADMIN_USER_IDS ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function isAllowedAdmin(userId: string, email?: string | null) {
  const allowlist = parseAdminUserIds();
  if (allowlist.length > 0) {
    return allowlist.includes(userId);
  }
  return isAdminEmail(email);
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const originResponse = ensureAllowedMutationOrigin(req);
  if (originResponse) return originResponse;

  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ ok: false, error: "로그인이 필요합니다." }, { status: 401 });
  }
  if (!isAllowedAdmin(user.id, user.email)) {
    return NextResponse.json({ ok: false, error: "권한이 없습니다." }, { status: 403 });
  }

  const body = ((await req.json().catch(() => null)) ?? {}) as { gender?: unknown };
  const gender = body.gender === "M" || body.gender === "F" ? body.gender : "";
  if (!gender) {
    return NextResponse.json({ ok: false, error: "성별을 남자 또는 여자로 선택해 주세요." }, { status: 400 });
  }

  const admin = createAdminClient();
  const updateRes = await admin
    .from("dating_paid_cards")
    .update({ gender })
    .eq("id", id)
    .eq("status", "pending")
    .select("id,gender,status")
    .maybeSingle();

  if (updateRes.error) {
    console.error("[PATCH /api/admin/dating/paid/[id]] failed", updateRes.error);
    return NextResponse.json({ ok: false, error: "성별 수정에 실패했습니다." }, { status: 500 });
  }
  if (!updateRes.data?.id) {
    return NextResponse.json(
      { ok: false, error: "승인 대기 중인 카드만 성별을 수정할 수 있습니다." },
      { status: 409 }
    );
  }

  return NextResponse.json({ ok: true, item: updateRes.data });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  if (!isAllowedAdmin(user.id, user.email)) {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data: row, error: rowError } = await admin
    .from("dating_paid_cards")
    .select("id")
    .eq("id", id)
    .single();
  if (rowError || !row) {
    return NextResponse.json({ error: "대상을 찾을 수 없습니다." }, { status: 404 });
  }

  const { error: deleteError } = await admin.from("dating_paid_cards").delete().eq("id", id);
  if (deleteError) {
    console.error("[DELETE /api/admin/dating/paid/[id]] failed", deleteError);
    return NextResponse.json({ error: "삭제에 실패했습니다." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, deleted: true, id });
}

