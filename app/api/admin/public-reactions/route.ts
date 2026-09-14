import { NextResponse } from "next/server";
import { requireAdminRoute } from "@/lib/admin-route";
import { recordAdminAuditEvent } from "@/lib/admin-audit";
import { reactionErrorMessage } from "@/lib/public-reactions";
import { reactionConfiguration, reactionFailureCode, runPublicReactionScan } from "@/lib/public-reactions-server";

export const dynamic = "force-dynamic";
export const maxDuration = 180;
const headers = { "Cache-Control": "private, no-store" };
const columns = "run_date,status,attempt,started_at,completed_at,error_code";

export async function GET(request: Request) {
  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;
  const configuration = reactionConfiguration();
  const day = new URL(request.url).searchParams.get("day");
  if (day && !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return NextResponse.json({ error: "조회 날짜를 확인해 주세요." }, { status: 400, headers });
  }
  try {
    const recent = await auth.admin.from("admin_public_reaction_runs").select(columns)
      .order("run_date", { ascending: false }).limit(14);
    if (recent.error) throw recent.error;
    let query = auth.admin.from("admin_public_reaction_runs").select(`${columns},report`).eq("status", "success");
    if (day) query = query.eq("run_date", day);
    const result = await query.order("run_date", { ascending: false }).limit(1).maybeSingle();
    if (result.error) throw result.error;
    return NextResponse.json({ configuration, latestRun: recent.data?.[0] ?? null,
      history: recent.data ?? [], result: result.data ?? null }, { headers });
  } catch (error) {
    const code = reactionFailureCode(error);
    return NextResponse.json({ error: reactionErrorMessage(code), code, configuration }, { status: 503, headers });
  }
}

export async function POST(request: Request) {
  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;
  // Browser-only mutation; disallow cross-site requests and accidental GET scans.
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) {
    return NextResponse.json({ error: "요청 출처를 확인해 주세요." }, { status: 403, headers });
  }
  try {
    const result = await runPublicReactionScan(auth.admin, true);
    await recordAdminAuditEvent({ admin: auth.admin, adminUser: auth.user, request,
      action: "public_reactions_scan", targetType: "admin_public_reaction_runs", metadata: result });
    return NextResponse.json({ ok: true, ...result }, { headers });
  } catch (error) {
    const code = reactionFailureCode(error);
    return NextResponse.json({ error: reactionErrorMessage(code), code }, { status: 503, headers });
  }
}
