import { isAllowedAdminUser } from "@/lib/admin";
import { grantMoreViewAccess } from "@/lib/dating-purchase-fulfillment";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

type MoreViewSex = "male" | "female";

type SearchCandidate = {
  userId: string;
  nickname: string | null;
  email: string | null;
  activeSexes: MoreViewSex[];
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
      if (!email) continue;
      if (!email.toLowerCase().includes(lowered)) continue;
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
      activeSexes: [],
    });
  }

  const emailHits = await searchByEmail(admin, query);
  for (const row of emailHits) {
    const existing = candidateMap.get(row.userId);
    candidateMap.set(row.userId, {
      userId: row.userId,
      nickname: existing?.nickname ?? null,
      email: row.email,
      activeSexes: existing?.activeSexes ?? [],
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

  const activeRes = await admin
    .from("dating_more_view_requests")
    .select("user_id,sex,access_expires_at")
    .in("user_id", userIds)
    .eq("status", "approved");

  if (activeRes.error) {
    return NextResponse.json({ ok: false, message: "현재 열람 상태를 불러오지 못했습니다." }, { status: 500 });
  }

  const now = Date.now();
  for (const row of activeRes.data ?? []) {
    const userId = String(row.user_id ?? "").trim();
    if (!userId || !candidateMap.has(userId)) continue;
    const expiresAt = typeof row.access_expires_at === "string" ? new Date(row.access_expires_at).getTime() : NaN;
    if (!Number.isFinite(expiresAt) || expiresAt <= now) continue;
    const sex = row.sex === "female" ? "female" : row.sex === "male" ? "male" : null;
    if (!sex) continue;
    const current = candidateMap.get(userId) as SearchCandidate;
    if (!current.activeSexes.includes(sex)) {
      current.activeSexes.push(sex);
    }
  }

  const items = [...candidateMap.values()]
    .map((item) => ({
      ...item,
      activeSexes: [...item.activeSexes].sort(),
    }))
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

  const body = (await req.json().catch(() => null)) as { userId?: unknown; sex?: unknown } | null;
  const userId = normalizeQuery(body?.userId);
  const sex = normalizeQuery(body?.sex) as MoreViewSex;

  if (!userId) {
    return NextResponse.json({ ok: false, message: "대상 유저를 선택해주세요." }, { status: 400 });
  }

  if (sex !== "male" && sex !== "female") {
    return NextResponse.json({ ok: false, message: "열어줄 더보기 종류를 다시 선택해주세요." }, { status: 400 });
  }

  const admin = createAdminClient();
  const grant = await grantMoreViewAccess(admin, {
    userId,
    sex,
    accessHours: 3,
    note: `admin manual grant by ${adminUser.email ?? adminUser.id}`,
    bonusCredits: 0,
  }).catch((error) => {
    console.error("[admin-more-view-grant] failed", error);
    return null;
  });

  if (!grant) {
    return NextResponse.json({ ok: false, message: "이상형 더보기 권한 지급에 실패했습니다." }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    message: `${sex === "female" ? "여자 카드 더보기" : "남자 카드 더보기"}를 바로 열어줬습니다.`,
    item: grant,
  });
}
