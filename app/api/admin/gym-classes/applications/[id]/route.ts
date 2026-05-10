import { NextResponse } from "next/server";
import { requireAdminRoute } from "@/lib/admin-route";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const APPLICATION_STATUSES = new Set(["submitted", "confirmed", "canceled", "attended", "no_show"]);
const PAYMENT_STATUSES = new Set(["unpaid", "pending", "paid", "manual_paid", "refunded", "partial_refunded"]);
const REFUND_STATUSES = new Set(["none", "requested", "approved", "rejected", "refunded"]);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function cleanText(value: unknown, maxLength = 500) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

function cleanInteger(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

export async function PATCH(req: Request, context: RouteContext) {
  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const body = asRecord(await req.json());
  const status = typeof body.status === "string" && APPLICATION_STATUSES.has(body.status) ? body.status : null;
  const paymentStatus = typeof body.payment_status === "string" && PAYMENT_STATUSES.has(body.payment_status) ? body.payment_status : null;
  const refundStatus = typeof body.refund_status === "string" && REFUND_STATUSES.has(body.refund_status) ? body.refund_status : null;
  const now = new Date().toISOString();

  const patch = {
    ...(status ? { status } : {}),
    ...(paymentStatus ? { payment_status: paymentStatus } : {}),
    ...(body.paid_amount_krw !== undefined ? { paid_amount_krw: cleanInteger(body.paid_amount_krw) } : {}),
    ...(paymentStatus === "paid" || paymentStatus === "manual_paid" ? { paid_at: now } : {}),
    ...(refundStatus ? { refund_status: refundStatus } : {}),
    ...(refundStatus === "requested" ? { refund_requested_at: now } : {}),
    ...(refundStatus === "approved" || refundStatus === "rejected" || refundStatus === "refunded"
      ? { refund_processed_at: now, refund_processed_by_user_id: auth.user.id }
      : {}),
    ...(body.refund_amount_krw !== undefined ? { refund_amount_krw: cleanInteger(body.refund_amount_krw) } : {}),
    ...(body.refund_reason !== undefined ? { refund_reason: cleanText(body.refund_reason, 1000) } : {}),
    admin_note: cleanText(body.admin_note, 1000),
    operator_note: cleanText(body.operator_note, 1000),
    ...(status === "confirmed" ? { confirmed_at: now, canceled_at: null } : {}),
    ...(status === "canceled" ? { canceled_at: now } : {}),
    updated_at: now,
  };

  const { data, error } = await auth.admin.from("gym_class_applications").update(patch).eq("id", id).select("*").single();
  if (error) {
    return NextResponse.json({ error: "지원자 상태 수정에 실패했습니다.", detail: error.message }, { status: 500 });
  }

  if (paymentStatus === "paid" || paymentStatus === "manual_paid") {
    await auth.admin.from("gym_class_notifications").insert({
      class_id: data.class_id,
      application_id: data.id,
      email: data.email,
      phone: data.phone,
      kind: "payment_confirmed",
      title: "클래스 결제가 확인되었습니다.",
      body: "신청한 클래스의 결제 확인이 완료되었습니다. 일정과 준비물을 다시 확인해주세요.",
      status: data.email || data.phone ? "queued" : "skipped",
    });
  }

  if (refundStatus === "approved" || refundStatus === "refunded") {
    await auth.admin.from("gym_class_notifications").insert({
      class_id: data.class_id,
      application_id: data.id,
      email: data.email,
      phone: data.phone,
      kind: "refund_processed",
      title: "환불 요청 처리가 업데이트되었습니다.",
      body: "관리자 확인 후 환불 처리 상태가 변경되었습니다.",
      status: data.email || data.phone ? "queued" : "skipped",
    });
  }

  return NextResponse.json({ item: data });
}

export async function DELETE(_req: Request, context: RouteContext) {
  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const { error } = await auth.admin.from("gym_class_applications").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ error: "지원자 삭제에 실패했습니다.", detail: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
