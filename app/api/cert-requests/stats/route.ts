import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

export async function GET() {
  const adminClient = createAdminClient();

  const { count, error } = await adminClient
    .from("user_cert_summary")
    .select("user_id", { head: true, count: "exact" });

  if (error) {
    console.error("[GET /api/cert-requests/stats] failed", error);
    return NextResponse.json({ error: "인증 통계를 불러오지 못했습니다." }, { status: 500 });
  }

  return NextResponse.json({
    approved_total_count: count ?? 0,
  });
}
