import { NextResponse } from "next/server";
import { requireAdminRoute } from "@/lib/admin-route";
import { calculateGymClassRefundPercent } from "@/lib/gym-class-rules";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function cleanText(value: unknown, maxLength = 1000) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

function cleanInteger(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

export async function POST(req: Request, context: RouteContext) {
  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const body = asRecord(await req.json().catch(() => ({})));

  const { data: application, error: applicationError } = await auth.admin
    .from("gym_class_applications")
    .select("id,class_id,email,phone,paid_amount_krw,gym_classes(refund_full_until_days,refund_half_until_days),gym_class_schedules(starts_at)")
    .eq("id", id)
    .single();

  if (applicationError || !application) {
    return NextResponse.json({ error: "신청 내역을 찾지 못했습니다.", detail: applicationError?.message }, { status: 404 });
  }

  const nestedClass = Array.isArray(application.gym_classes) ? application.gym_classes[0] : application.gym_classes;
  const nestedSchedule = Array.isArray(application.gym_class_schedules)
    ? application.gym_class_schedules[0]
    : application.gym_class_schedules;
  const refundPercent = calculateGymClassRefundPercent(
    nestedSchedule?.starts_at,
    nestedClass?.refund_full_until_days ?? 3,
    nestedClass?.refund_half_until_days ?? 2,
  );
  const paidAmount = application.paid_amount_krw ?? 0;
  const requestedAmount = cleanInteger(body.approved_amount_krw) ?? Math.floor((paidAmount * refundPercent) / 100);
  const now = new Date().toISOString();

  const { data: request, error: requestError } = await auth.admin
    .from("gym_class_refund_requests")
    .insert({
      application_id: id,
      class_id: application.class_id,
      status: "requested",
      reason: cleanText(body.reason),
      calculated_refund_percent: refundPercent,
      requested_amount_krw: requestedAmount,
      admin_note: cleanText(body.admin_note),
      updated_at: now,
    })
    .select("*")
    .single();

  if (requestError) {
    return NextResponse.json({ error: "환불 요청 저장에 실패했습니다.", detail: requestError.message }, { status: 500 });
  }

  const { error: updateError } = await auth.admin
    .from("gym_class_applications")
    .update({
      refund_status: "requested",
      refund_requested_at: now,
      refund_reason: cleanText(body.reason),
      refund_amount_krw: requestedAmount,
      updated_at: now,
    })
    .eq("id", id);

  if (updateError) {
    return NextResponse.json({ error: "신청 내역 환불 상태 반영에 실패했습니다.", detail: updateError.message }, { status: 500 });
  }

  await auth.admin.from("gym_class_notifications").insert({
    class_id: application.class_id,
    application_id: id,
    email: application.email,
    phone: application.phone,
    kind: "refund_requested",
    title: "환불 요청이 접수되었습니다.",
    body: `예상 환불 비율은 ${refundPercent}%입니다. 관리자가 확인 후 처리합니다.`,
    status: application.email || application.phone ? "queued" : "skipped",
  });

  return NextResponse.json({ item: request });
}
