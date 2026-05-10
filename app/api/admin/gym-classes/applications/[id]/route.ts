import { NextResponse } from "next/server";
import { requireAdminRoute } from "@/lib/admin-route";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const APPLICATION_STATUSES = new Set(["submitted", "confirmed", "canceled", "attended", "no_show"]);

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
  const status = typeof body.status === "string" && APPLICATION_STATUSES.has(body.status) ? body.status : null;

  const patch = {
    ...(status ? { status } : {}),
    admin_note: cleanText(body.admin_note, 1000),
    operator_note: cleanText(body.operator_note, 1000),
    ...(status === "confirmed" ? { confirmed_at: new Date().toISOString(), canceled_at: null } : {}),
    ...(status === "canceled" ? { canceled_at: new Date().toISOString() } : {}),
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await auth.admin.from("gym_class_applications").update(patch).eq("id", id).select("*").single();
  if (error) {
    return NextResponse.json({ error: "지원자 상태 수정에 실패했습니다.", detail: error.message }, { status: 500 });
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
