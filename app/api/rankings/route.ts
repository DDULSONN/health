import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/** GET /api/rankings — 최근 7일 랭킹 (프로필 별도 조회) */
export async function GET() {
  const supabase = await createClient();
  const sevenDaysAgo = new Date(
    Date.now() - 7 * 24 * 60 * 60 * 1000
  ).toISOString();

  // 3대 합계 top 10
  const { data: liftsRaw } = await supabase
    .from("posts")
    .select("id, user_id, payload_json, created_at")
    .eq("type", "lifts")
    .eq("is_hidden", false)
    .gte("created_at", sevenDaysAgo)
    .not("payload_json", "is", null)
    .order("created_at", { ascending: false })
    .limit(50);

  const liftsSorted = (liftsRaw ?? [])
    .filter(
      (p) =>
        p.payload_json &&
        typeof (p.payload_json as Record<string, unknown>).totalKg === "number"
    )
    .sort((a, b) => {
      const aVal = (a.payload_json as Record<string, number>).totalKg ?? 0;
      const bVal = (b.payload_json as Record<string, number>).totalKg ?? 0;
      return bVal - aVal;
    })
    .slice(0, 10);

  // 1RM top 10
  const { data: oneRmRaw } = await supabase
    .from("posts")
    .select("id, user_id, payload_json, created_at")
    .eq("type", "1rm")
    .eq("is_hidden", false)
    .gte("created_at", sevenDaysAgo)
    .not("payload_json", "is", null)
    .order("created_at", { ascending: false })
    .limit(50);

  const oneRmSorted = (oneRmRaw ?? [])
    .filter(
      (p) =>
        p.payload_json &&
        typeof (p.payload_json as Record<string, unknown>).oneRmKg === "number"
    )
    .sort((a, b) => {
      const aVal = (a.payload_json as Record<string, number>).oneRmKg ?? 0;
      const bVal = (b.payload_json as Record<string, number>).oneRmKg ?? 0;
      return bVal - aVal;
    })
    .slice(0, 10);

  // 프로필 일괄 조회
  const allUserIds = [
    ...new Set([
      ...liftsSorted.map((p) => p.user_id as string),
      ...oneRmSorted.map((p) => p.user_id as string),
    ]),
  ];

  const profileMap = new Map<string, { nickname: string }>();

  if (allUserIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("user_id, nickname")
      .in("user_id", allUserIds);

    for (const p of profiles ?? []) {
      profileMap.set(p.user_id, { nickname: p.nickname });
    }
  }

  const addProfile = (item: Record<string, unknown>) => ({
    ...item,
    profiles: profileMap.get(item.user_id as string) ?? null,
  });

  return NextResponse.json({
    lifts: liftsSorted.map(addProfile),
    oneRm: oneRmSorted.map(addProfile),
  });
}
