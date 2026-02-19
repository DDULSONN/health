import { isAdminEmail } from "@/lib/admin";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

function json(status: number, payload: Record<string, unknown>) {
  return NextResponse.json(payload, { status });
}

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

type ProfileRow = {
  user_id: string;
  nickname: string | null;
};

export async function GET(req: Request) {
  const requestId = crypto.randomUUID();

  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return json(401, { ok: false, code: "UNAUTHORIZED", requestId, message: "로그인이 필요합니다." });
    }
    if (!isAllowedAdmin(user.id, user.email)) {
      return json(403, { ok: false, code: "FORBIDDEN", requestId, message: "권한이 없습니다." });
    }

    const { searchParams } = new URL(req.url);
    const status = (searchParams.get("status") ?? "pending").trim();
    const limit = Math.max(1, Math.min(200, Number(searchParams.get("limit") ?? 50)));

    const admin = createAdminClient();
    let query = admin
      .from("apply_credit_orders")
      .select("id,user_id,pack_size,amount,status,created_at,processed_at,memo")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (status === "pending" || status === "approved" || status === "rejected") {
      query = query.eq("status", status);
    }

    const ordersRes = await query;
    if (ordersRes.error) {
      console.error(`[admin-apply-credits-orders] ${requestId} orders query error`, ordersRes.error);
      return json(500, { ok: false, code: "LIST_FAILED", requestId, message: "주문 목록을 불러오지 못했습니다." });
    }

    const orders = ordersRes.data ?? [];
    const userIds = [...new Set(orders.map((row) => row.user_id).filter(Boolean))];
    let profileMap = new Map<string, string | null>();

    if (userIds.length > 0) {
      const profilesRes = await admin.from("profiles").select("user_id,nickname").in("user_id", userIds);
      if (profilesRes.error) {
        console.error(`[admin-apply-credits-orders] ${requestId} profiles query error`, profilesRes.error);
      } else {
        for (const row of (profilesRes.data ?? []) as ProfileRow[]) {
          profileMap.set(row.user_id, row.nickname ?? null);
        }
      }
    }

    return json(200, {
      ok: true,
      requestId,
      items: orders.map((row) => ({
        ...row,
        nickname: profileMap.get(row.user_id) ?? null,
      })),
    });
  } catch (error) {
    console.error(`[admin-apply-credits-orders] ${requestId} unhandled`, error);
    return json(500, { ok: false, code: "INTERNAL_SERVER_ERROR", requestId, message: "서버 오류가 발생했습니다." });
  }
}
