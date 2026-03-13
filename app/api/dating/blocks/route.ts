import { createAdminClient } from "@/lib/supabase/server";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { NextResponse } from "next/server";

type ProfileRow = {
  user_id: string;
  nickname: string | null;
};

type CardRow = {
  owner_user_id: string;
  display_nickname: string | null;
  region: string | null;
  created_at: string;
};

export async function GET(req: Request) {
  const { user } = await getRequestAuthContext(req);

  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const admin = createAdminClient();
  const blocksRes = await admin
    .from("dating_user_blocks")
    .select("blocked_user_id, reason, created_at")
    .eq("blocker_user_id", user.id)
    .order("created_at", { ascending: false });

  if (blocksRes.error) {
    console.error("[GET /api/dating/blocks] blocks failed", blocksRes.error);
    return NextResponse.json({ error: "차단 목록을 불러오지 못했습니다." }, { status: 500 });
  }

  const blockedUserIds = [...new Set((blocksRes.data ?? []).map((row) => String(row.blocked_user_id ?? "")).filter(Boolean))];
  if (blockedUserIds.length === 0) {
    return NextResponse.json({ items: [] });
  }

  const [profilesRes, cardsRes] = await Promise.all([
    admin.from("profiles").select("user_id, nickname").in("user_id", blockedUserIds),
    admin
      .from("dating_cards")
      .select("owner_user_id, display_nickname, region, created_at")
      .in("owner_user_id", blockedUserIds)
      .order("created_at", { ascending: false })
      .limit(Math.max(blockedUserIds.length * 5, 20)),
  ]);

  if (profilesRes.error) {
    console.error("[GET /api/dating/blocks] profiles failed", profilesRes.error);
    return NextResponse.json({ error: "차단 목록을 불러오지 못했습니다." }, { status: 500 });
  }

  const profileMap = new Map(((profilesRes.data ?? []) as ProfileRow[]).map((row) => [row.user_id, row]));
  const latestCardByUserId = new Map<string, CardRow>();
  for (const row of (cardsRes.data ?? []) as CardRow[]) {
    if (!latestCardByUserId.has(row.owner_user_id)) {
      latestCardByUserId.set(row.owner_user_id, row);
    }
  }

  const items = (blocksRes.data ?? []).map((row) => {
    const blockedUserId = String(row.blocked_user_id ?? "");
    const profile = profileMap.get(blockedUserId) ?? null;
    const latestCard = latestCardByUserId.get(blockedUserId) ?? null;
    return {
      blocked_user_id: blockedUserId,
      reason: typeof row.reason === "string" ? row.reason : null,
      created_at: String(row.created_at ?? ""),
      nickname: profile?.nickname ?? null,
      latest_card: latestCard
        ? {
            display_nickname: latestCard.display_nickname,
            region: latestCard.region,
          }
        : null,
    };
  });

  return NextResponse.json({ items });
}

export async function POST(req: Request) {
  const { user } = await getRequestAuthContext(req);

  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as
    | {
        blocked_user_id?: string;
        reason?: string;
      }
    | null;

  const blockedUserId = String(body?.blocked_user_id ?? "").trim();
  const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 300) : null;

  if (!blockedUserId) {
    return NextResponse.json({ error: "차단할 사용자를 찾을 수 없습니다." }, { status: 400 });
  }
  if (blockedUserId === user.id) {
    return NextResponse.json({ error: "본인은 차단할 수 없습니다." }, { status: 400 });
  }

  const admin = createAdminClient();
  const insertRes = await admin
    .from("dating_user_blocks")
    .upsert(
      {
        blocker_user_id: user.id,
        blocked_user_id: blockedUserId,
        reason,
      },
      { onConflict: "blocker_user_id,blocked_user_id" }
    )
    .select("blocked_user_id, reason, created_at")
    .single();

  if (insertRes.error) {
    console.error("[POST /api/dating/blocks] upsert failed", insertRes.error);
    return NextResponse.json({ error: "차단 처리에 실패했습니다." }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    item: {
      blocked_user_id: insertRes.data.blocked_user_id,
      reason: insertRes.data.reason,
      created_at: insertRes.data.created_at,
    },
  });
}
