import { NextResponse } from "next/server";
import { requireAdminRoute } from "@/lib/admin-route";

type RouteContext = {
  params: Promise<{ id: string }>;
};

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
  const status = cleanText(body.status, 40);
  const allowed = new Set(["waiting", "notified", "converted", "canceled"]);
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (status && allowed.has(status)) {
    patch.status = status;
    if (status === "notified") patch.notified_at = new Date().toISOString();
  }

  const { data, error } = await auth.admin.from("gym_class_waitlist").update(patch).eq("id", id).select("*").single();
  if (error) {
    return NextResponse.json({ error: "대기자 상태 변경에 실패했습니다.", detail: error.message }, { status: 500 });
  }
  return NextResponse.json({ item: data });
}
