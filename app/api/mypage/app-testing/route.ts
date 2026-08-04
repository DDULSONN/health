import { NextResponse } from "next/server";

import {
  APP_TEST_APPLICATION_TABLE,
  APP_TEST_FEEDBACK_CATEGORIES,
  APP_TEST_FEEDBACK_TABLE,
  isAppTestTableMissing,
  type AppTestFeedbackCategory,
} from "@/lib/app-testing";
import { ensureAllowedMutationOrigin } from "@/lib/request-origin";
import { createAdminClient } from "@/lib/supabase/server";
import { getRequestAuthContext } from "@/lib/supabase/request";

const APPLICATION_SELECT =
  "id,user_id,play_email,platform,status,consented_at,invited_at,created_at,updated_at";
const FEEDBACK_SELECT = "id,application_id,category,message,device_model,app_version,created_at";

function normalizeEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function isValidEmail(value: string) {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function normalizeShortText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function tableErrorResponse(error: unknown) {
  if (isAppTestTableMissing(error)) {
    return NextResponse.json({ error: "앱 테스트 신청 기능을 준비 중입니다." }, { status: 503 });
  }
  return null;
}

export async function GET(request: Request) {
  const { user } = await getRequestAuthContext(request);
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const admin = createAdminClient();
  const applicationRes = await admin
    .from(APP_TEST_APPLICATION_TABLE)
    .select(APPLICATION_SELECT)
    .eq("user_id", user.id)
    .maybeSingle();

  if (applicationRes.error) {
    const missingResponse = tableErrorResponse(applicationRes.error);
    if (missingResponse) return missingResponse;
    console.error("[GET /api/mypage/app-testing] application failed", applicationRes.error);
    return NextResponse.json({ error: "앱 테스트 신청 상태를 불러오지 못했습니다." }, { status: 500 });
  }

  if (!applicationRes.data) {
    return NextResponse.json({ ok: true, application: null, feedback: [] });
  }

  const feedbackRes = await admin
    .from(APP_TEST_FEEDBACK_TABLE)
    .select(FEEDBACK_SELECT)
    .eq("application_id", applicationRes.data.id)
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(20);

  if (feedbackRes.error) {
    const missingResponse = tableErrorResponse(feedbackRes.error);
    if (missingResponse) return missingResponse;
    console.error("[GET /api/mypage/app-testing] feedback failed", feedbackRes.error);
    return NextResponse.json({ error: "앱 테스트 피드백을 불러오지 못했습니다." }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    application: applicationRes.data,
    feedback: feedbackRes.data ?? [],
  });
}

export async function POST(request: Request) {
  const originResponse = ensureAllowedMutationOrigin(request);
  if (originResponse) return originResponse;

  const { user } = await getRequestAuthContext(request);
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const body = (await request.json().catch(() => null)) as
    | {
        action?: unknown;
        play_email?: unknown;
        consent?: unknown;
        category?: unknown;
        message?: unknown;
        device_model?: unknown;
        app_version?: unknown;
      }
    | null;
  if (!body) return NextResponse.json({ error: "요청 내용을 확인할 수 없습니다." }, { status: 400 });

  const admin = createAdminClient();
  const action = body.action === "feedback" ? "feedback" : body.action === "apply" ? "apply" : "";
  if (!action) return NextResponse.json({ error: "요청 유형이 올바르지 않습니다." }, { status: 400 });

  const existingRes = await admin
    .from(APP_TEST_APPLICATION_TABLE)
    .select(APPLICATION_SELECT)
    .eq("user_id", user.id)
    .maybeSingle();
  if (existingRes.error) {
    const missingResponse = tableErrorResponse(existingRes.error);
    if (missingResponse) return missingResponse;
    console.error("[POST /api/mypage/app-testing] lookup failed", existingRes.error);
    return NextResponse.json({ error: "앱 테스트 신청 상태를 확인하지 못했습니다." }, { status: 500 });
  }

  if (action === "apply") {
    if (existingRes.data) {
      return NextResponse.json({ ok: true, application: existingRes.data, alreadyApplied: true });
    }

    const playEmail = normalizeEmail(body.play_email);
    if (!isValidEmail(playEmail)) {
      return NextResponse.json({ error: "Google Play에서 사용하는 이메일을 정확히 입력해 주세요." }, { status: 400 });
    }
    if (body.consent !== true) {
      return NextResponse.json({ error: "테스트 초대를 위한 이메일 수집·이용에 동의해 주세요." }, { status: 400 });
    }

    const nowIso = new Date().toISOString();
    const insertRes = await admin
      .from(APP_TEST_APPLICATION_TABLE)
      .insert({
        user_id: user.id,
        play_email: playEmail,
        platform: "android",
        status: "pending",
        consented_at: nowIso,
        user_agent: request.headers.get("user-agent")?.slice(0, 500) ?? null,
        created_at: nowIso,
        updated_at: nowIso,
      })
      .select(APPLICATION_SELECT)
      .single();

    if (insertRes.error) {
      const missingResponse = tableErrorResponse(insertRes.error);
      if (missingResponse) return missingResponse;
      if (insertRes.error.code === "23505") {
        return NextResponse.json({ error: "이미 등록된 Google Play 이메일입니다." }, { status: 409 });
      }
      console.error("[POST /api/mypage/app-testing] insert failed", insertRes.error);
      return NextResponse.json({ error: "앱 테스트 신청을 저장하지 못했습니다." }, { status: 500 });
    }

    return NextResponse.json({ ok: true, application: insertRes.data });
  }

  if (!existingRes.data) {
    return NextResponse.json({ error: "앱 테스트를 먼저 신청해 주세요." }, { status: 409 });
  }

  const message = normalizeShortText(body.message, 2000);
  if (message.length < 5) {
    return NextResponse.json({ error: "피드백을 5자 이상 입력해 주세요." }, { status: 400 });
  }
  const categoryRaw = normalizeShortText(body.category, 30);
  const category = APP_TEST_FEEDBACK_CATEGORIES.includes(categoryRaw as AppTestFeedbackCategory)
    ? (categoryRaw as AppTestFeedbackCategory)
    : "general";

  const feedbackRes = await admin
    .from(APP_TEST_FEEDBACK_TABLE)
    .insert({
      application_id: existingRes.data.id,
      user_id: user.id,
      category,
      message,
      device_model: normalizeShortText(body.device_model, 100) || null,
      app_version: normalizeShortText(body.app_version, 50) || null,
    })
    .select(FEEDBACK_SELECT)
    .single();

  if (feedbackRes.error) {
    const missingResponse = tableErrorResponse(feedbackRes.error);
    if (missingResponse) return missingResponse;
    console.error("[POST /api/mypage/app-testing] feedback insert failed", feedbackRes.error);
    return NextResponse.json({ error: "피드백을 저장하지 못했습니다." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, feedback: feedbackRes.data });
}

