import type { SupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminRoute } from "@/lib/admin-route";

export const runtime = "nodejs";

const ACTIVE_CARD_STATUSES = ["submitted", "reviewing", "approved"] as const;
const CARD_SELECT = "id,user_id,sex,name,age,job,region,status,created_at";
const RESULT_LIMIT = 20;

type SearchRole = "source" | "candidate";
type SearchCard = {
  id: string;
  user_id: string;
  sex: "male" | "female";
  name: string;
  age: number | null;
  job: string | null;
  region: string | null;
  status: "submitted" | "reviewing" | "approved";
  created_at: string;
};

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function escapeIlike(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}

function cardQuery(
  admin: SupabaseClient,
  options: {
    targetSex?: "male" | "female" | null;
    sourceCardId?: string | null;
    sourceUserId?: string | null;
  }
) {
  let query = admin
    .from("dating_1on1_cards")
    .select(CARD_SELECT)
    .in("status", [...ACTIVE_CARD_STATUSES]);

  if (options.targetSex) query = query.eq("sex", options.targetSex);
  if (options.sourceCardId) query = query.neq("id", options.sourceCardId);
  if (options.sourceUserId) query = query.neq("user_id", options.sourceUserId);
  return query;
}

export async function GET(request: NextRequest) {
  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;

  const role = request.nextUrl.searchParams.get("role") === "candidate" ? "candidate" : "source";
  const search = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 80);
  const sourceCardId = (request.nextUrl.searchParams.get("source_card_id") ?? "").trim();

  if (search.length < 2) {
    return NextResponse.json({ error: "검색어를 2자 이상 입력해 주세요." }, { status: 400 });
  }

  let targetSex: "male" | "female" | null = null;
  let sourceUserId: string | null = null;
  if (role === "candidate") {
    if (!sourceCardId) {
      return NextResponse.json({ error: "기준 카드를 먼저 선택해 주세요." }, { status: 400 });
    }
    const sourceRes = await auth.admin
      .from("dating_1on1_cards")
      .select("id,user_id,sex,status")
      .eq("id", sourceCardId)
      .maybeSingle();
    if (sourceRes.error) {
      console.error("[admin 1on1 candidate-search] source lookup failed", sourceRes.error);
      return NextResponse.json({ error: "기준 카드를 확인하지 못했습니다." }, { status: 500 });
    }
    if (!sourceRes.data || !ACTIVE_CARD_STATUSES.includes(sourceRes.data.status)) {
      return NextResponse.json({ error: "현재 후보를 보낼 수 없는 기준 카드입니다." }, { status: 409 });
    }
    sourceUserId = String(sourceRes.data.user_id);
    targetSex = sourceRes.data.sex === "male" ? "female" : "male";
  }

  const constraints = { targetSex, sourceCardId: role === "candidate" ? sourceCardId : null, sourceUserId };
  const escaped = escapeIlike(search);
  const phoneDigits = search.replace(/\D/g, "");
  const phoneSuffix = phoneDigits.length >= 4 ? phoneDigits.slice(-4) : "";
  const exactId = isUuid(search) ? search : null;

  try {
    const [nameRes, nicknameRes, phoneRes, exactCardRes, exactUserRes] = await Promise.all([
      cardQuery(auth.admin, constraints)
        .ilike("name", `%${escaped}%`)
        .order("created_at", { ascending: false })
        .limit(RESULT_LIMIT),
      auth.admin
        .from("profiles")
        .select("user_id,nickname,phone_verified,is_banned")
        .ilike("nickname", `%${escaped}%`)
        .limit(RESULT_LIMIT),
      phoneSuffix
        ? auth.admin
            .from("profiles")
            .select("user_id,nickname,phone_verified,is_banned")
            .ilike("phone", `%${phoneSuffix}%`)
            .limit(RESULT_LIMIT)
        : Promise.resolve({ data: [], error: null }),
      exactId
        ? cardQuery(auth.admin, constraints).eq("id", exactId).limit(1)
        : Promise.resolve({ data: [], error: null }),
      exactId
        ? cardQuery(auth.admin, constraints).eq("user_id", exactId).order("created_at", { ascending: false }).limit(3)
        : Promise.resolve({ data: [], error: null }),
    ]);

    const firstError = [nameRes.error, nicknameRes.error, phoneRes.error, exactCardRes.error, exactUserRes.error].find(Boolean);
    if (firstError) throw firstError;

    const matchedProfiles = [...(nicknameRes.data ?? []), ...(phoneRes.data ?? [])];
    const profileUserIds = [...new Set(matchedProfiles.map((profile) => String(profile.user_id)).filter(Boolean))];
    const profileCardsRes = profileUserIds.length
      ? await cardQuery(auth.admin, constraints)
          .in("user_id", profileUserIds)
          .order("created_at", { ascending: false })
          .limit(RESULT_LIMIT)
      : { data: [], error: null };
    if (profileCardsRes.error) throw profileCardsRes.error;

    const cardById = new Map<string, SearchCard>();
    for (const rawCard of [
      ...(exactCardRes.data ?? []),
      ...(exactUserRes.data ?? []),
      ...(nameRes.data ?? []),
      ...(profileCardsRes.data ?? []),
    ]) {
      const card = rawCard as SearchCard;
      if (!cardById.has(card.id)) cardById.set(card.id, card);
      if (cardById.size >= RESULT_LIMIT) break;
    }

    const cards = [...cardById.values()];
    const userIds = [...new Set(cards.map((card) => card.user_id))];
    const profilesRes = userIds.length
      ? await auth.admin
          .from("profiles")
          .select("user_id,nickname,phone_verified,is_banned")
          .in("user_id", userIds)
      : { data: [], error: null };
    if (profilesRes.error) throw profilesRes.error;
    const profileByUserId = new Map(
      (profilesRes.data ?? []).map((profile) => [String(profile.user_id), profile])
    );

    const items = cards
      .filter((card) => profileByUserId.get(card.user_id)?.is_banned !== true)
      .map((card) => {
        const profile = profileByUserId.get(card.user_id);
        return {
          ...card,
          nickname: String(profile?.nickname ?? "").trim() || null,
          phone_verified: profile?.phone_verified === true,
        };
      });

    return NextResponse.json(
      { ok: true, role: role satisfies SearchRole, items, limit: RESULT_LIMIT },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("[admin 1on1 candidate-search] failed", error);
    return NextResponse.json({ error: "1:1 카드를 검색하지 못했습니다." }, { status: 500 });
  }
}
