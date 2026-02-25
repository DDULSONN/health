import { isAdminEmail } from "@/lib/admin";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

function parseAdminUserIds() {
  return (process.env.ADMIN_USER_IDS ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function isAllowedAdmin(userId: string, email?: string | null) {
  const allowlist = parseAdminUserIds();
  if (allowlist.length > 0) return allowlist.includes(userId);
  return isAdminEmail(email);
}

export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !isAllowedAdmin(user.id, user.email)) {
    return NextResponse.json({ ok: false, message: "권한이 없습니다." }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const statusParam = (searchParams.get("status") ?? "pending").trim();
  const status = statusParam === "approved" || statusParam === "rejected" || statusParam === "pending" ? statusParam : "pending";

  const admin = createAdminClient();
  const rowsRes = await admin
    .from("dating_city_view_requests")
    .select("id,user_id,city,status,note,created_at,reviewed_at")
    .eq("status", status)
    .order("created_at", { ascending: false })
    .limit(200);

  if (rowsRes.error) {
    return NextResponse.json({ ok: false, message: "목록 조회에 실패했습니다." }, { status: 500 });
  }

  const rows = Array.isArray(rowsRes.data) ? rowsRes.data : [];
  const userIds = [...new Set(rows.map((row) => row.user_id).filter(Boolean))];

  let nickByUser = new Map<string, string>();
  if (userIds.length > 0) {
    const profilesRes = await admin.from("profiles").select("user_id,nickname").in("user_id", userIds);
    if (Array.isArray(profilesRes.data)) {
      nickByUser = new Map(profilesRes.data.map((row) => [String(row.user_id), String(row.nickname ?? "")]));
    }
  }

  const items = rows.map((row) => ({
    ...row,
    nickname: nickByUser.get(String(row.user_id)) || null,
  }));

  return NextResponse.json({ ok: true, items });
}
