import { NextResponse } from "next/server";

import {
  APP_TEST_APPLICATION_TABLE,
  APP_TEST_FEEDBACK_TABLE,
  APP_TEST_STATUSES,
  isAppTestTableMissing,
  type AppTestStatus,
} from "@/lib/app-testing";
import { requireAdminRoute } from "@/lib/admin-route";
import { ensureAllowedMutationOrigin } from "@/lib/request-origin";

const APPLICATION_SELECT =
  "id,user_id,play_email,platform,status,consented_at,invited_at,created_at,updated_at";
const FEEDBACK_SELECT =
  "id,application_id,user_id,category,message,device_model,app_version,created_at";

type AppTestFeedbackRow = {
  id: string;
  application_id: string;
  user_id: string;
  category: string;
  message: string;
  device_model: string | null;
  app_version: string | null;
  created_at: string;
};

function missingTableResponse(error: unknown) {
  if (!isAppTestTableMissing(error)) return null;
  return NextResponse.json({ error: "앱 테스트 신청 테이블이 아직 적용되지 않았습니다." }, { status: 503 });
}

export async function GET() {
  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;

  const applicationsRes = await auth.admin
    .from(APP_TEST_APPLICATION_TABLE)
    .select(APPLICATION_SELECT)
    .order("created_at", { ascending: false })
    .limit(500);
  if (applicationsRes.error) {
    const missingResponse = missingTableResponse(applicationsRes.error);
    if (missingResponse) return missingResponse;
    console.error("[GET /api/admin/app-testers] applications failed", applicationsRes.error);
    return NextResponse.json({ error: "앱 테스트 신청자를 불러오지 못했습니다." }, { status: 500 });
  }

  const applications = applicationsRes.data ?? [];
  const applicationIds = applications.map((item) => item.id);
  const userIds = [...new Set(applications.map((item) => item.user_id).filter(Boolean))];

  const [feedbackRes, profilesRes] = await Promise.all([
    applicationIds.length > 0
      ? auth.admin
          .from(APP_TEST_FEEDBACK_TABLE)
          .select(FEEDBACK_SELECT)
          .in("application_id", applicationIds)
          .order("created_at", { ascending: false })
          .limit(2000)
      : Promise.resolve({ data: [], error: null }),
    userIds.length > 0
      ? auth.admin.from("profiles").select("user_id,nickname").in("user_id", userIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (feedbackRes.error) {
    const missingResponse = missingTableResponse(feedbackRes.error);
    if (missingResponse) return missingResponse;
    console.error("[GET /api/admin/app-testers] feedback failed", feedbackRes.error);
    return NextResponse.json({ error: "앱 테스트 피드백을 불러오지 못했습니다." }, { status: 500 });
  }
  if (profilesRes.error) {
    console.error("[GET /api/admin/app-testers] profiles failed", profilesRes.error);
  }

  const nicknameByUserId = new Map(
    (profilesRes.data ?? []).map((profile) => [String(profile.user_id), profile.nickname ?? null] as const)
  );
  const feedbackRows = (feedbackRes.data ?? []) as AppTestFeedbackRow[];
  const feedbackByApplicationId = new Map<string, AppTestFeedbackRow[]>();
  for (const feedback of feedbackRows) {
    const current = feedbackByApplicationId.get(feedback.application_id) ?? [];
    current.push(feedback);
    feedbackByApplicationId.set(feedback.application_id, current);
  }

  return NextResponse.json({
    ok: true,
    items: applications.map((application) => ({
      ...application,
      nickname: nicknameByUserId.get(application.user_id) ?? null,
      feedback: feedbackByApplicationId.get(application.id) ?? [],
    })),
  });
}

export async function PATCH(request: Request) {
  const originResponse = ensureAllowedMutationOrigin(request);
  if (originResponse) return originResponse;

  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => null)) as { id?: unknown; status?: unknown } | null;
  const id = typeof body?.id === "string" ? body.id.trim() : "";
  const statusRaw = typeof body?.status === "string" ? body.status.trim() : "";
  if (!id || !APP_TEST_STATUSES.includes(statusRaw as AppTestStatus)) {
    return NextResponse.json({ error: "신청자와 변경할 상태를 확인해 주세요." }, { status: 400 });
  }

  const currentRes = await auth.admin
    .from(APP_TEST_APPLICATION_TABLE)
    .select("id,invited_at")
    .eq("id", id)
    .maybeSingle();
  if (currentRes.error) {
    const missingResponse = missingTableResponse(currentRes.error);
    if (missingResponse) return missingResponse;
    return NextResponse.json({ error: "신청 상태를 확인하지 못했습니다." }, { status: 500 });
  }
  if (!currentRes.data) return NextResponse.json({ error: "신청자를 찾지 못했습니다." }, { status: 404 });

  const status = statusRaw as AppTestStatus;
  const nowIso = new Date().toISOString();
  const updateRes = await auth.admin
    .from(APP_TEST_APPLICATION_TABLE)
    .update({
      status,
      invited_at: status === "pending" ? null : currentRes.data.invited_at ?? nowIso,
      updated_at: nowIso,
    })
    .eq("id", id)
    .select(APPLICATION_SELECT)
    .maybeSingle();

  if (updateRes.error) {
    const missingResponse = missingTableResponse(updateRes.error);
    if (missingResponse) return missingResponse;
    console.error("[PATCH /api/admin/app-testers] update failed", updateRes.error);
    return NextResponse.json({ error: "앱 테스트 상태를 저장하지 못했습니다." }, { status: 500 });
  }
  if (!updateRes.data) return NextResponse.json({ error: "신청 상태가 변경되었습니다." }, { status: 409 });

  return NextResponse.json({ ok: true, item: updateRes.data });
}
