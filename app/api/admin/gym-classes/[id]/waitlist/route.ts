import { NextResponse } from "next/server";
import { requireAdminRoute } from "@/lib/admin-route";
import { normalizeGymClassGender } from "@/lib/gym-class-rules";

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

function requiredText(value: unknown, label: string, maxLength = 120) {
  const cleaned = cleanText(value, maxLength);
  if (!cleaned) throw new Error(`${label}을 입력해주세요.`);
  return cleaned;
}

export async function GET(_req: Request, context: RouteContext) {
  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const { data, error } = await auth.admin.from("gym_class_waitlist").select("*").eq("class_id", id).order("created_at", { ascending: false });
  if (error) {
    return NextResponse.json({ error: "대기자 목록을 불러오지 못했습니다.", detail: error.message }, { status: 500 });
  }
  return NextResponse.json({ items: data ?? [] });
}

export async function POST(req: Request, context: RouteContext) {
  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;

  try {
    const { id } = await context.params;
    const body = asRecord(await req.json());
    const payload = {
      class_id: id,
      schedule_id: cleanText(body.schedule_id, 80),
      name: requiredText(body.name, "이름", 80),
      phone: cleanText(body.phone, 40),
      email: cleanText(body.email, 160),
      gender: normalizeGymClassGender(body.gender),
      memo: cleanText(body.memo, 1000),
      status: "waiting",
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await auth.admin.from("gym_class_waitlist").insert(payload).select("*").single();
    if (error) {
      return NextResponse.json({ error: "대기자 등록에 실패했습니다.", detail: error.message }, { status: 500 });
    }

    return NextResponse.json({ item: data });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "대기자 등록에 실패했습니다." }, { status: 400 });
  }
}
