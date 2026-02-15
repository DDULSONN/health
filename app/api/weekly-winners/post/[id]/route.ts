import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("hall_of_fame")
    .select("id, week_id, gender, post_id")
    .eq("post_id", id)
    .order("week_id", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    total_wins: data?.length ?? 0,
    latest: data?.[0] ?? null,
  });
}
