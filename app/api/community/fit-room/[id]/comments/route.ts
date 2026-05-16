import { NextResponse } from "next/server";
import { ensureAllowedMutationOrigin } from "@/lib/request-origin";
import { checkRouteRateLimit, extractClientIp } from "@/lib/request-rate-limit";
import { createAdminClient, createClient } from "@/lib/supabase/server";

type RouteCtx = { params: Promise<{ id: string }> };

function cleanComment(value: unknown) {
  return String(value ?? "").trim().replace(/\s{3,}/g, " ").slice(0, 220);
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
    return NextResponse.json({ error: "로그인 후 댓글을 남길 수 있습니다." }, { status: 401 });
  }

  const requestId = crypto.randomUUID();
  const ip = extractClientIp(request);
  const rateLimit = await checkRouteRateLimit({
    requestId,
    scope: "community-fit-room-comment",
    userId: user.id,
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

  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("is_banned").eq("user_id", user.id).maybeSingle();
  if (profile?.is_banned) {
    return NextResponse.json({ error: "커뮤니티 이용이 제한된 계정입니다." }, { status: 403 });
  }

  const { data: entry, error: entryError } = await admin
    .from("community_fit_room_entries")
    .select("id,expires_at,deleted_at")
    .eq("id", id)
    .maybeSingle();

  if (entryError || !entry || entry.deleted_at || Date.parse(entry.expires_at) <= Date.now()) {
    return NextResponse.json({ error: "댓글을 남길 수 없는 인증입니다." }, { status: 404 });
  }

  const { data, error } = await admin
    .from("community_fit_room_comments")
    .insert({
      entry_id: id,
      user_id: user.id,
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
