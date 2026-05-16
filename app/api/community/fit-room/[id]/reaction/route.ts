import { NextResponse } from "next/server";
import { ensureAllowedMutationOrigin } from "@/lib/request-origin";
import { checkRouteRateLimit, extractClientIp } from "@/lib/request-rate-limit";
import { createAdminClient, createClient } from "@/lib/supabase/server";

type RouteCtx = { params: Promise<{ id: string }> };

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
    return NextResponse.json({ error: "로그인 후 반응할 수 있습니다." }, { status: 401 });
  }

  const requestId = crypto.randomUUID();
  const ip = extractClientIp(request);
  const rateLimit = await checkRouteRateLimit({
    requestId,
    scope: "community-fit-room-reaction",
    userId: user.id,
    ip,
    userLimitPerMin: 60,
    ipLimitPerMin: 160,
    path: "/api/community/fit-room/reaction",
  });
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: "반응 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." }, { status: 429 });
  }

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { reaction?: unknown };
  const reaction = body.reaction === "up" || body.reaction === "down" ? body.reaction : "none";
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
    return NextResponse.json({ error: "반응할 수 없는 인증입니다." }, { status: 404 });
  }

  if (reaction === "none") {
    const { error } = await admin.from("community_fit_room_reactions").delete().eq("entry_id", id).eq("user_id", user.id);
    if (error) {
      console.error("[POST /api/community/fit-room/[id]/reaction] delete failed", error);
      return NextResponse.json({ error: "반응 취소에 실패했습니다." }, { status: 500 });
    }
    return NextResponse.json({ ok: true, reaction: null });
  }

  const { error } = await admin.from("community_fit_room_reactions").upsert(
    {
      entry_id: id,
      user_id: user.id,
      reaction,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "entry_id,user_id" },
  );

  if (error) {
    console.error("[POST /api/community/fit-room/[id]/reaction] upsert failed", error);
    return NextResponse.json({ error: "반응 저장에 실패했습니다." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, reaction });
}
