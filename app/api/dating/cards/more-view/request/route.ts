import { getActiveMoreViewGrant, normalizeCardSex } from "@/lib/dating-more-view";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

type Body = { sex?: unknown };

function json(status: number, payload: Record<string, unknown>) {
  return NextResponse.json(payload, { status });
}

export async function POST(req: Request) {
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

    const body = ((await req.json().catch(() => null)) ?? {}) as Body;
    const sex = normalizeCardSex(body.sex);
    if (!sex) {
      return json(400, { ok: false, code: "VALIDATION_ERROR", requestId, message: "sex 값이 올바르지 않습니다." });
    }

    const admin = createAdminClient();

    const activeGrant = await getActiveMoreViewGrant(admin, user.id, sex);
    if (activeGrant) {
      return json(200, { ok: true, code: "ALREADY_APPROVED", requestId, sex, status: "approved" });
    }

    const pendingRes = await admin
      .from("dating_more_view_requests")
      .select("id")
      .eq("user_id", user.id)
      .eq("sex", sex)
      .eq("status", "pending")
      .limit(1)
      .maybeSingle();

    if (pendingRes.data) {
      return json(200, { ok: true, code: "ALREADY_PENDING", requestId, sex, status: "pending" });
    }

    const insertRes = await admin
      .from("dating_more_view_requests")
      .insert({
        user_id: user.id,
        sex,
        status: "pending",
      })
      .select("id")
      .single();

    if (insertRes.error || !insertRes.data) {
      console.error(`[more-view-request] ${requestId} insert error`, insertRes.error);
      return json(500, { ok: false, code: "CREATE_REQUEST_FAILED", requestId, message: "신청 생성에 실패했습니다." });
    }

    return json(200, {
      ok: true,
      code: "SUCCESS",
      requestId,
      requestRowId: insertRes.data.id,
      sex,
      status: "pending",
      message: "신청이 접수되었습니다.",
    });
  } catch (error) {
    console.error(`[more-view-request] ${requestId} unhandled`, error);
    return json(500, { ok: false, code: "INTERNAL_SERVER_ERROR", requestId, message: "서버 오류가 발생했습니다." });
  }
}
