import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

function normalizeSex(value: string): "male" | "female" {
  const v = value.trim().toLowerCase();
  if (v === "male" || v === "남자" || v === "남성" || v === "m") return "male";
  return "female";
}

const MALE_VALUES = ["male", "남자", "남성", "m"];
const FEMALE_VALUES = ["female", "여자", "여성", "f"];

function parsePositiveInt(value: string | null, fallback: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.floor(parsed);
}

/** GET /api/dating/public — 공개 소개팅 목록(성별별 페이지네이션) */
export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const adminClient = createAdminClient();
  const { searchParams } = new URL(req.url);
  const sex = searchParams.get("sex");
  const limit = Math.min(parsePositiveInt(searchParams.get("limit"), 20), 50);
  const offset = parsePositiveInt(searchParams.get("offset"), 0);
  const maleOffset = parsePositiveInt(searchParams.get("maleOffset"), 0);
  const femaleOffset = parsePositiveInt(searchParams.get("femaleOffset"), 0);

  const fetchBySex = async (targetSex: "male" | "female", fromOffset: number) => {
    const sexValues = targetSex === "male" ? MALE_VALUES : FEMALE_VALUES;
    const { data, error } = await adminClient
      .from("dating_applications")
      .select("id, sex, display_nickname, age, total_3lift, percent_all, training_years, ideal_type, created_at")
      .in("sex", sexValues)
      .eq("approved_for_public", true)
      .order("created_at", { ascending: false })
      .range(fromOffset, fromOffset + limit - 1);

    if (error) throw error;
    const items = (data ?? []).map((item) => ({ ...item, sex: normalizeSex(item.sex) }));
    return {
      items,
      hasMore: items.length === limit,
      nextOffset: fromOffset + items.length,
    };
  };

  try {
    if (sex === "male" || sex === "female") {
      const result = await fetchBySex(sex, offset);
      return NextResponse.json(result);
    }

    const [maleResult, femaleResult] = await Promise.all([
      fetchBySex("male", maleOffset),
      fetchBySex("female", femaleOffset),
    ]);

    return NextResponse.json({
      males: maleResult.items,
      females: femaleResult.items,
      maleHasMore: maleResult.hasMore,
      femaleHasMore: femaleResult.hasMore,
      nextMaleOffset: maleResult.nextOffset,
      nextFemaleOffset: femaleResult.nextOffset,
    });
  } catch (error) {
    console.error("[GET /api/dating/public] failed", error);
    return NextResponse.json({ error: "공개 목록을 불러오지 못했습니다." }, { status: 500 });
  }
}
