import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type Sex = "male" | "female";

type Body = {
  sex?: Sex;
  squat?: number;
  bench?: number;
  deadlift?: number;
  total?: number;
};

function toNumber(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const body = (await request.json()) as Body;
  const sex = body.sex;
  const squat = Math.max(0, toNumber(body.squat));
  const bench = Math.max(0, toNumber(body.bench));
  const deadlift = Math.max(0, toNumber(body.deadlift));
  const total = Math.max(0, toNumber(body.total) || squat + bench + deadlift);

  if (sex !== "male" && sex !== "female") {
    return NextResponse.json({ error: "성별(male/female)은 필수입니다." }, { status: 400 });
  }

  if (total <= 0) {
    return NextResponse.json({ error: "3대 합계가 0보다 커야 합니다." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("lift_records")
    .insert({
      user_id: user.id,
      sex,
      squat,
      bench,
      deadlift,
      total,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[POST /api/lift-records]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ id: data.id }, { status: 201 });
}

