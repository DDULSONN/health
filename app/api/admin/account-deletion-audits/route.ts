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

const FULL_SELECT = "id,auth_user_id,nickname,email_masked,ip_address,user_agent,deletion_mode,initiated_by_role,deleted_at,retention_until";
const LEGACY_SELECT = "id,auth_user_id,nickname,email_masked,ip_address,user_agent,deletion_mode,deleted_at";

function isMissingSchemaError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = String((error as { code?: unknown }).code ?? "");
  const message = String((error as { message?: unknown }).message ?? "").toLowerCase();
  return code === "42P01" || code === "42703" || code === "PGRST204" || code === "PGRST205" || message.includes("does not exist");
}

function normalizeAuditRow(row: Record<string, unknown>): AuditRow {
  const deletedAt = typeof row.deleted_at === "string" ? row.deleted_at : new Date().toISOString();
  const fallbackRetentionUntil = new Date(new Date(deletedAt).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();

  return {
    id: String(row.id),
    auth_user_id: String(row.auth_user_id),
    nickname: typeof row.nickname === "string" ? row.nickname : null,
    email_masked: typeof row.email_masked === "string" ? row.email_masked : null,
    ip_address: typeof row.ip_address === "string" ? row.ip_address : null,
    user_agent: typeof row.user_agent === "string" ? row.user_agent : null,
    deletion_mode: row.deletion_mode === "soft" ? "soft" : "hard",
    initiated_by_role: row.initiated_by_role === "admin" ? "admin" : "self",
    deleted_at: deletedAt,
    retention_until: typeof row.retention_until === "string" ? row.retention_until : fallbackRetentionUntil,
  };
}

export async function GET() {
  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;

  const res = await auth.admin
    .from("account_deletion_audits")
    .select(FULL_SELECT)
    .order("deleted_at", { ascending: false })
    .limit(100);

  let rows = res.data as Record<string, unknown>[] | null;
  let fallbackUsed = false;

  if (res.error && isMissingSchemaError(res.error)) {
    const fallbackRes = await auth.admin
      .from("account_deletion_audits")
      .select(LEGACY_SELECT)
      .order("deleted_at", { ascending: false })
      .limit(100);

    if (fallbackRes.error && isMissingSchemaError(fallbackRes.error)) {
      return NextResponse.json(
        {
          ok: false,
          error: "탈퇴 기록 테이블이 아직 적용되지 않았습니다. Supabase SQL에서 account_deletion_audits 스키마를 먼저 적용해 주세요.",
          items: [],
        },
        { status: 500 }
      );
    }

    if (fallbackRes.error) {
      console.error("[GET /api/admin/account-deletion-audits] fallback failed", fallbackRes.error);
      return NextResponse.json({ ok: false, error: "탈퇴 기록을 불러오지 못했습니다.", items: [] }, { status: 500 });
    }

    rows = fallbackRes.data as Record<string, unknown>[] | null;
    fallbackUsed = true;
  } else if (res.error) {
    console.error("[GET /api/admin/account-deletion-audits] failed", res.error);
    return NextResponse.json({ ok: false, error: "탈퇴 기록을 불러오지 못했습니다.", items: [] }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    fallbackUsed,
    items: (rows ?? []).map(normalizeAuditRow),
  });
}
