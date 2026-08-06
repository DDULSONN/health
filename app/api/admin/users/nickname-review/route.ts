import { NextResponse } from "next/server";

import { recordAdminAuditEvent } from "@/lib/admin-audit";
import { requireAdminRoute } from "@/lib/admin-route";
import {
  isNicknameReviewTableMissing,
  scanNicknameReviews,
  type NicknameReviewStatus,
} from "@/lib/nickname-review";

const ALLOWED_STATUSES = new Set<NicknameReviewStatus>(["pending", "dismissed", "actioned", "cleared"]);

function missingTableResponse() {
  return NextResponse.json(
    { error: "닉네임 검수 SQL을 먼저 적용해 주세요.", code: "NICKNAME_REVIEW_TABLE_MISSING" },
    { status: 503 }
  );
}

export async function GET(request: Request) {
  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const requestedStatus = url.searchParams.get("status") ?? "pending";
  const status = requestedStatus === "all" || ALLOWED_STATUSES.has(requestedStatus as NicknameReviewStatus)
    ? requestedStatus
    : "pending";

  let query = auth.admin
    .from("admin_nickname_reviews")
    .select(
      "id,user_id,nickname,suspicion_level,flags,status,first_detected_at,last_detected_at,reviewed_at,resolution_note",
      { count: "exact" }
    )
    .order("last_detected_at", { ascending: false })
    .limit(500);
  if (status !== "all") query = query.eq("status", status);

  const reviewResult = await query;
  if (reviewResult.error) {
    if (isNicknameReviewTableMissing(reviewResult.error)) return missingTableResponse();
    return NextResponse.json({ error: reviewResult.error.message }, { status: 500 });
  }

  const rows = reviewResult.data ?? [];
  const userIds = Array.from(new Set(rows.map((row) => String(row.user_id)).filter(Boolean)));
  const profiles = new Map<string, { is_banned: boolean; banned_reason: string | null }>();
  for (let index = 0; index < userIds.length; index += 100) {
    const result = await auth.admin
      .from("profiles")
      .select("user_id,is_banned,banned_reason")
      .in("user_id", userIds.slice(index, index + 100));
    if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 });
    for (const profile of result.data ?? []) {
      profiles.set(String(profile.user_id), {
        is_banned: profile.is_banned === true,
        banned_reason: profile.banned_reason ? String(profile.banned_reason) : null,
      });
    }
  }

  return NextResponse.json({
    items: rows.map((row) => ({
      ...row,
      is_banned: profiles.get(String(row.user_id))?.is_banned ?? false,
      banned_reason: profiles.get(String(row.user_id))?.banned_reason ?? null,
    })),
    total: reviewResult.count ?? rows.length,
  });
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;

  try {
    const result = await scanNicknameReviews(auth.admin);
    await recordAdminAuditEvent({
      admin: auth.admin,
      adminUser: auth.user,
      request,
      action: "nickname_review_manual_scan",
      targetType: "profiles",
      requestId,
      metadata: result,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[admin/users/nickname-review] manual scan failed", error);
    if (isNicknameReviewTableMissing(error)) return missingTableResponse();
    return NextResponse.json({ error: "닉네임 전체 검수에 실패했습니다." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const requestId = crypto.randomUUID();
  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as {
    id?: unknown;
    status?: unknown;
    note?: unknown;
  };
  const id = String(body.id ?? "").trim();
  const status = String(body.status ?? "").trim() as NicknameReviewStatus;
  const note = String(body.note ?? "").trim().slice(0, 300) || null;
  if (!id || !ALLOWED_STATUSES.has(status)) {
    return NextResponse.json({ error: "검수 항목과 처리 상태를 확인해 주세요." }, { status: 400 });
  }

  const now = new Date().toISOString();
  const updateResult = await auth.admin
    .from("admin_nickname_reviews")
    .update({
      status,
      resolution_note: note,
      reviewed_at: status === "pending" ? null : now,
      reviewed_by_user_id: status === "pending" ? null : auth.user.id,
      updated_at: now,
    })
    .eq("id", id)
    .select("id,user_id,nickname,status")
    .maybeSingle();

  if (updateResult.error) {
    if (isNicknameReviewTableMissing(updateResult.error)) return missingTableResponse();
    return NextResponse.json({ error: updateResult.error.message }, { status: 500 });
  }
  if (!updateResult.data) return NextResponse.json({ error: "검수 항목을 찾지 못했습니다." }, { status: 404 });

  await recordAdminAuditEvent({
    admin: auth.admin,
    adminUser: auth.user,
    request,
    action: "nickname_review_status_update",
    targetType: "admin_nickname_review",
    targetId: id,
    requestId,
    metadata: { status, note, user_id: updateResult.data.user_id, nickname: updateResult.data.nickname },
  });

  return NextResponse.json({ ok: true, item: updateResult.data });
}
