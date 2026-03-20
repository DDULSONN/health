import { extractProvinceFromRegion } from "@/lib/region-city";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

type CityViewRequestRow = {
  id: string;
  status: "pending" | "approved" | "rejected" | string;
  access_expires_at?: string | null;
  reviewed_at?: string | null;
  created_at?: string | null;
};

function normalizeIsoDate(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function getRowSortTime(row: CityViewRequestRow): number {
  const reviewedAt = normalizeIsoDate(row.reviewed_at);
  if (reviewedAt) return new Date(reviewedAt).getTime();
  const createdAt = normalizeIsoDate(row.created_at);
  if (createdAt) return new Date(createdAt).getTime();
  return 0;
}

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

  const historyRes = await admin
    .from("dating_city_view_requests")
    .select("id,status,access_expires_at,reviewed_at,created_at")
    .eq("user_id", user.id)
    .eq("city", province)
    .order("reviewed_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(50);

  if (Array.isArray(historyRes.data)) {
    const rows = historyRes.data as CityViewRequestRow[];
    const activeApproved = rows.find((row) => {
      if (row.status !== "approved" || !row.access_expires_at) return false;
      const t = new Date(row.access_expires_at).getTime();
      return Number.isFinite(t) && t > Date.now();
    });
    if (activeApproved) {
      return NextResponse.json({ ok: true, status: "approved", province });
    }

    const latest = [...rows].sort((a, b) => getRowSortTime(b) - getRowSortTime(a))[0];
    if (latest?.status === "pending") {
      return NextResponse.json({ ok: true, status: "pending", province });
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
