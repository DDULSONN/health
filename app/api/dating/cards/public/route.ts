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
      "id, owner_user_id, sex, display_nickname, age, region, height_cm, job, training_years, ideal_type, total_3lift, percent_all, is_3lift_verified, blur_thumb_path, expires_at, created_at",
      { count: "exact" }
    )
    .eq("status", "public")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false });

  if (sex === "male" || sex === "female") {
    query = query.eq("sex", sex);
  }

  const { data, error, count } = await query.range(offset, offset + limit - 1);
  if (error) {
    console.error("[GET /api/dating/cards/public] failed", error);
    return NextResponse.json({ error: "카드 목록을 불러오지 못했습니다." }, { status: 500 });
  }

  const items = await Promise.all(
    (data ?? []).map(async (row) => {
      let blurThumbUrl = "";
      if (row.blur_thumb_path) {
        const { data: signed } = await adminClient.storage
          .from("dating-card-photos")
          .createSignedUrl(row.blur_thumb_path, 600);
        blurThumbUrl = signed?.signedUrl ?? "";
      }
      return {
        id: row.id,
        sex: row.sex,
        display_nickname: row.display_nickname,
        age: row.age,
        region: row.region,
        height_cm: row.height_cm,
        job: row.job,
        training_years: row.training_years,
        ideal_type: row.ideal_type,
        total_3lift: row.total_3lift,
        percent_all: row.percent_all,
        is_3lift_verified: row.is_3lift_verified,
        blur_thumb_url: blurThumbUrl,
        expires_at: row.expires_at,
        created_at: row.created_at,
      };
    })
  );

  const nextOffset = offset + items.length;
  const hasMore = (count ?? 0) > nextOffset;
  return NextResponse.json({ items, nextOffset, hasMore, total: count ?? 0 });
}
