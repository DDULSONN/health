import { isAdminEmail } from "@/lib/admin";
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
  if (allowlist.length > 0) return allowlist.includes(userId);
  return isAdminEmail(email);
}

function isMissingColumnError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: string; message?: string };
  const code = String(e.code ?? "");
  const message = String(e.message ?? "").toLowerCase();
  return code === "42703" || code === "PGRST204" || message.includes("column");
}

export async function GET(req: Request) {
  const requestId = crypto.randomUUID();

  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ ok: false, code: "UNAUTHORIZED", requestId, message: "로그인이 필요합니다." }, { status: 401 });
    }
    if (!isAllowedAdmin(user.id, user.email)) {
      return NextResponse.json({ ok: false, code: "FORBIDDEN", requestId, message: "권한이 없습니다." }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const status = (searchParams.get("status") ?? "pending").trim();

    const admin = createAdminClient();
    let query = admin
      .from("dating_more_view_requests")
      .select("id,user_id,sex,status,note,created_at,reviewed_at,reviewed_by_user_id,access_expires_at")
      .order("created_at", { ascending: false })
      .limit(200);

    if (status === "pending" || status === "approved" || status === "rejected") {
      query = query.eq("status", status);
    }

    let rowsRes: any = await query;
    if (rowsRes.error && isMissingColumnError(rowsRes.error)) {
      let legacyQuery = admin
        .from("dating_more_view_requests")
        .select("id,user_id,sex,status,note,created_at,reviewed_at,reviewed_by_user_id")
        .order("created_at", { ascending: false })
        .limit(200);
      if (status === "pending" || status === "approved" || status === "rejected") {
        legacyQuery = legacyQuery.eq("status", status);
      }
      rowsRes = await legacyQuery;
    }
    if (rowsRes.error) {
      console.error(`[admin-more-view-list] ${requestId} query failed`, rowsRes.error);
      return NextResponse.json({ ok: false, code: "LIST_FAILED", requestId, message: "목록 조회에 실패했습니다." }, { status: 500 });
    }

    const rows: Array<Record<string, unknown>> = Array.isArray(rowsRes.data) ? rowsRes.data : [];
    const userIds = [
      ...new Set(
        rows
          .map((row) => (typeof row.user_id === "string" ? row.user_id : ""))
          .filter((value) => value.length > 0)
      ),
    ];
    const profileMap = new Map<string, string | null>();

    if (userIds.length > 0) {
      const profileRes = await admin.from("profiles").select("user_id,nickname").in("user_id", userIds);
      if (!profileRes.error && Array.isArray(profileRes.data)) {
        for (const row of profileRes.data as Array<{ user_id: string; nickname: string | null }>) {
          profileMap.set(row.user_id, row.nickname ?? null);
        }
      }
    }

    return NextResponse.json({
      ok: true,
      requestId,
      items: rows.map((row) => {
        const userId = typeof row.user_id === "string" ? row.user_id : "";
        return {
          ...row,
          nickname: userId ? profileMap.get(userId) ?? null : null,
        };
      }),
    });
  } catch (error) {
    console.error(`[admin-more-view-list] ${requestId} unhandled`, error);
    return NextResponse.json({ ok: false, code: "INTERNAL_SERVER_ERROR", requestId, message: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
