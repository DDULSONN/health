import { isAllowedAdminUser } from "@/lib/admin";
import {
  getOneOnOneAdminUserBlockPairKey,
  isMissingOneOnOneAdminUserBlocksTableError,
} from "@/lib/dating-1on1-admin-user-blocks";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

type BlockPayload = {
  user_a_id?: unknown;
  user_b_id?: unknown;
  note?: unknown;
};

type DeletePayload = {
  id?: unknown;
};

type CardCandidateRow = {
  id: string | null;
  user_id: string | null;
  name: string | null;
  sex: "male" | "female" | null;
  age: number | null;
  region: string | null;
  job: string | null;
  status: string | null;
  created_at: string | null;
};

type ProfileRow = {
  user_id: string | null;
  nickname: string | null;
};

type BlockRow = {
  id: string;
  user_a_id: string | null;
  user_b_id: string | null;
  note: string | null;
  created_by_user_id: string | null;
  created_at: string | null;
};

function normalizeUserPair(userAId: string, userBId: string) {
  return [userAId, userBId].map((id) => id.trim()).sort();
}

async function assertAdmin(req: Request) {
  const { user } = await getRequestAuthContext(req);
  if (!user) {
    return { user: null, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (!isAllowedAdminUser(user.id, user.email)) {
    return { user: null, response: NextResponse.json({ error: "Admin only" }, { status: 403 }) };
  }
  return { user, response: null };
}

async function fetchProfiles(admin: ReturnType<typeof createAdminClient>, userIds: string[]) {
  const uniqueUserIds = [...new Set(userIds.map((id) => String(id ?? "").trim()).filter(Boolean))];
  if (!uniqueUserIds.length) return new Map<string, ProfileRow>();
  const { data, error } = await admin.from("profiles").select("user_id,nickname").in("user_id", uniqueUserIds);
  if (error) {
    console.error("[admin dating 1on1 user-blocks] profiles failed", error);
    return new Map<string, ProfileRow>();
  }
  const map = new Map<string, ProfileRow>();
  for (const row of (data ?? []) as ProfileRow[]) {
    const userId = String(row.user_id ?? "").trim();
    if (userId) map.set(userId, row);
  }
  return map;
}

async function fetchLatestCardsByUserId(admin: ReturnType<typeof createAdminClient>, userIds: string[]) {
  const uniqueUserIds = [...new Set(userIds.map((id) => String(id ?? "").trim()).filter(Boolean))];
  if (!uniqueUserIds.length) return new Map<string, CardCandidateRow>();
  const { data, error } = await admin
    .from("dating_1on1_cards")
    .select("id,user_id,name,sex,age,region,job,status,created_at")
    .in("user_id", uniqueUserIds)
    .order("created_at", { ascending: false });
  if (error) {
    console.error("[admin dating 1on1 user-blocks] cards failed", error);
    return new Map<string, CardCandidateRow>();
  }
  const map = new Map<string, CardCandidateRow>();
  for (const row of (data ?? []) as CardCandidateRow[]) {
    const userId = String(row.user_id ?? "").trim();
    if (userId && !map.has(userId)) map.set(userId, row);
  }
  return map;
}

async function searchCandidates(admin: ReturnType<typeof createAdminClient>, q: string) {
  const needle = q.trim();
  const cardQuery = admin
    .from("dating_1on1_cards")
    .select("id,user_id,name,sex,age,region,job,status,created_at")
    .order("created_at", { ascending: false })
    .limit(80);

  const profileQuery = admin.from("profiles").select("user_id,nickname").limit(80);
  const [cardsRes, profilesRes] = await Promise.all([
    needle ? cardQuery.ilike("name", `%${needle}%`) : cardQuery,
    needle ? profileQuery.ilike("nickname", `%${needle}%`) : profileQuery,
  ]);

  if (cardsRes.error) {
    console.error("[GET /api/admin/dating/1on1/user-blocks] card search failed", cardsRes.error);
    throw cardsRes.error;
  }
  if (profilesRes.error) {
    console.error("[GET /api/admin/dating/1on1/user-blocks] profile search failed", profilesRes.error);
    throw profilesRes.error;
  }

  const profileMap = new Map<string, ProfileRow>();
  for (const row of (profilesRes.data ?? []) as ProfileRow[]) {
    const userId = String(row.user_id ?? "").trim();
    if (userId) profileMap.set(userId, row);
  }

  const profileUserIds = [...profileMap.keys()];
  const profileCardMap = await fetchLatestCardsByUserId(admin, profileUserIds);
  const userIds = new Set<string>(profileUserIds);
  const cardByUserId = new Map<string, CardCandidateRow>();

  for (const row of [...((cardsRes.data ?? []) as CardCandidateRow[]), ...profileCardMap.values()]) {
    const userId = String(row.user_id ?? "").trim();
    if (!userId) continue;
    userIds.add(userId);
    const existing = cardByUserId.get(userId);
    if (!existing || new Date(row.created_at ?? 0).getTime() > new Date(existing.created_at ?? 0).getTime()) {
      cardByUserId.set(userId, row);
    }
  }

  const missingProfileMap = await fetchProfiles(
    admin,
    [...userIds].filter((userId) => !profileMap.has(userId))
  );
  for (const [userId, profile] of missingProfileMap) {
    profileMap.set(userId, profile);
  }

  return [...userIds].slice(0, 80).map((userId) => ({
    user_id: userId,
    profile: profileMap.get(userId) ?? null,
    latest_card: cardByUserId.get(userId) ?? null,
  }));
}

function serializeBlock(
  row: BlockRow,
  profileMap: Map<string, ProfileRow>,
  cardMap: Map<string, CardCandidateRow>
) {
  return {
    ...row,
    user_a_profile: row.user_a_id ? profileMap.get(row.user_a_id) ?? null : null,
    user_b_profile: row.user_b_id ? profileMap.get(row.user_b_id) ?? null : null,
    user_a_card: row.user_a_id ? cardMap.get(row.user_a_id) ?? null : null,
    user_b_card: row.user_b_id ? cardMap.get(row.user_b_id) ?? null : null,
  };
}

export async function GET(req: Request) {
  const adminCheck = await assertAdmin(req);
  if (adminCheck.response) return adminCheck.response;

  const admin = createAdminClient();
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();

  const blocksRes = await admin
    .from("dating_1on1_admin_user_blocks")
    .select("id,user_a_id,user_b_id,note,created_by_user_id,created_at")
    .order("created_at", { ascending: false })
    .limit(200);

  if (blocksRes.error) {
    if (isMissingOneOnOneAdminUserBlocksTableError(blocksRes.error)) {
      return NextResponse.json({ table_ready: false, items: [], candidates: [] });
    }
    console.error("[GET /api/admin/dating/1on1/user-blocks] blocks failed", blocksRes.error);
    return NextResponse.json({ error: "1:1 지인 차단 목록을 불러오지 못했습니다." }, { status: 500 });
  }

  let candidates: Awaited<ReturnType<typeof searchCandidates>> = [];
  try {
    candidates = await searchCandidates(admin, q);
  } catch {
    return NextResponse.json({ error: "회원 검색에 실패했습니다." }, { status: 500 });
  }

  const blockRows = (blocksRes.data ?? []) as BlockRow[];
  const blockUserIds = blockRows.flatMap((row) => [row.user_a_id, row.user_b_id]).filter(Boolean) as string[];
  const [profileMap, cardMap] = await Promise.all([
    fetchProfiles(admin, blockUserIds),
    fetchLatestCardsByUserId(admin, blockUserIds),
  ]);

  return NextResponse.json({
    table_ready: true,
    items: blockRows.map((row) => serializeBlock(row, profileMap, cardMap)),
    candidates,
  });
}

export async function POST(req: Request) {
  const adminCheck = await assertAdmin(req);
  if (adminCheck.response) return adminCheck.response;
  const user = adminCheck.user!;

  const body = (await req.json().catch(() => null)) as BlockPayload | null;
  const rawUserAId = String(body?.user_a_id ?? "").trim();
  const rawUserBId = String(body?.user_b_id ?? "").trim();
  const note = String(body?.note ?? "").trim().slice(0, 500) || null;
  if (!rawUserAId || !rawUserBId) {
    return NextResponse.json({ error: "차단할 두 회원을 선택해주세요." }, { status: 400 });
  }
  if (rawUserAId === rawUserBId) {
    return NextResponse.json({ error: "같은 회원끼리는 차단할 수 없습니다." }, { status: 400 });
  }

  const [userAId, userBId] = normalizeUserPair(rawUserAId, rawUserBId);
  if (!getOneOnOneAdminUserBlockPairKey(userAId, userBId)) {
    return NextResponse.json({ error: "회원 정보가 올바르지 않습니다." }, { status: 400 });
  }

  const admin = createAdminClient();
  const upsertRes = await admin
    .from("dating_1on1_admin_user_blocks")
    .upsert(
      {
        user_a_id: userAId,
        user_b_id: userBId,
        note,
        created_by_user_id: user.id,
      },
      { onConflict: "user_a_id,user_b_id" }
    )
    .select("id,user_a_id,user_b_id,note,created_by_user_id,created_at")
    .maybeSingle();

  if (upsertRes.error) {
    console.error("[POST /api/admin/dating/1on1/user-blocks] upsert failed", upsertRes.error);
    const message = isMissingOneOnOneAdminUserBlocksTableError(upsertRes.error)
      ? "1:1 지인 차단 테이블이 아직 적용되지 않았습니다."
      : "1:1 지인 차단 저장에 실패했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, item: upsertRes.data });
}

export async function DELETE(req: Request) {
  const adminCheck = await assertAdmin(req);
  if (adminCheck.response) return adminCheck.response;

  const body = (await req.json().catch(() => null)) as DeletePayload | null;
  const id = String(body?.id ?? "").trim();
  if (!id) {
    return NextResponse.json({ error: "삭제할 차단 항목을 찾지 못했습니다." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin.from("dating_1on1_admin_user_blocks").delete().eq("id", id);
  if (error) {
    console.error("[DELETE /api/admin/dating/1on1/user-blocks] delete failed", error);
    return NextResponse.json({ error: "1:1 지인 차단 삭제에 실패했습니다." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
