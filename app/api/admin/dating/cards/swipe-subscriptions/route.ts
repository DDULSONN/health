import { isAdminEmail } from "@/lib/admin";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

function parseAdminUserIds() {
  return (process.env.ADMIN_USER_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function isAllowedAdmin(userId: string, email?: string | null) {
  const allowlist = parseAdminUserIds();
  if (allowlist.length > 0) return allowlist.includes(userId);
  return isAdminEmail(email);
}

function isMissingRelationError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = String((error as { code?: unknown }).code ?? "");
  const message = String((error as { message?: unknown }).message ?? "").toLowerCase();
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    message.includes("does not exist") ||
    message.includes("relation") ||
    message.includes("could not find the table")
  );
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
      return NextResponse.json({ ok: false, requestId, message: "로그인이 필요합니다." }, { status: 401 });
    }
    if (!isAllowedAdmin(user.id, user.email)) {
      return NextResponse.json({ ok: false, requestId, message: "권한이 없습니다." }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const status = (searchParams.get("status") ?? "pending").trim();

    const admin = createAdminClient();
    let query = admin
      .from("dating_swipe_subscription_requests")
      .select("id,user_id,status,amount,daily_limit,duration_days,note,requested_at,approved_at,expires_at,reviewed_at")
      .order("requested_at", { ascending: false })
      .limit(200);

    if (status === "pending" || status === "approved" || status === "rejected" || status === "expired") {
      query = query.eq("status", status);
    }

    const rowsRes = await query;
    if (rowsRes.error) {
      if (isMissingRelationError(rowsRes.error)) {
        return NextResponse.json({ ok: true, requestId, items: [] });
      }
      console.error("[admin-swipe-subscription-list] query failed", rowsRes.error);
      return NextResponse.json({ ok: false, requestId, message: "빠른매칭 라이크 구매 목록을 불러오지 못했습니다." }, { status: 500 });
    }

    const rows = rowsRes.data ?? [];
    const userIds = Array.from(
      new Set(
        rows
          .map((row) => (typeof row.user_id === "string" ? row.user_id : ""))
          .filter((value) => value.length > 0)
      )
    );
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
      items: rows.map((row) => ({
        ...row,
        nickname: typeof row.user_id === "string" ? profileMap.get(row.user_id) ?? null : null,
      })),
    });
  } catch (error) {
    console.error("[admin-swipe-subscription-list] unhandled", error);
    return NextResponse.json({ ok: false, requestId, message: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
