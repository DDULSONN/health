import { NextResponse } from "next/server";
import { requireAdminRoute } from "@/lib/admin-route";

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

export async function PATCH(req: Request, context: RouteContext) {
  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const body = asRecord(await req.json());
  const status = cleanText(body.status, 40);
  const allowed = new Set(["open", "reviewing", "resolved", "rejected"]);
  const finalStatus = status && allowed.has(status) ? status : "reviewing";

  const { data, error } = await auth.admin
    .from("gym_class_reports")
    .update({
      status: finalStatus,
      admin_note: cleanText(body.admin_note, 1200),
      resolved_by_user_id: finalStatus === "resolved" || finalStatus === "rejected" ? auth.user.id : null,
      resolved_at: finalStatus === "resolved" || finalStatus === "rejected" ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: "신고/분쟁 처리에 실패했습니다.", detail: error.message }, { status: 500 });
  }
  return NextResponse.json({ item: data });
}
