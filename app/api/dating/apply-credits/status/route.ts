import { getDailyBaseApplyLimit, getKstDateString, isKoreanWeekend } from "@/lib/dating-apply-limits";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { NextResponse } from "next/server";

function json(status: number, payload: Record<string, unknown>) {
  return NextResponse.json(payload, { status });
}

export async function GET(req: Request) {
  const requestId = crypto.randomUUID();
  const baseLimit = getDailyBaseApplyLimit();

  try {
    const { client: supabase, user } = await getRequestAuthContext(req);
    if (!user) {
      return json(200, {
        ok: true,
        code: "UNAUTHORIZED",
        requestId,
        loggedIn: false,
        baseLimit,
        weekendBenefitActive: isKoreanWeekend(),
        baseUsed: 0,
        baseRemaining: 0,
        creditsRemaining: 0,
      });
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
      return json(500, { ok: false, code: "READ_FAILED", requestId, message: "지원권 사용 현황을 불러오지 못했습니다." });
    }

    if (creditsRes.error) {
      console.error(`[apply-credits-status] ${requestId} credits read error`, creditsRes.error);
      return json(500, { ok: false, code: "READ_FAILED", requestId, message: "추가 지원권을 불러오지 못했습니다." });
    }

    const baseUsed = Math.max(0, Math.min(baseLimit, Number(usageRes.data?.base_used ?? 0)));
    const creditsRemaining = Math.max(0, Number(creditsRes.data?.credits ?? 0));
    const baseRemaining = Math.max(0, baseLimit - baseUsed);

    return json(200, {
      ok: true,
      code: "SUCCESS",
      requestId,
      loggedIn: true,
      kstDate,
      baseLimit,
      weekendBenefitActive: isKoreanWeekend(),
      baseUsed,
      baseRemaining,
      creditsRemaining,
    });
  } catch (error) {
    console.error(`[apply-credits-status] ${requestId} unhandled`, error);
    return json(500, { ok: false, code: "INTERNAL_SERVER_ERROR", requestId, message: "서버 오류가 발생했습니다." });
  }
}
