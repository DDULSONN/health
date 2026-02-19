import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

function normalizeInstagramId(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(/^@+/, "").replace(/\s+/g, "");
}

function validInstagramId(value: string) {
  return /^[A-Za-z0-9._]{1,30}$/.test(value);
}

function toInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n)) return Math.round(n);
  }
  return null;
}

function toText(value: unknown, max = 2000): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

type DbErr = { code?: string; message?: string; details?: string; hint?: string };

function toDbErr(err: unknown): DbErr {
  if (!err || typeof err !== "object") return {};
  const e = err as Record<string, unknown>;
  return {
    code: typeof e.code === "string" ? e.code : undefined,
    message: typeof e.message === "string" ? e.message : undefined,
    details: typeof e.details === "string" ? e.details : undefined,
    hint: typeof e.hint === "string" ? e.hint : undefined,
  };
}

function mapDbError(code?: string) {
  if (code === "23505") return { status: 409, code: "DUPLICATE_APPLICATION", message: "이미 해당 카드에 지원하셨어요." };
  if (code === "23502") return { status: 400, code: "VALIDATION_ERROR", message: "필수 항목이 누락되었습니다." };
  if (code === "23503") return { status: 400, code: "VALIDATION_ERROR", message: "참조 데이터가 올바르지 않습니다." };
  if (code === "42501") return { status: 403, code: "FORBIDDEN", message: "권한이 없습니다." };
  if (code === "PGRST204") return { status: 503, code: "SCHEMA_MISMATCH", message: "서버 스키마 불일치로 잠시 처리할 수 없습니다." };
  return { status: 500, code: "DATABASE_ERROR", message: "지원 처리 중 오류가 발생했습니다." };
}

export async function POST(req: Request) {
  const requestId = crypto.randomUUID();
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ ok: false, code: "UNAUTHORIZED", requestId, message: "로그인이 필요합니다." }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ ok: false, code: "VALIDATION_ERROR", requestId, message: "잘못된 요청입니다." }, { status: 400 });
    }

    const input = body as Record<string, unknown>;
    const paidCardId = toText(input.paid_card_id, 100);
    const age = toInt(input.age);
    const heightCm = toInt(input.height_cm);
    const trainingYears = toInt(input.training_years);
    const region = toText(input.region, 30);
    const job = toText(input.job, 50);
    const introText = toText(input.intro_text, 1000);
    const instagramId = normalizeInstagramId(input.instagram_id);
    const consent = Boolean(input.consent);
    const photoPaths = Array.isArray(input.photo_paths)
      ? input.photo_paths.filter((item): item is string => typeof item === "string" && item.length > 0)
      : [];

    const fields: string[] = [];
    if (!paidCardId) fields.push("paid_card_id");
    if (!validInstagramId(instagramId)) fields.push("instagram_id");
    if (!introText) fields.push("intro_text");
    if (!consent) fields.push("consent");
    if (age == null || age < 19 || age > 99) fields.push("age");
    if (heightCm == null || heightCm < 120 || heightCm > 230) fields.push("height_cm");
    if (trainingYears == null || trainingYears < 0 || trainingYears > 50) fields.push("training_years");
    if (photoPaths.length !== 2) fields.push("photo_paths");
    if (!photoPaths.every((path) => path.startsWith(`paid-card-applications/${user.id}/`))) fields.push("photo_paths_prefix");
    if (fields.length > 0) {
      return NextResponse.json({ ok: false, code: "VALIDATION_ERROR", requestId, message: "입력값을 확인해주세요.", fields }, { status: 400 });
    }

    const profileRes = await supabase.from("profiles").select("nickname").eq("user_id", user.id).maybeSingle();
    if (profileRes.error) {
      const mapped = mapDbError(profileRes.error.code ?? undefined);
      return NextResponse.json({ ok: false, requestId, ...mapped }, { status: mapped.status });
    }
    const applicantDisplayNickname = toText(profileRes.data?.nickname ?? "", 20);
    if (!applicantDisplayNickname) {
      return NextResponse.json({ ok: false, code: "NICKNAME_REQUIRED", requestId, message: "닉네임 설정 후 이용 가능합니다.", profile_edit_url: "/mypage" }, { status: 400 });
    }

    const cardRes = await supabase
      .from("dating_paid_cards")
      .select("id,user_id,status,expires_at")
      .eq("id", paidCardId)
      .single();
    if (cardRes.error || !cardRes.data) {
      return NextResponse.json({ ok: false, code: "CARD_NOT_FOUND", requestId, message: "카드를 찾을 수 없습니다." }, { status: 404 });
    }

    const card = cardRes.data;
    if (card.user_id === user.id) {
      return NextResponse.json({ ok: false, code: "FORBIDDEN", requestId, message: "본인 카드에는 지원할 수 없습니다." }, { status: 403 });
    }
    if (card.status !== "approved" || !card.expires_at || new Date(card.expires_at).getTime() <= Date.now()) {
      return NextResponse.json({ ok: false, code: "CARD_EXPIRED", requestId, message: "카드가 만료되었거나 비공개입니다." }, { status: 410 });
    }

    const insertRes = await supabase
      .from("dating_paid_card_applications")
      .insert({
        paid_card_id: paidCardId,
        applicant_user_id: user.id,
        applicant_display_nickname: applicantDisplayNickname,
        age,
        height_cm: heightCm,
        region,
        job,
        training_years: trainingYears,
        intro_text: introText,
        instagram_id: instagramId,
        photo_paths: photoPaths,
        status: "submitted",
      })
      .select("id")
      .single();

    if (insertRes.error || !insertRes.data) {
      const mapped = mapDbError(insertRes.error?.code ?? undefined);
      return NextResponse.json({ ok: false, requestId, ...mapped }, { status: mapped.status });
    }

    return NextResponse.json({ ok: true, code: "SUCCESS", requestId, id: insertRes.data.id, message: "지원이 완료되었습니다." });
  } catch (error) {
    const e = toDbErr(error);
    console.error("[POST /api/dating/paid/apply] failed", {
      requestId,
      message: e.message,
      code: e.code,
      details: e.details,
      hint: e.hint,
    });
    return NextResponse.json({ ok: false, code: "INTERNAL_SERVER_ERROR", requestId, message: "지원 처리 중 오류가 발생했습니다." }, { status: 500 });
  }
}
