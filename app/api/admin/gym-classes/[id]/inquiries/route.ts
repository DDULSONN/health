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

export async function POST(req: Request, context: RouteContext) {
  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const body = asRecord(await req.json());
  const question = cleanText(body.question, 1200);
  if (!question) return NextResponse.json({ error: "문의 내용을 입력해주세요." }, { status: 400 });

  const { data, error } = await auth.admin
    .from("gym_class_inquiries")
    .insert({
      class_id: id,
      user_id: auth.user.id,
      name: cleanText(body.name, 80),
      email: cleanText(body.email, 160),
      phone: cleanText(body.phone, 40),
      question,
    })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: "문의 등록에 실패했습니다.", detail: error.message }, { status: 500 });
  }
  return NextResponse.json({ item: data });
}
