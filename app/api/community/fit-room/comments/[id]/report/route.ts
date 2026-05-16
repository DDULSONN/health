import { NextResponse } from "next/server";
import { ensureAllowedMutationOrigin } from "@/lib/request-origin";
import { checkRouteRateLimit, extractClientIp } from "@/lib/request-rate-limit";
import { createAdminClient, createClient } from "@/lib/supabase/server";

type RouteCtx = { params: Promise<{ id: string }> };

const REPORT_REASONS = new Set(["inappropriate", "spam", "privacy", "abuse", "other"]);

function cleanDetail(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
}

function cleanReason(value: unknown) {
  const reason = String(value ?? "").trim();
  return REPORT_REASONS.has(reason) ? reason : "other";
}

function isMissingReportTable(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = String((error as { code?: unknown }).code ?? "");
  const message = String((error as { message?: unknown }).message ?? "").toLowerCase();
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    message.includes("community_fit_room_reports") ||
    message.includes("could not find the table") ||
    message.includes("does not exist") ||
    message.includes("schema cache")
  );
}

function isDuplicateReport(error: unknown) {
  if (!error || typeof error !== "object") return false;
  return String((error as { code?: unknown }).code ?? "") === "23505";
}

async function getUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export async function POST(request: Request, { params }: RouteCtx) {
  const originError = ensureAllowedMutationOrigin(request);
  if (originError) return originError;

  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "로그인 후 신고할 수 있습니다." }, { status: 401 });
  }

  const requestId = crypto.randomUUID();
  const ip = extractClientIp(request);
  const rateLimit = await checkRouteRateLimit({
    requestId,
    scope: "community-fit-room-report",
    userId: user.id,
    ip,
    userLimitPerMin: 8,
    ipLimitPerMin: 40,
    path: "/api/community/fit-room/comment-report",
  });
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: "신고 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." }, { status: 429 });
  }

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { reason?: unknown; detail?: unknown };
  const reason = cleanReason(body.reason);
  const detail = cleanDetail(body.detail);

  if (!detail) {
    return NextResponse.json({ error: "신고 사유를 간단히 입력해 주세요." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: comment, error: commentError } = await admin
    .from("community_fit_room_comments")
    .select("id,user_id,entry_id,deleted_at")
    .eq("id", id)
    .maybeSingle();

  if (commentError || !comment || comment.deleted_at) {
    return NextResponse.json({ error: "신고할 댓글을 찾지 못했습니다." }, { status: 404 });
  }

  if (comment.user_id === user.id) {
    return NextResponse.json({ error: "내가 쓴 댓글은 신고할 수 없습니다." }, { status: 400 });
  }

  const { data, error } = await admin
    .from("community_fit_room_reports")
    .insert({
      reporter_user_id: user.id,
      comment_id: id,
      target_user_id: comment.user_id,
      reason,
      detail,
    })
    .select("id")
    .single();

  if (error) {
    if (isDuplicateReport(error)) {
      return NextResponse.json({ ok: true, duplicate: true, message: "이미 신고가 접수되었습니다." });
    }
    if (isMissingReportTable(error)) {
      return NextResponse.json(
        { error: "신고 DB가 아직 적용되지 않았습니다. supabase/sql/community_fit_room.sql을 실행해 주세요." },
        { status: 503 },
      );
    }
    console.error("[POST /api/community/fit-room/comments/[id]/report] failed", error);
    return NextResponse.json({ error: "신고 접수에 실패했습니다." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id: data.id });
}
