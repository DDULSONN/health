import { isAdminEmail } from "@/lib/admin";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

type DatingCardFallbackRow = {
  id: string;
  owner_user_id: string;
  sex: "male" | "female";
  age: number | null;
  region: string | null;
  height_cm: number | null;
  job: string | null;
  training_years: number | null;
  ideal_type: string | null;
  total_3lift: number | null;
  percent_all: number | null;
  is_3lift_verified: boolean;
  status: "pending" | "public" | "expired" | "hidden";
  created_at: string;
};

function parseIntSafe(value: string | null, fallback: number) {
  if (!value) return fallback;
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, Math.floor(num));
}

export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const limit = Math.min(parseIntSafe(searchParams.get("limit"), 200), 2000);
  const page = Math.max(1, parseIntSafe(searchParams.get("page"), 1));
  const offset = (page - 1) * limit;

  const adminClient = createAdminClient();

  let query = adminClient
    .from("dating_cards")
    .select(
      "id, owner_user_id, sex, display_nickname, age, region, height_cm, job, training_years, strengths_text, ideal_type, instagram_id, total_3lift, percent_all, is_3lift_verified, photo_paths, blur_thumb_path, status, published_at, expires_at, created_at",
      { count: "exact" }
    )
    .order("created_at", { ascending: false });

  if (status === "pending" || status === "public" || status === "expired" || status === "hidden") {
    query = query.eq("status", status);
  }

  let { data, error, count } = await query.range(offset, offset + limit - 1);

  if (error && error.code === "42703") {
    let fallbackQuery = adminClient
      .from("dating_cards")
      .select(
        "id, owner_user_id, sex, age, region, height_cm, job, training_years, ideal_type, total_3lift, percent_all, is_3lift_verified, status, created_at",
        { count: "exact" }
      )
      .order("created_at", { ascending: false });

    if (status === "pending" || status === "public" || status === "expired" || status === "hidden") {
      fallbackQuery = fallbackQuery.eq("status", status);
    }

    const fallbackRes = await fallbackQuery.range(offset, offset + limit - 1);
    data = ((fallbackRes.data ?? []) as DatingCardFallbackRow[]).map((row) => ({
      ...row,
      display_nickname: null,
      strengths_text: null,
      instagram_id: null,
      photo_paths: [],
      blur_thumb_path: null,
      published_at: null,
      expires_at: null,
    }));
    error = fallbackRes.error;
    count = fallbackRes.count ?? 0;
  }

  if (error) {
    console.error("[GET /api/admin/dating/cards] failed", error);
    return NextResponse.json({ error: "카드 목록을 불러오지 못했습니다." }, { status: 500 });
  }

  return NextResponse.json({
    items: data ?? [],
    page,
    limit,
    total: count ?? 0,
  });
}
