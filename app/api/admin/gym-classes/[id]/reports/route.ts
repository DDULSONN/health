import { NextResponse } from "next/server";
import { requireAdminRoute } from "@/lib/admin-route";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const REPORT_CATEGORIES = new Set(["general", "payment", "refund", "safety", "host", "participant", "content"]);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function cleanText(value: unknown, maxLength = 1000) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

export async function POST(req: Request, context: RouteContext) {
  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const body = asRecord(await req.json());
  const content = cleanText(body.content, 1200);
  if (!content) return NextResponse.json({ error: "신고/분쟁 내용을 입력해주세요." }, { status: 400 });
  const category = cleanText(body.category, 40);

  const { data, error } = await auth.admin
    .from("gym_class_reports")
    .insert({
      class_id: id,
      reporter_user_id: auth.user.id,
      application_id: cleanText(body.application_id, 80),
      category: category && REPORT_CATEGORIES.has(category) ? category : "general",
      content,
    })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: "신고/분쟁 등록에 실패했습니다.", detail: error.message }, { status: 500 });
  }
  return NextResponse.json({ item: data });
}
