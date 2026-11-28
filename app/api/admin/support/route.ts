import { NextResponse } from "next/server";
import { isAllowedAdminUser } from "@/lib/admin";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";
import { supportView } from "@/lib/support-triage";
import { ensureAllowedMutationOrigin } from "@/lib/request-origin";

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

    const admin = createAdminClient({ signal: AbortSignal.timeout(15000) });
    const view = searchParams.get("view") ?? "important";
    const offset = Math.max(0, Number.parseInt(searchParams.get("offset") ?? "0", 10) || 0);
    const rows = [];
    let nextOffset: number | null = null;
    for (let start = offset; ; start += 500) {
    let query = admin
      .from("support_inquiries")
      .select("id,user_id,category,subject,message,contact_email,contact_phone,status,admin_reply,created_at,answered_at,answered_by_user_id")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(start, start + 499);

    if (view === "important" || view === "pending") query = query.eq("status", "open");
    if (view === "auto") query = query.like("admin_reply", "[자동 안내]%").is("answered_by_user_id", null);

    if (statusFilter) {
      query = query.eq("status", statusFilter);
    }

    const ticketsRes = await query;
    if (ticketsRes.error) {
      console.error("[GET /api/admin/support] failed", ticketsRes.error);
      return json(500, { ok: false, requestId, error: "문의 목록을 불러오지 못했습니다." });
    }

    for (let index = 0; index < (ticketsRes.data ?? []).length; index++) {
      const row = ticketsRes.data![index];
      const triage = supportView(row);
      if (view === "important" && !triage.needs_attention) continue;
      if (view === "pending" && (triage.needs_attention || triage.kind !== "simple")) continue;
      rows.push({ ...row, triage });
      if (rows.length >= 100) { nextOffset = start + index + 1; break; }
    }
    if (nextOffset !== null || (ticketsRes.data?.length ?? 0) < 500) break;
    }

    const userIds = [...new Set(rows.map((row) => String(row.user_id ?? "")).filter(Boolean))];
    const profilesRes =
      userIds.length > 0
        ? await admin.from("profiles").select("user_id,nickname").in("user_id", userIds)
        : { data: [], error: null };

    if (profilesRes.error) {
      console.error("[GET /api/admin/support] profiles failed", profilesRes.error);
      return json(500, { ok: false, requestId, error: "문의 목록을 불러오지 못했습니다." });
    }

    const profileMap = new Map((profilesRes.data ?? []).map((row) => [String(row.user_id), row.nickname]));
    const items = rows.map((row) => ({
      ...row,
      nickname: profileMap.get(String(row.user_id ?? "")) ?? null,
    }));

    return json(200, { ok: true, requestId, items, nextOffset });
  } catch (error) {
    console.error("[GET /api/admin/support] unhandled", error);
    return json(500, { ok: false, requestId, error: "문의 목록을 불러오지 못했습니다." });
  }
}

export async function PATCH(req: Request) {
  const requestId = crypto.randomUUID();
  const originResponse = ensureAllowedMutationOrigin(req);
  if (originResponse) return originResponse;

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
          expected_reply?: string | null;
          expected_status?: string;
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
    if (status === "answered" && !adminReply) return json(400, { ok: false, error: "답변 내용을 입력해 주세요." });
    if (!body?.expected_status || !("expected_reply" in body)) return json(409, { ok: false, error: "목록을 새로고침한 뒤 다시 저장해 주세요." });

    const admin = createAdminClient();
    let update = admin
      .from("support_inquiries")
      .update({
        status,
        admin_reply: adminReply || null,
        answered_at: status === "answered" || status === "closed" ? new Date().toISOString() : null,
        // An explicit reopen remains under operator control; cron cannot reclaim it.
        answered_by_user_id: user.id,
      })
      .eq("id", id)
      .eq("status", body.expected_status);
    update = body.expected_reply === null ? update.is("admin_reply", null) : update.eq("admin_reply", body.expected_reply);
    const updateRes = await update
      .select("id,user_id,category,subject,message,contact_email,contact_phone,status,admin_reply,created_at,answered_at")
      .maybeSingle();

    if (updateRes.error) {
      console.error("[PATCH /api/admin/support] failed", updateRes.error);
      return json(500, { ok: false, requestId, error: "문의 답변 저장에 실패했습니다." });
    }
    if (!updateRes.data) return json(409, { ok: false, error: "다른 답변이 먼저 저장되었습니다. 새로고침 후 확인해 주세요." });

    return json(200, { ok: true, requestId, item: updateRes.data });
  } catch (error) {
    console.error("[PATCH /api/admin/support] unhandled", error);
    return json(500, { ok: false, requestId, error: "문의 답변 저장에 실패했습니다." });
  }
}
