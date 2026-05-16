import { NextResponse } from "next/server";
import { requireAdminRoute } from "@/lib/admin-route";
import { ensureAllowedMutationOrigin } from "@/lib/request-origin";
import { checkRouteRateLimit, extractClientIp } from "@/lib/request-rate-limit";

type RouteCtx = { params: Promise<{ id: string }> };

function cleanComment(value: unknown) {
  return String(value ?? "").trim().replace(/\s{3,}/g, " ").slice(0, 220);
}

export async function POST(request: Request, { params }: RouteCtx) {
  const originError = ensureAllowedMutationOrigin(request);
  if (originError) return originError;

  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;

  const requestId = crypto.randomUUID();
  const ip = extractClientIp(request);
  const rateLimit = await checkRouteRateLimit({
    requestId,
    scope: "community-fit-room-comment",
    userId: auth.user.id,
    ip,
    userLimitPerMin: 20,
    ipLimitPerMin: 80,
    path: "/api/community/fit-room/comments",
  });
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: "댓글 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." }, { status: 429 });
  }

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { content?: unknown };
  const content = cleanComment(body.content);
  if (content.length < 1) {
    return NextResponse.json({ error: "댓글을 입력해 주세요." }, { status: 400 });
  }

  const { data: entry, error: entryError } = await auth.admin
    .from("community_fit_room_entries")
    .select("id,expires_at,deleted_at")
    .eq("id", id)
    .maybeSingle();

  if (entryError || !entry || entry.deleted_at || Date.parse(entry.expires_at) <= Date.now()) {
    return NextResponse.json({ error: "댓글을 남길 수 없는 인증입니다." }, { status: 404 });
  }

  const { data, error } = await auth.admin
    .from("community_fit_room_comments")
    .insert({
      entry_id: id,
      user_id: auth.user.id,
      content,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[POST /api/community/fit-room/[id]/comments] failed", error);
    return NextResponse.json({ error: "댓글 등록에 실패했습니다." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id: data.id });
}
