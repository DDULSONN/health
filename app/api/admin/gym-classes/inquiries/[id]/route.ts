import { NextResponse } from "next/server";
import { requireAdminRoute } from "@/lib/admin-route";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function cleanText(value: unknown, maxLength = 1200) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

export async function PATCH(req: Request, context: RouteContext) {
  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const body = asRecord(await req.json());
  const answer = cleanText(body.answer);
  const status = body.status === "closed" ? "closed" : answer ? "answered" : "open";
  const patch = {
    answer,
    status,
    answered_by_user_id: answer ? auth.user.id : null,
    answered_at: answer ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await auth.admin.from("gym_class_inquiries").update(patch).eq("id", id).select("*").single();
  if (error) {
    return NextResponse.json({ error: "문의 답변 저장에 실패했습니다.", detail: error.message }, { status: 500 });
  }
  return NextResponse.json({ item: data });
}
