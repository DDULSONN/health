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
  const rating = Number(body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return NextResponse.json({ error: "평점은 1점부터 5점까지 입력해주세요." }, { status: 400 });
  }

  const { data, error } = await auth.admin
    .from("gym_class_reviews")
    .insert({
      class_id: id,
      application_id: cleanText(body.application_id, 80),
      reviewer_user_id: auth.user.id,
      rating,
      content: cleanText(body.content, 1000),
      status: "visible",
    })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: "리뷰 저장에 실패했습니다.", detail: error.message }, { status: 500 });
  }
  return NextResponse.json({ item: data });
}
