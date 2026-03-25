import { NextResponse } from "next/server";
import { requireAdminRoute } from "@/lib/admin-route";

type AuditRow = {
  id: string;
  auth_user_id: string;
  nickname: string | null;
  email_masked: string | null;
  ip_address: string | null;
  user_agent: string | null;
  deletion_mode: "hard" | "soft";
  initiated_by_role: "self" | "admin";
  deleted_at: string;
  retention_until: string;
};

export async function GET() {
  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;

  const res = await auth.admin
    .from("account_deletion_audits")
    .select("id,auth_user_id,nickname,email_masked,ip_address,user_agent,deletion_mode,initiated_by_role,deleted_at,retention_until")
    .order("deleted_at", { ascending: false })
    .limit(100);

  if (res.error) {
    console.error("[GET /api/admin/account-deletion-audits] failed", res.error);
    return NextResponse.json({ error: "탈퇴 감사기록을 불러오지 못했습니다." }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    items: (res.data ?? []) as AuditRow[],
  });
}
