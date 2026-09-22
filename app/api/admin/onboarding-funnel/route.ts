import { NextResponse } from "next/server";
import { requireAdminRoute } from "@/lib/admin-route";
import { isFunnelSummary } from "@/lib/onboarding-funnel";

const reply = (body: unknown, status = 200) => NextResponse.json(body, {
  status, headers: { "Cache-Control": "private, no-store" },
});
export async function GET(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const guard = await requireAdminRoute();
    if (!guard.ok) return guard.response;
    const raw = new URL(request.url).searchParams.get("days") ?? "7";
    if (!["1", "7", "30"].includes(raw)) return reply({ error: "조회 기간을 확인해 주세요.", requestId }, 400);
    const { data, error } = await guard.admin.rpc("admin_onboarding_funnel_summary", { p_days: Number(raw) });
    if (error) {
      if (["42883", "42P01", "PGRST202", "PGRST205"].includes(String(error.code))) {
        return reply({ available: false, requestId });
      }
      return reply({ error: "가입·작성 현황을 불러오지 못했어요.", requestId }, 503);
    }
    if (!isFunnelSummary(data)) return reply({ error: "통계 응답을 확인하지 못했어요.", requestId }, 503);
    return reply({ available: true, summary: data, requestId });
  } catch {
    return reply({ error: "가입·작성 현황을 불러오지 못했어요.", requestId }, 503);
  }
}
