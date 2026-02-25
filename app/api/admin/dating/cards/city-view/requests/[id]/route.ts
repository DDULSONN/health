import { isAdminEmail } from "@/lib/admin";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

type Body = { status?: unknown; note?: unknown };

function parseAdminUserIds() {
  return (process.env.ADMIN_USER_IDS ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function isAllowedAdmin(userId: string, email?: string | null) {
  const allowlist = parseAdminUserIds();
  if (allowlist.length > 0) return allowlist.includes(userId);
  return isAdminEmail(email);
}

async function grantApplyCredit(admin: ReturnType<typeof createAdminClient>, userId: string) {
  const nowIso = new Date().toISOString();
  const creditRes = await admin
    .from("user_apply_credits")
    .select("credits")
    .eq("user_id", userId)
    .maybeSingle();

  if (creditRes.error) return false;

  if (!creditRes.data) {
    const insertRes = await admin.from("user_apply_credits").insert({ user_id: userId, credits: 1, updated_at: nowIso });
    return !insertRes.error;
  }

  const currentCredits = Number(creditRes.data.credits ?? 0);
  const updateRes = await admin
    .from("user_apply_credits")
    .update({ credits: Math.max(0, currentCredits) + 1, updated_at: nowIso })
    .eq("user_id", userId);
  return !updateRes.error;
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !isAllowedAdmin(user.id, user.email)) {
    return NextResponse.json({ ok: false, message: "권한이 없습니다." }, { status: 403 });
  }

  const { id } = await params;
  const body = ((await req.json().catch(() => null)) ?? {}) as Body;
  const status = body.status === "approved" || body.status === "rejected" ? body.status : null;
  if (!status) {
    return NextResponse.json({ ok: false, message: "status 값이 올바르지 않습니다." }, { status: 400 });
  }

  const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : null;
  const accessExpiresAt = status === "approved" ? new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString() : null;

  const admin = createAdminClient();
  const updateRes = await admin
    .from("dating_city_view_requests")
    .update({
      status,
      note,
      reviewed_at: new Date().toISOString(),
      reviewed_by_user_id: user.id,
      access_expires_at: accessExpiresAt,
    })
    .eq("id", id)
    .eq("status", "pending")
    .select("id,user_id,city,status")
    .maybeSingle();

  if (updateRes.error) {
    return NextResponse.json({ ok: false, message: "승인 처리에 실패했습니다." }, { status: 500 });
  }
  if (!updateRes.data) {
    return NextResponse.json({ ok: false, message: "대기중 요청만 처리할 수 있습니다." }, { status: 409 });
  }

  if (status === "approved") {
    const creditGranted = await grantApplyCredit(admin, updateRes.data.user_id);
    if (!creditGranted) {
      await admin
        .from("dating_city_view_requests")
        .update({
          status: "pending",
          access_expires_at: null,
        })
        .eq("id", id)
        .eq("status", "approved");

      return NextResponse.json({ ok: false, message: "지원권 지급에 실패했습니다." }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true, item: updateRes.data });
}
