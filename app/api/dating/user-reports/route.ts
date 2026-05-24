import {
  buildDatingCardReportReasonText,
  isDatingCardReportReasonCode,
  type DatingCardReportReasonCode,
} from "@/lib/dating-report-reasons";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

type DatingUserReportTargetType =
  | "open_card_application"
  | "paid_card_application"
  | "one_on_one_card"
  | "one_on_one_match";

type ReportBody = {
  target_type?: unknown;
  target_id?: unknown;
  reason_code?: unknown;
  detail?: unknown;
};

type ResolvedReportTarget = {
  reportedUserId: string;
  targetCardId: string | null;
};

const TARGET_TYPES = new Set<DatingUserReportTargetType>([
  "open_card_application",
  "paid_card_application",
  "one_on_one_card",
  "one_on_one_match",
]);

function asText(value: unknown, max = 1000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function isUuidLike(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function safeMaybeSingle<T>(
  query: PromiseLike<{ data: T | null; error: { message?: string } | null }>
): Promise<T | null> {
  const { data, error } = await query;
  if (error) console.error("[dating user report] snapshot query failed", error);
  return data ?? null;
}

async function resolveOpenCardApplicationTarget(
  admin: ReturnType<typeof createAdminClient>,
  reporterUserId: string,
  targetId: string
): Promise<ResolvedReportTarget | null> {
  const appRes = await admin
    .from("dating_card_applications")
    .select("id,card_id,applicant_user_id")
    .eq("id", targetId)
    .maybeSingle();

  if (appRes.error || !appRes.data) {
    if (appRes.error) console.error("[dating user report] open application load failed", appRes.error);
    return null;
  }

  const cardRes = await admin
    .from("dating_cards")
    .select("id,owner_user_id")
    .eq("id", appRes.data.card_id)
    .maybeSingle();

  if (cardRes.error || !cardRes.data) {
    if (cardRes.error) console.error("[dating user report] open card load failed", cardRes.error);
    return null;
  }

  if (cardRes.data.owner_user_id === reporterUserId) {
    return { reportedUserId: appRes.data.applicant_user_id, targetCardId: cardRes.data.id };
  }

  if (appRes.data.applicant_user_id === reporterUserId) {
    return { reportedUserId: cardRes.data.owner_user_id, targetCardId: cardRes.data.id };
  }

  return null;
}

async function resolvePaidCardApplicationTarget(
  admin: ReturnType<typeof createAdminClient>,
  reporterUserId: string,
  targetId: string
): Promise<ResolvedReportTarget | null> {
  const appRes = await admin
    .from("dating_paid_card_applications")
    .select("id,paid_card_id,applicant_user_id")
    .eq("id", targetId)
    .maybeSingle();

  if (appRes.error || !appRes.data) {
    if (appRes.error) console.error("[dating user report] paid application load failed", appRes.error);
    return null;
  }

  const cardRes = await admin
    .from("dating_paid_cards")
    .select("id,user_id")
    .eq("id", appRes.data.paid_card_id)
    .maybeSingle();

  if (cardRes.error || !cardRes.data) {
    if (cardRes.error) console.error("[dating user report] paid card load failed", cardRes.error);
    return null;
  }

  if (cardRes.data.user_id === reporterUserId) {
    return { reportedUserId: appRes.data.applicant_user_id, targetCardId: cardRes.data.id };
  }

  if (appRes.data.applicant_user_id === reporterUserId) {
    return { reportedUserId: cardRes.data.user_id, targetCardId: cardRes.data.id };
  }

  return null;
}

async function resolveOneOnOneCardTarget(
  admin: ReturnType<typeof createAdminClient>,
  reporterUserId: string,
  targetId: string
): Promise<ResolvedReportTarget | null> {
  const cardRes = await admin
    .from("dating_1on1_cards")
    .select("id,user_id,status")
    .eq("id", targetId)
    .maybeSingle();

  if (cardRes.error || !cardRes.data) {
    if (cardRes.error) console.error("[dating user report] 1on1 card load failed", cardRes.error);
    return null;
  }

  if (cardRes.data.user_id === reporterUserId) return null;

  const ownCardRes = await admin
    .from("dating_1on1_cards")
    .select("id")
    .eq("user_id", reporterUserId)
    .in("status", ["submitted", "reviewing", "approved"])
    .limit(1);

  if (ownCardRes.error || (ownCardRes.data ?? []).length === 0) {
    if (ownCardRes.error) console.error("[dating user report] own 1on1 card check failed", ownCardRes.error);
    return null;
  }

  return { reportedUserId: cardRes.data.user_id, targetCardId: cardRes.data.id };
}

async function resolveOneOnOneMatchTarget(
  admin: ReturnType<typeof createAdminClient>,
  reporterUserId: string,
  targetId: string
): Promise<ResolvedReportTarget | null> {
  const matchRes = await admin
    .from("dating_1on1_match_proposals")
    .select("id,source_user_id,candidate_user_id,source_card_id,candidate_card_id")
    .eq("id", targetId)
    .maybeSingle();

  if (matchRes.error || !matchRes.data) {
    if (matchRes.error) console.error("[dating user report] 1on1 match load failed", matchRes.error);
    return null;
  }

  if (matchRes.data.source_user_id === reporterUserId) {
    return {
      reportedUserId: matchRes.data.candidate_user_id,
      targetCardId: matchRes.data.candidate_card_id,
    };
  }

  if (matchRes.data.candidate_user_id === reporterUserId) {
    return {
      reportedUserId: matchRes.data.source_user_id,
      targetCardId: matchRes.data.source_card_id,
    };
  }

  return null;
}

async function resolveReportTarget(
  admin: ReturnType<typeof createAdminClient>,
  reporterUserId: string,
  targetType: DatingUserReportTargetType,
  targetId: string
) {
  if (targetType === "open_card_application") {
    return resolveOpenCardApplicationTarget(admin, reporterUserId, targetId);
  }
  if (targetType === "paid_card_application") {
    return resolvePaidCardApplicationTarget(admin, reporterUserId, targetId);
  }
  if (targetType === "one_on_one_card") {
    return resolveOneOnOneCardTarget(admin, reporterUserId, targetId);
  }
  return resolveOneOnOneMatchTarget(admin, reporterUserId, targetId);
}

async function buildEvidenceSnapshot(
  admin: ReturnType<typeof createAdminClient>,
  reporterUserId: string,
  reportedUserId: string,
  targetType: DatingUserReportTargetType,
  targetId: string,
  targetCardId: string | null
) {
  const [reporterProfile, reportedProfile] = await Promise.all([
    safeMaybeSingle(
      admin.from("profiles").select("user_id,nickname,is_banned,banned_reason").eq("user_id", reporterUserId).maybeSingle()
    ),
    safeMaybeSingle(
      admin.from("profiles").select("user_id,nickname,is_banned,banned_reason").eq("user_id", reportedUserId).maybeSingle()
    ),
  ]);

  let target: unknown = null;
  let card: unknown = null;

  if (targetType === "open_card_application") {
    target = await safeMaybeSingle(admin.from("dating_card_applications").select("*").eq("id", targetId).maybeSingle());
    if (targetCardId) card = await safeMaybeSingle(admin.from("dating_cards").select("*").eq("id", targetCardId).maybeSingle());
  } else if (targetType === "paid_card_application") {
    target = await safeMaybeSingle(admin.from("dating_paid_card_applications").select("*").eq("id", targetId).maybeSingle());
    if (targetCardId) card = await safeMaybeSingle(admin.from("dating_paid_cards").select("*").eq("id", targetCardId).maybeSingle());
  } else if (targetType === "one_on_one_card") {
    card = await safeMaybeSingle(admin.from("dating_1on1_cards").select("*").eq("id", targetId).maybeSingle());
  } else {
    target = await safeMaybeSingle(admin.from("dating_1on1_match_proposals").select("*").eq("id", targetId).maybeSingle());
    if (targetCardId) card = await safeMaybeSingle(admin.from("dating_1on1_cards").select("*").eq("id", targetCardId).maybeSingle());
  }

  return {
    captured_at: new Date().toISOString(),
    target_type: targetType,
    target_id: targetId,
    target_card_id: targetCardId,
    reporter_profile: reporterProfile,
    reported_profile: reportedProfile,
    target,
    card,
  };
}

export async function POST(req: Request) {
  const { user } = await getRequestAuthContext(req);

  if (!user) {
    return NextResponse.json({ ok: false, message: "로그인이 필요합니다." }, { status: 401 });
  }

  const body = ((await req.json().catch(() => null)) ?? {}) as ReportBody;
  const targetType = asText(body.target_type, 80) as DatingUserReportTargetType;
  const targetId = asText(body.target_id, 80);
  const reasonCode = asText(body.reason_code, 80);
  const detail = asText(body.detail, 800);

  if (!TARGET_TYPES.has(targetType) || !isUuidLike(targetId)) {
    return NextResponse.json({ ok: false, message: "신고 대상을 확인해 주세요." }, { status: 400 });
  }

  const safeReasonCode: DatingCardReportReasonCode = isDatingCardReportReasonCode(reasonCode)
    ? reasonCode
    : "safety_risk";

  const admin = createAdminClient();
  const resolved = await resolveReportTarget(admin, user.id, targetType, targetId);

  if (!resolved || resolved.reportedUserId === user.id) {
    return NextResponse.json({ ok: false, message: "신고할 수 없는 대상입니다." }, { status: 403 });
  }

  const reason = buildDatingCardReportReasonText(safeReasonCode, detail);
  const evidenceSnapshot = await buildEvidenceSnapshot(
    admin,
    user.id,
    resolved.reportedUserId,
    targetType,
    targetId,
    resolved.targetCardId
  );

  const { error } = await admin.from("dating_user_reports").insert({
    reporter_user_id: user.id,
    reported_user_id: resolved.reportedUserId,
    target_type: targetType,
    target_id: targetId,
    target_card_id: resolved.targetCardId,
    reason,
    evidence_snapshot: evidenceSnapshot,
    evidence_preserved_at: evidenceSnapshot.captured_at,
  });

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ ok: false, message: "이미 신고한 대상입니다." }, { status: 409 });
    }
    console.error("[POST /api/dating/user-reports] failed", error);
    return NextResponse.json(
      { ok: false, message: "신고 저장에 실패했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
