import { NextResponse } from "next/server";
import { createAdminClient, createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: operator, error: operatorError } = await admin
    .from("gym_class_operators")
    .select("*")
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();

  if (operatorError) {
    return NextResponse.json({ error: "운영자 정보를 불러오지 못했습니다.", detail: operatorError.message }, { status: 500 });
  }

  if (!operator) {
    return NextResponse.json({ operator: null, classes: [] });
  }

  const { data: classes, error: classesError } = await admin
    .from("gym_classes")
    .select("*")
    .eq("operator_id", operator.id)
    .order("created_at", { ascending: false });

  if (classesError) {
    return NextResponse.json({ error: "클래스 목록을 불러오지 못했습니다.", detail: classesError.message }, { status: 500 });
  }

  const classIds = (classes ?? []).map((item) => item.id);
  const { data: applications, error: applicationsError } = classIds.length
    ? await admin.from("gym_class_applications").select("id,class_id,status,created_at").in("class_id", classIds)
    : { data: [], error: null };

  if (applicationsError) {
    return NextResponse.json({ error: "지원자 요약을 불러오지 못했습니다.", detail: applicationsError.message }, { status: 500 });
  }

  return NextResponse.json({
    operator,
    classes: classes ?? [],
    applications: applications ?? [],
  });
}
