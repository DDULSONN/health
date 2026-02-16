import { isAdminEmail } from "@/lib/admin";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: "권한 없음" }, { status: 403 });
  }

  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? "";
  const sex = url.searchParams.get("sex") ?? "";
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1"));
  const limit = 20;
  const offset = (page - 1) * limit;

  const adminClient = createAdminClient();
  let query = adminClient
    .from("dating_applications")
    .select("id, sex, name, phone, region, height_cm, job, status, created_at, display_nickname, age, training_years, approved_for_public", { count: "exact" });

  if (status) query = query.eq("status", status);
  if (sex) query = query.eq("sex", sex);

  const approvedFilter = url.searchParams.get("approved");
  if (approvedFilter === "true") query = query.eq("approved_for_public", true);
  else if (approvedFilter === "false") query = query.eq("approved_for_public", false);

  query = query.order("created_at", { ascending: false }).range(offset, offset + limit - 1);

  const { data, count, error } = await query;

  if (error) {
    console.error("[GET /api/admin/dating]", error.message);
    return NextResponse.json({ error: "조회 실패" }, { status: 500 });
  }

  // 전화번호 마스킹
  const masked = (data ?? []).map((row) => ({
    ...row,
    phone_masked: maskPhone(row.phone),
  }));

  return NextResponse.json({ data: masked, total: count ?? 0, page, limit });
}

function maskPhone(phone: string): string {
  if (phone.length < 7) return phone;
  return phone.slice(0, 3) + "****" + phone.slice(-4);
}
