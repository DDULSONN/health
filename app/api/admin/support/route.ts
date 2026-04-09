import { NextResponse } from "next/server";
import { isAllowedAdminUser } from "@/lib/admin";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";

function json(status: number, payload: Record<string, unknown>) {
  return NextResponse.json(payload, { status });
}

export async function GET(req: Request) {
  const requestId = crypto.randomUUID();

  try {
    const { user } = await getRequestAuthContext(req);
    if (!user) {
      return json(401, { ok: false, requestId, error: "로그인이 필요합니다." });
    }
    if (!isAllowedAdminUser(user.id, user.email)) {
      return json(403, { ok: false, requestId, error: "관리자만 접근할 수 있습니다." });
    }

    const { searchParams } = new URL(req.url);
    const statusFilter = (searchParams.get("status") ?? "").trim();

    const admin = createAdminClient();
    let query = admin
      .from("support_inquiries")
      .select("id,user_id,category,subject,message,contact_email,contact_phone,status,admin_reply,created_at,answered_at")
      .order("created_at", { ascending: false })
      .limit(100);

    if (statusFilter) {
      query = query.eq("status", statusFilter);
    }

    const ticketsRes = await query;
    if (ticketsRes.error) {
      console.error("[GET /api/admin/support] failed", ticketsRes.error);
      return json(500, { ok: false, requestId, error: "문의 목록을 불러오지 못했습니다." });
    }

    const userIds = [...new Set((ticketsRes.data ?? []).map((row) => String(row.user_id ?? "")).filter(Boolean))];
    const profilesRes =
      userIds.length > 0
        ? await admin.from("profiles").select("user_id,nickname").in("user_id", userIds)
        : { data: [], error: null };

    if (profilesRes.error) {
      console.error("[GET /api/admin/support] profiles failed", profilesRes.error);
      return json(500, { ok: false, requestId, error: "문의 목록을 불러오지 못했습니다." });
    }

    const profileMap = new Map((profilesRes.data ?? []).map((row) => [String(row.user_id), row.nickname]));
    const items = (ticketsRes.data ?? []).map((row) => ({
      ...row,
      nickname: profileMap.get(String(row.user_id ?? "")) ?? null,
    }));

    return json(200, { ok: true, requestId, items });
  } catch (error) {
    console.error("[GET /api/admin/support] unhandled", error);
    return json(500, { ok: false, requestId, error: "문의 목록을 불러오지 못했습니다." });
  }
}

export async function PATCH(req: Request) {
  const requestId = crypto.randomUUID();

  try {
    const { user } = await getRequestAuthContext(req);
    if (!user) {
      return json(401, { ok: false, requestId, error: "로그인이 필요합니다." });
    }
    if (!isAllowedAdminUser(user.id, user.email)) {
      return json(403, { ok: false, requestId, error: "관리자만 접근할 수 있습니다." });
    }

    const body = (await req.json().catch(() => null)) as
      | {
          id?: string;
          status?: "open" | "answered" | "closed";
          admin_reply?: string;
        }
      | null;

    const id = String(body?.id ?? "").trim();
    const status = String(body?.status ?? "").trim();
    const adminReply = String(body?.admin_reply ?? "").trim().slice(0, 4000);

    if (!id) {
      return json(400, { ok: false, requestId, error: "문의 ID가 필요합니다." });
    }
    if (!["open", "answered", "closed"].includes(status)) {
      return json(400, { ok: false, requestId, error: "문의 상태가 올바르지 않습니다." });
    }

    const admin = createAdminClient();
    const updateRes = await admin
      .from("support_inquiries")
      .update({
        status,
        admin_reply: adminReply || null,
        answered_at: status === "answered" || status === "closed" ? new Date().toISOString() : null,
        answered_by_user_id: status === "answered" || status === "closed" ? user.id : null,
      })
      .eq("id", id)
      .select("id,user_id,category,subject,message,contact_email,contact_phone,status,admin_reply,created_at,answered_at")
      .single();

    if (updateRes.error) {
      console.error("[PATCH /api/admin/support] failed", updateRes.error);
      return json(500, { ok: false, requestId, error: "문의 답변 저장에 실패했습니다." });
    }

    return json(200, { ok: true, requestId, item: updateRes.data });
  } catch (error) {
    console.error("[PATCH /api/admin/support] unhandled", error);
    return json(500, { ok: false, requestId, error: "문의 답변 저장에 실패했습니다." });
  }
}
