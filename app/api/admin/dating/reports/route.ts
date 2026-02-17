import { isAdminEmail } from "@/lib/admin";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const adminClient = createAdminClient();
  let query = adminClient
    .from("dating_card_reports")
    .select("id, card_id, reporter_user_id, reason, status, created_at")
    .order("created_at", { ascending: false })
    .limit(200);

  if (status === "open" || status === "resolved" || status === "dismissed") {
    query = query.eq("status", status);
  }

  const { data, error } = await query;
  if (error) {
    console.error("[GET /api/admin/dating/reports] failed", error);
    return NextResponse.json({ error: "신고 목록을 불러오지 못했습니다." }, { status: 500 });
  }

  return NextResponse.json({ items: data ?? [] });
}
