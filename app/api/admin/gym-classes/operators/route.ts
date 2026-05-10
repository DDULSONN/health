import { NextResponse } from "next/server";
import { requireAdminRoute } from "@/lib/admin-route";

type GymHostType = "trainer" | "gym" | "brand" | "individual" | "other";

const HOST_TYPES = new Set<GymHostType>(["trainer", "gym", "brand", "individual", "other"]);

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
  if (!cleaned) throw new Error(`${label}을 입력해 주세요.`);
  return cleaned;
}

function cleanHostType(value: unknown): GymHostType {
  return typeof value === "string" && HOST_TYPES.has(value as GymHostType) ? (value as GymHostType) : "trainer";
}

export async function GET() {
  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;

  const [requestsResult, operatorsResult] = await Promise.all([
    auth.admin
      .from("gym_class_operator_requests")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200),
    auth.admin
      .from("gym_class_operators")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  if (requestsResult.error) {
    return NextResponse.json(
      { error: "운영 신청 목록을 불러오지 못했습니다.", detail: requestsResult.error.message },
      { status: 500 },
    );
  }

  if (operatorsResult.error) {
    return NextResponse.json(
      { error: "운영자 목록을 불러오지 못했습니다.", detail: operatorsResult.error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    requests: requestsResult.data ?? [],
    operators: operatorsResult.data ?? [],
  });
}

export async function POST(req: Request) {
  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;

  try {
    const body = asRecord(await req.json());
    const payload = {
      user_id: cleanText(body.user_id, 80),
      applicant_name: requiredText(body.applicant_name, "신청자명", 80),
      email: cleanText(body.email, 160),
      phone: cleanText(body.phone, 40),
      host_name: requiredText(body.host_name, "운영명", 120),
      host_type: cleanHostType(body.host_type),
      region: cleanText(body.region, 80),
      intro: cleanText(body.intro, 1200),
      status: "pending",
      admin_note: cleanText(body.admin_note, 1000),
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await auth.admin
      .from("gym_class_operator_requests")
      .insert(payload)
      .select("*")
      .single();

    if (error) {
      return NextResponse.json({ error: "운영 신청 저장에 실패했습니다.", detail: error.message }, { status: 500 });
    }

    return NextResponse.json({ item: data });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "운영 신청 저장에 실패했습니다." },
      { status: 400 },
    );
  }
}
