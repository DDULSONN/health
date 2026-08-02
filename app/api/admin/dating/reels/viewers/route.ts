import { isAllowedAdminUser } from "@/lib/admin";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function escapeIlikeTerm(value: string) {
  return value.trim().replace(/[,%]/g, " ").replace(/\\/g, "\\\\").replace(/_/g, "\\_");
}

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return isAllowedAdminUser(user?.id, user?.email);
}

export async function GET(req: Request) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  }

  const query = new URL(req.url).searchParams.get("query")?.trim() ?? "";
  if (query.length < 2) {
    return NextResponse.json({ error: "닉네임을 2글자 이상 입력해 주세요." }, { status: 400 });
  }

  const admin = createAdminClient();
  const profileRes = await admin
    .from("profiles")
    .select("user_id,nickname")
    .ilike("nickname", `%${escapeIlikeTerm(query)}%`)
    .order("created_at", { ascending: false })
    .limit(10);

  if (profileRes.error) {
    console.error("[GET /api/admin/dating/reels/viewers] failed", profileRes.error);
    return NextResponse.json({ error: "회원을 검색하지 못했습니다." }, { status: 500 });
  }

  const items = (profileRes.data ?? [])
    .map((profile) => ({
      user_id: String(profile.user_id ?? ""),
      nickname: typeof profile.nickname === "string" ? profile.nickname : null,
    }))
    .filter((profile) => profile.user_id);

  return NextResponse.json({ items });
}
