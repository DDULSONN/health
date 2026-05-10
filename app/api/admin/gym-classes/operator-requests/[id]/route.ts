import { NextResponse } from "next/server";
import { requireAdminRoute } from "@/lib/admin-route";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const REQUEST_STATUSES = new Set(["pending", "approved", "rejected"]);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function cleanText(value: unknown, maxLength = 500) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

export async function PATCH(req: Request, context: RouteContext) {
  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const body = asRecord(await req.json());
  const status = typeof body.status === "string" && REQUEST_STATUSES.has(body.status) ? body.status : null;
  if (!status) {
    return NextResponse.json({ error: "상태 값이 올바르지 않습니다." }, { status: 400 });
  }

  const { data: request, error: requestError } = await auth.admin
    .from("gym_class_operator_requests")
    .select("*")
    .eq("id", id)
    .single();

  if (requestError || !request) {
    return NextResponse.json(
      { error: "운영 신청을 찾지 못했습니다.", detail: requestError?.message },
      { status: 404 },
    );
  }

  const reviewedAt = status === "pending" ? null : new Date().toISOString();
  const { data: updatedRequest, error: updateError } = await auth.admin
    .from("gym_class_operator_requests")
    .update({
      status,
      reviewed_by_user_id: status === "pending" ? null : auth.user.id,
      reviewed_at: reviewedAt,
      admin_note: cleanText(body.admin_note, 1000),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("*")
    .single();

  if (updateError) {
    return NextResponse.json({ error: "운영 신청 수정에 실패했습니다.", detail: updateError.message }, { status: 500 });
  }

  let operator = null;
  if (status === "approved") {
    const { data: existingOperator } = await auth.admin
      .from("gym_class_operators")
      .select("*")
      .eq("approved_request_id", id)
      .maybeSingle();

    if (existingOperator) {
      const { data, error } = await auth.admin
        .from("gym_class_operators")
        .update({
          status: "active",
          name: request.applicant_name,
          email: request.email,
          phone: request.phone,
          host_name: request.host_name,
          host_type: request.host_type,
          region: request.region,
          intro: request.intro,
          approved_by_user_id: auth.user.id,
          approved_at: reviewedAt,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingOperator.id)
        .select("*")
        .single();
      if (error) {
        return NextResponse.json({ error: "운영자 갱신에 실패했습니다.", detail: error.message }, { status: 500 });
      }
      operator = data;
    } else {
      const { data, error } = await auth.admin
        .from("gym_class_operators")
        .insert({
          user_id: request.user_id,
          approved_request_id: id,
          name: request.applicant_name,
          email: request.email,
          phone: request.phone,
          host_name: request.host_name,
          host_type: request.host_type,
          region: request.region,
          intro: request.intro,
          status: "active",
          approved_by_user_id: auth.user.id,
          approved_at: reviewedAt,
          updated_at: new Date().toISOString(),
        })
        .select("*")
        .single();
      if (error) {
        return NextResponse.json({ error: "운영자 생성에 실패했습니다.", detail: error.message }, { status: 500 });
      }
      operator = data;
    }
  }

  return NextResponse.json({ item: updatedRequest, operator });
}
