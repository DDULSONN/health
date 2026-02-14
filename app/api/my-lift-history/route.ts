import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

type LiftHistoryRow = {
  created_at: string;
  total: number | null;
  squat: number | null;
  bench: number | null;
  deadlift: number | null;
};

function getRangeDays(raw: string | null): 30 | 90 {
  return raw === "90" ? 90 : 30;
}

function getRangeStartUtcIso(rangeDays: number): string {
  const now = new Date();
  const kstNow = new Date(now.getTime() + KST_OFFSET_MS);
  kstNow.setUTCHours(0, 0, 0, 0);
  kstNow.setUTCDate(kstNow.getUTCDate() - (rangeDays - 1));
  const utcStart = new Date(kstNow.getTime() - KST_OFFSET_MS);
  return utcStart.toISOString();
}

function formatKstDate(value: string): string {
  const date = new Date(value);
  const kstDate = new Date(date.getTime() + KST_OFFSET_MS);
  const year = kstDate.getUTCFullYear();
  const month = String(kstDate.getUTCMonth() + 1).padStart(2, "0");
  const day = String(kstDate.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const range = getRangeDays(searchParams.get("range"));

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const startUtcIso = getRangeStartUtcIso(range);
  const { data, error } = await supabase
    .from("lift_records")
    .select("created_at, total, squat, bench, deadlift")
    .eq("user_id", user.id)
    .gte("created_at", startUtcIso)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[GET /api/my-lift-history]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const byDate = new Map<string, number>();
  for (const row of (data ?? []) as LiftHistoryRow[]) {
    const date = formatKstDate(row.created_at);
    const total = Number(row.total ?? 0) || Number(row.squat ?? 0) + Number(row.bench ?? 0) + Number(row.deadlift ?? 0);
    if (total <= 0) continue;
    byDate.set(date, Math.round(total * 10) / 10);
  }

  const history = Array.from(byDate.entries())
    .map(([date, total]) => ({ date, total }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return NextResponse.json(history);
}

