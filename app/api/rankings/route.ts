import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/** GET /api/rankings — 최근 7일 랭킹 */
export async function GET() {
  const supabase = await createClient();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // 3대 합계 top 10
  const { data: liftsRanking } = await supabase
    .from("posts")
    .select("id, payload_json, profiles(nickname), created_at")
    .eq("type", "lifts")
    .eq("is_hidden", false)
    .gte("created_at", sevenDaysAgo)
    .not("payload_json", "is", null)
    .order("created_at", { ascending: false })
    .limit(50);

  const liftsSorted = (liftsRanking ?? [])
    .filter((p) => p.payload_json && typeof (p.payload_json as Record<string, unknown>).totalKg === "number")
    .sort((a, b) => {
      const aVal = (a.payload_json as Record<string, number>).totalKg ?? 0;
      const bVal = (b.payload_json as Record<string, number>).totalKg ?? 0;
      return bVal - aVal;
    })
    .slice(0, 10);

  // 1RM top 10 (전체 운동)
  const { data: oneRmRanking } = await supabase
    .from("posts")
    .select("id, payload_json, profiles(nickname), created_at")
    .eq("type", "1rm")
    .eq("is_hidden", false)
    .gte("created_at", sevenDaysAgo)
    .not("payload_json", "is", null)
    .order("created_at", { ascending: false })
    .limit(50);

  const oneRmSorted = (oneRmRanking ?? [])
    .filter((p) => p.payload_json && typeof (p.payload_json as Record<string, unknown>).oneRmKg === "number")
    .sort((a, b) => {
      const aVal = (a.payload_json as Record<string, number>).oneRmKg ?? 0;
      const bVal = (b.payload_json as Record<string, number>).oneRmKg ?? 0;
      return bVal - aVal;
    })
    .slice(0, 10);

  return NextResponse.json({
    lifts: liftsSorted,
    oneRm: oneRmSorted,
  });
}
