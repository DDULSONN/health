import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

const REGIONS = [
  "서울", "경기", "인천", "부산", "대구", "대전", "광주",
  "울산", "세종", "강원", "충북", "충남", "전북", "전남",
  "경북", "경남", "제주",
];

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const { sex, name, phone, region, height_cm, job, ideal_type, training_years, consent_privacy, consent_content } = body as {
    sex?: string;
    name?: string;
    phone?: string;
    region?: string;
    height_cm?: number;
    job?: string;
    ideal_type?: string;
    training_years?: number;
    consent_privacy?: boolean;
    consent_content?: boolean;
  };

  // 필수 필드 검증
  if (!sex || !["male", "female"].includes(sex)) {
    return NextResponse.json({ error: "성별을 선택해주세요." }, { status: 400 });
  }
  if (!name || name.trim().length < 1 || name.trim().length > 20) {
    return NextResponse.json({ error: "이름을 입력해주세요. (1~20자)" }, { status: 400 });
  }
  if (!phone || phone.replace(/[^0-9]/g, "").length < 9 || phone.replace(/[^0-9]/g, "").length > 15) {
    return NextResponse.json({ error: "올바른 전화번호를 입력해주세요." }, { status: 400 });
  }
  if (!region || !REGIONS.includes(region)) {
    return NextResponse.json({ error: "지역을 선택해주세요." }, { status: 400 });
  }
  if (!height_cm || height_cm < 120 || height_cm > 220) {
    return NextResponse.json({ error: "키를 올바르게 입력해주세요. (120~220cm)" }, { status: 400 });
  }
  if (!job || job.trim().length < 1 || job.trim().length > 50) {
    return NextResponse.json({ error: "직업을 입력해주세요. (1~50자)" }, { status: 400 });
  }
  if (!ideal_type || ideal_type.trim().length < 1 || ideal_type.trim().length > 1000) {
    return NextResponse.json({ error: "이상형을 입력해주세요. (1~1000자)" }, { status: 400 });
  }
  if (training_years == null || training_years < 0 || training_years > 30) {
    return NextResponse.json({ error: "운동경력을 입력해주세요. (0~30년)" }, { status: 400 });
  }
  if (!consent_privacy) {
    return NextResponse.json({ error: "개인정보 수집·이용에 동의해주세요." }, { status: 400 });
  }

  // 남자: 3대 인증 approved 체크
  if (sex === "male") {
    const adminClient = createAdminClient();
    const { data: cert } = await adminClient
      .from("cert_requests")
      .select("id")
      .eq("user_id", user.id)
      .eq("status", "approved")
      .limit(1)
      .maybeSingle();

    if (!cert) {
      return NextResponse.json(
        { error: "남성은 3대 인증(승인 완료)이 필요합니다. 먼저 인증을 완료해주세요." },
        { status: 403 }
      );
    }
  }

  // 7일 중복 체크
  const adminClient = createAdminClient();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: recent } = await adminClient
    .from("dating_applications")
    .select("id")
    .eq("user_id", user.id)
    .in("status", ["submitted", "reviewing"])
    .gte("created_at", sevenDaysAgo)
    .limit(1)
    .maybeSingle();

  if (recent) {
    return NextResponse.json(
      { error: "7일 이내에 이미 신청하셨습니다. 기존 신청이 처리된 후 다시 신청해주세요." },
      { status: 429 }
    );
  }

  // INSERT (admin client로 RLS 우회 — insert 시 cert 확인은 위에서 이미 완료)
  const cleanPhone = phone.replace(/[^0-9]/g, "");
  const { data: app, error } = await adminClient
    .from("dating_applications")
    .insert({
      user_id: user.id,
      sex,
      name: name.trim(),
      phone: cleanPhone,
      region,
      height_cm: Math.round(height_cm),
      job: job.trim(),
      ideal_type: ideal_type.trim(),
      training_years: Math.round(training_years),
      consent_privacy: !!consent_privacy,
      consent_content: !!consent_content,
      status: "submitted",
    })
    .select("id")
    .single();

  if (error) {
    console.error("[POST /api/dating/apply]", error.message);
    return NextResponse.json({ error: "신청에 실패했습니다." }, { status: 500 });
  }

  return NextResponse.json({ id: app.id }, { status: 201 });
}
