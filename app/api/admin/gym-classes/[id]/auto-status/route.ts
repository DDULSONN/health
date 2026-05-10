import { NextResponse } from "next/server";
import { requireAdminRoute } from "@/lib/admin-route";
import { buildGymClassApplicationStats } from "@/lib/gym-class-rules";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(_req: Request, context: RouteContext) {
  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const [{ data: gymClass, error: classError }, { data: applications }, { data: schedules }] = await Promise.all([
    auth.admin.from("gym_classes").select("*").eq("id", id).single(),
    auth.admin.from("gym_class_applications").select("id,status,gender,payment_status,paid_amount_krw,refund_amount_krw").eq("class_id", id),
    auth.admin.from("gym_class_schedules").select("starts_at,ends_at").eq("class_id", id),
  ]);

  if (classError || !gymClass) {
    return NextResponse.json({ error: "클래스를 찾지 못했습니다.", detail: classError?.message }, { status: 404 });
  }

  const stats = buildGymClassApplicationStats(applications ?? [], gymClass);
  const now = Date.now();
  const deadlinePassed = gymClass.application_deadline ? new Date(gymClass.application_deadline).getTime() < now : false;
  const allSchedulesEnded =
    (schedules ?? []).length > 0 &&
    (schedules ?? []).every((schedule) => {
      const endValue = schedule.ends_at || schedule.starts_at;
      return endValue ? new Date(endValue).getTime() < now : false;
    });
  const shouldClose = gymClass.status === "published" && (stats.isFull || deadlinePassed || allSchedulesEnded);

  if (!shouldClose) {
    return NextResponse.json({
      changed: false,
      status: gymClass.status,
      reason: "아직 자동 마감 조건이 아닙니다.",
      stats,
    });
  }

  const { error } = await auth.admin
    .from("gym_classes")
    .update({ status: "closed", auto_closed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: "상태 자동 정리에 실패했습니다.", detail: error.message }, { status: 500 });
  }

  return NextResponse.json({ changed: true, status: "closed", reason: "정원/마감일/일정 종료 조건으로 마감 처리했습니다.", stats });
}
