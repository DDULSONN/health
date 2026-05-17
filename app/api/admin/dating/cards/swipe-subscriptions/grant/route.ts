import { isAllowedAdminUser } from "@/lib/admin";
import { grantSwipeSubscription } from "@/lib/dating-purchase-fulfillment";
import {
  SWIPE_PREMIUM_DAILY_LIMIT,
  SWIPE_PREMIUM_DURATION_DAYS,
  SWIPE_PREMIUM_PRICE_KRW,
} from "@/lib/dating-swipe";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

type SearchCandidate = {
  userId: string;
  nickname: string | null;
  email: string | null;
  activeUntil: string | null;
  pending: boolean;
};

function normalizeQuery(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function escapeLike(value: string) {
  return value.replace(/[%_]/g, (match) => `\\${match}`);
}

async function ensureAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user || !isAllowedAdminUser(user.id, user.email)) {
    return null;
  }

  return user;
}

async function searchByEmail(admin: ReturnType<typeof createAdminClient>, query: string) {
  const lowered = query.toLowerCase();
  const hits: Array<{ userId: string; email: string | null }> = [];

  for (let page = 1; page <= 5; page += 1) {
    const res = await admin.auth.admin.listUsers({ page, perPage: 200 });
    const users = res.data?.users ?? [];

    for (const user of users) {
      const email = user.email?.trim() ?? null;
      if (!email || !email.toLowerCase().includes(lowered)) continue;
      hits.push({ userId: user.id, email });
    }

    if (users.length < 200 || hits.length >= 20) break;
  }

  return hits.slice(0, 20);
}

export async function GET(req: Request) {
  const adminUser = await ensureAdmin();
  if (!adminUser) {
    return NextResponse.json({ ok: false, message: "권한이 없습니다." }, { status: 403 });
  }

  const query = normalizeQuery(new URL(req.url).searchParams.get("query"));
  if (query.length < 2) {
    return NextResponse.json({ ok: true, items: [] });
  }

  const admin = createAdminClient();
  const candidateMap = new Map<string, SearchCandidate>();

  const profileRes = await admin
    .from("profiles")
    .select("user_id,nickname")
    .ilike("nickname", `%${escapeLike(query)}%`)
    .limit(20);

  if (profileRes.error) {
    return NextResponse.json({ ok: false, message: "유저 검색에 실패했습니다." }, { status: 500 });
  }

  for (const row of profileRes.data ?? []) {
    const userId = String(row.user_id ?? "").trim();
    if (!userId) continue;
    candidateMap.set(userId, {
      userId,
      nickname: typeof row.nickname === "string" ? row.nickname : null,
      email: null,
      activeUntil: null,
      pending: false,
    });
  }

  const emailHits = await searchByEmail(admin, query);
  for (const row of emailHits) {
    const existing = candidateMap.get(row.userId);
    candidateMap.set(row.userId, {
      userId: row.userId,
      nickname: existing?.nickname ?? null,
      email: row.email,
      activeUntil: existing?.activeUntil ?? null,
      pending: existing?.pending ?? false,
    });
  }

  const userIds = [...candidateMap.keys()];
  if (userIds.length === 0) {
    return NextResponse.json({ ok: true, items: [] });
  }

  const missingNicknameIds = userIds.filter((userId) => !candidateMap.get(userId)?.nickname);
  if (missingNicknameIds.length > 0) {
    const nicknameRes = await admin.from("profiles").select("user_id,nickname").in("user_id", missingNicknameIds);
    if (Array.isArray(nicknameRes.data)) {
      for (const row of nicknameRes.data) {
        const userId = String(row.user_id ?? "").trim();
        if (!userId || !candidateMap.has(userId)) continue;
        candidateMap.set(userId, {
          ...(candidateMap.get(userId) as SearchCandidate),
          nickname: typeof row.nickname === "string" ? row.nickname : null,
        });
      }
    }
  }

  const subscriptionRes = await admin
    .from("dating_swipe_subscription_requests")
    .select("user_id,status,expires_at,requested_at")
    .in("user_id", userIds)
    .in("status", ["pending", "approved"]);

  if (subscriptionRes.error) {
    return NextResponse.json({ ok: false, message: "빠른매칭 플러스 상태를 불러오지 못했습니다." }, { status: 500 });
  }

  const now = Date.now();
  for (const row of subscriptionRes.data ?? []) {
    const userId = String(row.user_id ?? "").trim();
    if (!userId || !candidateMap.has(userId)) continue;
    const current = candidateMap.get(userId) as SearchCandidate;

    if (row.status === "pending") {
      current.pending = true;
      continue;
    }

    const expiresAt = typeof row.expires_at === "string" ? new Date(row.expires_at).getTime() : NaN;
    if (row.status === "approved" && Number.isFinite(expiresAt) && expiresAt > now) {
      if (!current.activeUntil || new Date(current.activeUntil).getTime() < expiresAt) {
        current.activeUntil = new Date(expiresAt).toISOString();
      }
    }
  }

  const items = [...candidateMap.values()]
    .sort((a, b) => {
      const aName = (a.nickname ?? a.email ?? a.userId).toLowerCase();
      const bName = (b.nickname ?? b.email ?? b.userId).toLowerCase();
      return aName.localeCompare(bName, "ko");
    })
    .slice(0, 20);

  return NextResponse.json({ ok: true, items });
}

export async function POST(req: Request) {
  const adminUser = await ensureAdmin();
  if (!adminUser) {
    return NextResponse.json({ ok: false, message: "권한이 없습니다." }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as { userId?: unknown } | null;
  const userId = normalizeQuery(body?.userId);

  if (!userId) {
    return NextResponse.json({ ok: false, message: "대상 유저를 선택해주세요." }, { status: 400 });
  }

  const admin = createAdminClient();
  const grant = await grantSwipeSubscription(admin, {
    userId,
    amount: SWIPE_PREMIUM_PRICE_KRW,
    dailyLimit: SWIPE_PREMIUM_DAILY_LIMIT,
    durationDays: SWIPE_PREMIUM_DURATION_DAYS,
    note: `admin manual grant by ${adminUser.email ?? adminUser.id}`,
  }).catch((error) => {
    console.error("[admin-swipe-subscription-grant] failed", error);
    return null;
  });

  if (!grant) {
    return NextResponse.json({ ok: false, message: "빠른매칭 플러스 지급에 실패했습니다." }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    message: `빠른매칭 플러스를 ${SWIPE_PREMIUM_DURATION_DAYS}일 동안 바로 적용했습니다.`,
    item: grant,
  });
}
