import { requireAdminRoute } from "@/lib/admin-route";
import { extractProvinceFromRegion } from "@/lib/region-city";
import { NextResponse } from "next/server";

type CityViewRequestRow = {
  id: string;
  user_id: string;
  city: string | null;
  status: string | null;
  created_at: string | null;
};

function normalizeProvince(value: string | null | undefined) {
  const raw = typeof value === "string" ? value.trim() : "";
  return extractProvinceFromRegion(raw) ?? raw;
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID();
  const adminGuard = await requireAdminRoute();
  if (!adminGuard.ok) return adminGuard.response;

  const { id } = await params;
  const targetRequestId = typeof id === "string" ? id.trim() : "";
  if (!targetRequestId) {
    return NextResponse.json({ ok: false, message: "request id가 필요합니다.", requestId }, { status: 400 });
  }

  const { admin } = adminGuard;
  const targetRes = await admin
    .from("dating_city_view_requests")
    .select("id,user_id,city,status,created_at")
    .eq("id", targetRequestId)
    .maybeSingle<CityViewRequestRow>();

  if (targetRes.error) {
    console.error("[admin-city-view-repair] target fetch failed", targetRes.error);
    return NextResponse.json({ ok: false, message: "대상 요청을 불러오지 못했습니다.", requestId }, { status: 500 });
  }
  if (!targetRes.data) {
    return NextResponse.json({ ok: false, message: "대상 요청을 찾을 수 없습니다.", requestId }, { status: 404 });
  }

  const province = normalizeProvince(targetRes.data.city);
  if (!province) {
    return NextResponse.json({ ok: false, message: "도/광역시 정보를 확인할 수 없습니다.", requestId }, { status: 400 });
  }

  const historyRes = await admin
    .from("dating_city_view_requests")
    .select("id,user_id,city,status,created_at")
    .eq("user_id", targetRes.data.user_id)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(200);

  if (historyRes.error) {
    console.error("[admin-city-view-repair] history fetch failed", historyRes.error);
    return NextResponse.json({ ok: false, message: "pending 요청을 불러오지 못했습니다.", requestId }, { status: 500 });
  }

  const targetIds = (historyRes.data ?? [])
    .filter((row) => normalizeProvince(row.city) === province)
    .map((row) => row.id);

  if (targetIds.length === 0) {
    return NextResponse.json({
      ok: true,
      requestId,
      cleaned_count: 0,
      province,
      user_id: targetRes.data.user_id,
      message: "정리할 승인대기 요청이 없습니다.",
    });
  }

  const nowIso = new Date().toISOString();
  const updateRes = await admin
    .from("dating_city_view_requests")
    .update({
      status: "rejected",
      reviewed_at: nowIso,
      note: "admin stale pending cleanup",
    })
    .in("id", targetIds)
    .select("id");

  if (updateRes.error) {
    console.error("[admin-city-view-repair] update failed", updateRes.error);
    return NextResponse.json({ ok: false, message: "승인대기 정리에 실패했습니다.", requestId }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    requestId,
    cleaned_count: Array.isArray(updateRes.data) ? updateRes.data.length : targetIds.length,
    province,
    user_id: targetRes.data.user_id,
    message: "해당 지역의 승인대기 요청을 정리했습니다.",
  });
}
