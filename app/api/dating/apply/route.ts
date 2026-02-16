import { createClient, createAdminClient } from "@/lib/supabase/server";
import type { PostgrestError } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

const REGIONS = [
  "서울", "경기", "인천", "부산", "대구", "대전", "광주",
  "울산", "세종", "강원", "충북", "충남", "전북", "전남",
  "경북", "경남", "제주",
];

function normalizeSex(value: unknown): "male" | "female" | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (["male", "m", "남", "남자", "남성"].includes(normalized)) return "male";
  if (["female", "f", "여", "여자", "여성"].includes(normalized)) return "female";
  return null;
}

function toInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.round(parsed);
  }
  return null;
}

function formatDbError(error: PostgrestError): string {
  return [
    error.code ? `[${error.code}]` : null,
    error.message ?? null,
    error.details ?? null,
    error.hint ? `hint: ${error.hint}` : null,
  ]
    .filter(Boolean)
    .join(" | ");
}

function jsonError(status: number, error: string, code: string, details?: string) {
  return NextResponse.json({ error, code, details }, { status });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return jsonError(401, "로그인이 필요합니다.", "AUTH_REQUIRED");
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return jsonError(500, "서버 설정이 올바르지 않습니다.", "CONFIG_ERROR");
  }

  const body = await request.json().catch(() => null);
  if (!body) {
    return jsonError(400, "잘못된 요청입니다.", "INVALID_JSON");
  }

  const { sex, name, phone, region, age, height_cm, job, ideal_type, training_years, consent_privacy, consent_content } = body as {
    sex?: string;
    name?: string;
    phone?: string;
    region?: string;
    age?: number | string;
    height_cm?: number;
    job?: string;
    ideal_type?: string;
    training_years?: number;
    consent_privacy?: boolean;
    consent_content?: boolean;
  };

  const normalizedSex = normalizeSex(sex);
  const parsedAge = toInteger(age);

  // 필수 필드 검증
  if (!normalizedSex) {
    return jsonError(400, "성별을 선택해주세요.", "VALIDATION_ERROR", "sex must be male|female");
  }
  if (!name || name.trim().length < 1 || name.trim().length > 20) {
    return jsonError(400, "이름을 입력해주세요. (1~20자)", "VALIDATION_ERROR", "name length must be 1-20");
  }
  if (!phone || phone.replace(/[^0-9]/g, "").length < 9 || phone.replace(/[^0-9]/g, "").length > 15) {
    return jsonError(400, "올바른 전화번호를 입력해주세요.", "VALIDATION_ERROR", "phone length must be 9-15");
  }
  if (!region || !REGIONS.includes(region)) {
    return jsonError(400, "지역을 선택해주세요.", "VALIDATION_ERROR", "invalid region");
  }
  if (parsedAge == null || parsedAge < 19 || parsedAge > 99) {
    return jsonError(400, "나이를 올바르게 입력해주세요. (19~99세)", "VALIDATION_ERROR", "age must be 19-99");
  }
  if (!height_cm || height_cm < 120 || height_cm > 220) {
    return jsonError(400, "키를 올바르게 입력해주세요. (120~220cm)", "VALIDATION_ERROR", "height_cm must be 120-220");
  }
  if (!job || job.trim().length < 1 || job.trim().length > 50) {
    return jsonError(400, "직업을 입력해주세요. (1~50자)", "VALIDATION_ERROR", "job length must be 1-50");
  }
  if (!ideal_type || ideal_type.trim().length < 1 || ideal_type.trim().length > 1000) {
    return jsonError(400, "이상형을 입력해주세요. (1~1000자)", "VALIDATION_ERROR", "ideal_type length must be 1-1000");
  }
  if (training_years == null || training_years < 0 || training_years > 30) {
    return jsonError(400, "운동경력을 입력해주세요. (0~30년)", "VALIDATION_ERROR", "training_years must be 0-30");
  }
  if (!consent_privacy) {
    return jsonError(400, "개인정보 수집·이용에 동의해주세요.", "VALIDATION_ERROR", "consent_privacy must be true");
  }

  const adminClient = createAdminClient();

  // 남자: 3대 인증 approved 체크
  if (normalizedSex === "male") {
    const { data: cert, error: certError } = await adminClient
      .from("cert_requests")
      .select("id")
      .eq("user_id", user.id)
      .eq("status", "approved")
      .limit(1)
      .maybeSingle();

    if (certError) {
      console.error("[POST /api/dating/apply] cert check failed", certError);
      return jsonError(500, "인증 상태 확인에 실패했습니다.", "CERT_CHECK_FAILED", formatDbError(certError));
    }

    if (!cert) {
      return jsonError(
        403,
        "남성은 3대 인증(승인 완료)이 필요합니다. 먼저 인증을 완료해주세요.",
        "MALE_CERT_REQUIRED"
      );
    }
  }

  // 7일 중복 체크
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: recent, error: recentError } = await adminClient
    .from("dating_applications")
    .select("id")
    .eq("user_id", user.id)
    .in("status", ["submitted", "reviewing"])
    .gte("created_at", sevenDaysAgo)
    .limit(1)
    .maybeSingle();

  if (recentError) {
    console.error("[POST /api/dating/apply] duplicate check failed", recentError);
    return jsonError(500, "기존 신청 확인에 실패했습니다.", "DUPLICATE_CHECK_FAILED", formatDbError(recentError));
  }

  if (recent) {
    return jsonError(
      429,
      "7일 이내에 이미 신청하셨습니다. 기존 신청이 처리된 후 다시 신청해주세요.",
      "DUPLICATE_RECENT_APPLICATION"
    );
  }

  const { data: profile, error: profileError } = await adminClient
    .from("profiles")
    .select("nickname")
    .eq("user_id", user.id)
    .maybeSingle();

  if (profileError) {
    console.error("[POST /api/dating/apply] profile read failed", profileError);
  }

  const displayNickname =
    typeof profile?.nickname === "string" && profile.nickname.trim().length > 0
      ? profile.nickname.trim().slice(0, 20)
      : name.trim().slice(0, 20);

  // INSERT (admin client로 insert)
  const cleanPhone = phone.replace(/[^0-9]/g, "");
  const { data: app, error } = await adminClient
    .from("dating_applications")
    .insert({
      user_id: user.id,
      sex: normalizedSex,
      name: name.trim(),
      phone: cleanPhone,
      region,
      age: parsedAge,
      height_cm: Math.round(height_cm),
      job: job.trim(),
      ideal_type: ideal_type.trim(),
      training_years: Math.round(training_years),
      display_nickname: displayNickname,
      consent_privacy: !!consent_privacy,
      consent_content: !!consent_content,
      status: "submitted",
    })
    .select("id")
    .single();

  if (error) {
    console.error("[POST /api/dating/apply] insert failed", error);
    return jsonError(500, "신청 생성에 실패했습니다.", "DB_INSERT_FAILED", formatDbError(error));
  }

  return NextResponse.json({ id: app.id }, { status: 201 });
}
