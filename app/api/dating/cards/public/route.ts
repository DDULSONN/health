import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

function parseIntSafe(value: string | null, fallback: number) {
  if (!value) return fallback;
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, Math.floor(num));
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const limit = Math.min(parseIntSafe(searchParams.get("limit"), 20), 50);
  const offset = parseIntSafe(searchParams.get("offset"), 0);
  const sex = searchParams.get("sex");

  const adminClient = createAdminClient();
  let query = adminClient
    .from("dating_cards")
    .select(
      "id, owner_user_id, sex, age, region, height_cm, job, training_years, ideal_type, total_3lift, percent_all, is_3lift_verified, created_at",
      { count: "exact" }
    )
    .eq("status", "public")
    .order("created_at", { ascending: false });

  if (sex === "male" || sex === "female") {
    query = query.eq("sex", sex);
  }

  const { data, error, count } = await query.range(offset, offset + limit - 1);
  if (error) {
    console.error("[GET /api/dating/cards/public] failed", error);
    return NextResponse.json({ error: "카드 목록을 불러오지 못했습니다." }, { status: 500 });
  }

  const items = (data ?? []).map((row) => ({
    ...row,
    can_apply: true,
  }));
  const nextOffset = offset + items.length;
  const hasMore = (count ?? 0) > nextOffset;

  return NextResponse.json({ items, nextOffset, hasMore, total: count ?? 0 });
}
