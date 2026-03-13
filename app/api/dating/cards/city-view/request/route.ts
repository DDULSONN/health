import { extractProvinceFromRegion } from "@/lib/region-city";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const { user } = await getRequestAuthContext(req);

  if (!user) {
    return NextResponse.json({ ok: false, message: "로그인이 필요합니다." }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as { city?: unknown; province?: unknown } | null;
  const provinceRaw = typeof body?.province === "string" ? body.province.trim() : typeof body?.city === "string" ? body.city.trim() : "";
  const province = extractProvinceFromRegion(provinceRaw) ?? provinceRaw;

  if (!province || province.length < 2 || province.length > 20) {
    return NextResponse.json({ ok: false, message: "도/광역시명을 확인해주세요." }, { status: 400 });
  }

  const admin = createAdminClient();

  const pendingRes = await admin
    .from("dating_city_view_requests")
    .select("id")
    .eq("user_id", user.id)
    .eq("city", province)
    .eq("status", "pending")
    .maybeSingle();

  if (pendingRes.data) {
    return NextResponse.json({ ok: true, status: "pending", province });
  }

  const activeApprovedRes = await admin
    .from("dating_city_view_requests")
    .select("id,access_expires_at")
    .eq("user_id", user.id)
    .eq("city", province)
    .eq("status", "approved")
    .order("reviewed_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(10);

  if (Array.isArray(activeApprovedRes.data)) {
    const active = activeApprovedRes.data.find((row: { access_expires_at: string | null }) => {
      if (!row.access_expires_at) return false;
      const t = new Date(row.access_expires_at).getTime();
      return Number.isFinite(t) && t > Date.now();
    });
    if (active) {
      return NextResponse.json({ ok: true, status: "approved", province });
    }
  }

  const insertRes = await admin.from("dating_city_view_requests").insert({
    user_id: user.id,
    city: province,
    status: "pending",
  });

  if (insertRes.error) {
    return NextResponse.json({ ok: false, message: "신청 생성에 실패했습니다." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, status: "pending", province, message: "신청이 접수되었습니다." });
}
