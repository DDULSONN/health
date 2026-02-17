import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const adminClient = createAdminClient();
  const { data, error } = await adminClient
    .from("dating_cards")
    .select(
      "id, owner_user_id, sex, age, region, height_cm, job, training_years, ideal_type, total_3lift, percent_all, is_3lift_verified, created_at, status"
    )
    .eq("id", id)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "카드를 찾을 수 없습니다." }, { status: 404 });
  }

  if (data.status !== "public") {
    return NextResponse.json({ error: "접근 권한이 없습니다." }, { status: 403 });
  }

  return NextResponse.json({ card: data, can_apply: true });
}
