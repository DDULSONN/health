import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("weekly_winners")
    .select("id, week_start, week_end, male_post_id, female_post_id")
    .or(`male_post_id.eq.${id},female_post_id.eq.${id}`)
    .order("week_start", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    total_wins: data?.length ?? 0,
    latest: data?.[0] ?? null,
  });
}
