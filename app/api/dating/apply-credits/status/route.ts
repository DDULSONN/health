import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

function json(status: number, payload: Record<string, unknown>) {
  return NextResponse.json(payload, { status });
}

function getKstDateString(now = new Date()): string {
  const kstMs = now.getTime() + 9 * 60 * 60 * 1000;
  return new Date(kstMs).toISOString().slice(0, 10);
}

export async function GET() {
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

    const kstDate = getKstDateString();

    const [usageRes, creditsRes] = await Promise.all([
      supabase
        .from("user_daily_apply_usage")
        .select("base_used")
        .eq("user_id", user.id)
        .eq("kst_date", kstDate)
        .maybeSingle(),
      supabase.from("user_apply_credits").select("credits").eq("user_id", user.id).maybeSingle(),
    ]);

    if (usageRes.error) {
      console.error(`[apply-credits-status] ${requestId} usage read error`, usageRes.error);
      return json(500, { ok: false, code: "READ_FAILED", requestId, message: "사용량 조회에 실패했습니다." });
    }
    if (creditsRes.error) {
      console.error(`[apply-credits-status] ${requestId} credits read error`, creditsRes.error);
      return json(500, { ok: false, code: "READ_FAILED", requestId, message: "크레딧 조회에 실패했습니다." });
    }

    const baseUsed = Math.max(0, Math.min(2, Number(usageRes.data?.base_used ?? 0)));
    const creditsRemaining = Math.max(0, Number(creditsRes.data?.credits ?? 0));
    const baseRemaining = Math.max(0, 2 - baseUsed);

    return json(200, {
      ok: true,
      code: "SUCCESS",
      requestId,
      kstDate,
      baseUsed,
      baseRemaining,
      creditsRemaining,
    });
  } catch (error) {
    console.error(`[apply-credits-status] ${requestId} unhandled`, error);
    return json(500, { ok: false, code: "INTERNAL_SERVER_ERROR", requestId, message: "서버 오류가 발생했습니다." });
  }
}
