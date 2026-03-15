import {
  DATING_ONE_ON_ONE_ACTIVE_STATUSES,
  DATING_ONE_ON_ONE_MATCH_CANDIDATE_SINGLE_TRACK_STATES,
  toDatingOneOnOneCardDetail,
} from "@/lib/dating-1on1";
import { compareRegionsByDistance } from "@/lib/region-distance";
import { createAdminClient } from "@/lib/supabase/server";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { NextResponse } from "next/server";

const RECOMMENDATION_LIMIT = 10;
const CARD_BATCH_SIZE = 1000;

type CardRow = {
  id: string;
  user_id: string;
  sex: "male" | "female";
  name: string;
  birth_year: number;
  height_cm: number;
  job: string;
  region: string;
  intro_text: string;
  strengths_text: string;
  preferred_partner_text: string;
  smoking: "non_smoker" | "occasional" | "smoker";
  workout_frequency: "none" | "1_2" | "3_4" | "5_plus" | null;
  status: "submitted" | "reviewing" | "approved" | "rejected";
  created_at: string;
  photo_paths: unknown;
};

function getAgeRange(card: { sex: "male" | "female"; age: number | null }) {
  if (card.age == null || !Number.isFinite(card.age)) {
    return { minAge: null as number | null, maxAge: null as number | null };
  }

  return card.sex === "male"
    ? { minAge: Math.max(19, card.age - 4), maxAge: card.age + 1 }
    : { minAge: Math.max(19, card.age - 1), maxAge: card.age + 4 };
}

function hashSeed(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

async function fetchAllActiveCards(admin: ReturnType<typeof createAdminClient>) {
  const rows: CardRow[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await admin
      .from("dating_1on1_cards")
      .select(
        "id,user_id,sex,name,birth_year,height_cm,job,region,intro_text,strengths_text,preferred_partner_text,smoking,workout_frequency,status,created_at,photo_paths"
      )
      .in("status", [...DATING_ONE_ON_ONE_ACTIVE_STATUSES])
      .order("created_at", { ascending: false })
      .range(from, from + CARD_BATCH_SIZE - 1);

    if (error) throw error;

    const batch = (data ?? []) as CardRow[];
    rows.push(...batch);
    if (batch.length < CARD_BATCH_SIZE) break;
    from += CARD_BATCH_SIZE;
  }

  return rows;
}

export async function GET(req: Request) {
  const { user } = await getRequestAuthContext(req);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  let activeCards: CardRow[];
  try {
    activeCards = await fetchAllActiveCards(admin);
  } catch (error) {
    console.error("[GET /api/dating/1on1/recommendations/my] cards failed", error);
    return NextResponse.json({ error: "Failed to load active cards." }, { status: 500 });
  }

  const normalizedCards = activeCards.map((row) => toDatingOneOnOneCardDetail(row));
  const myCards = normalizedCards.filter((card) => card.user_id === user.id);
  const mySourceCards = myCards.filter(
    (card) => card.status === "submitted" || card.status === "reviewing" || card.status === "approved"
  );

  if (mySourceCards.length === 0) {
    return NextResponse.json({ items: [] });
  }

  const sourceCardIds = mySourceCards.map((card) => card.id);

  const [existingPairRes, blockedCandidateRes] = await Promise.all([
    admin
      .from("dating_1on1_match_proposals")
      .select("source_card_id,candidate_card_id")
      .in("source_card_id", sourceCardIds),
    admin
      .from("dating_1on1_match_proposals")
      .select("candidate_card_id")
      .in("state", [...DATING_ONE_ON_ONE_MATCH_CANDIDATE_SINGLE_TRACK_STATES]),
  ]);

  if (existingPairRes.error) {
    console.error("[GET /api/dating/1on1/recommendations/my] pair lookup failed", existingPairRes.error);
    return NextResponse.json({ error: "Failed to load existing match pairs." }, { status: 500 });
  }
  if (blockedCandidateRes.error) {
    console.error("[GET /api/dating/1on1/recommendations/my] blocked candidates failed", blockedCandidateRes.error);
    return NextResponse.json({ error: "Failed to load blocked candidates." }, { status: 500 });
  }

  const existingPairMap = new Map<string, Set<string>>();
  for (const row of existingPairRes.data ?? []) {
    const bucket = existingPairMap.get(row.source_card_id) ?? new Set<string>();
    bucket.add(row.candidate_card_id);
    existingPairMap.set(row.source_card_id, bucket);
  }
  const blockedCandidateIds = new Set((blockedCandidateRes.data ?? []).map((row) => row.candidate_card_id));

  const items = mySourceCards.map((sourceCard) => {
    const sourceAgeRange = getAgeRange(sourceCard);
    const excludedIds = existingPairMap.get(sourceCard.id) ?? new Set<string>();
    const candidates = normalizedCards.filter((candidateCard) => {
      if (candidateCard.id === sourceCard.id) return false;
      if (candidateCard.user_id === sourceCard.user_id) return false;
      if (candidateCard.sex === sourceCard.sex) return false;
      if (blockedCandidateIds.has(candidateCard.id)) return false;
      if (excludedIds.has(candidateCard.id)) return false;
      return (
        candidateCard.status === "submitted" ||
        candidateCard.status === "reviewing" ||
        candidateCard.status === "approved"
      );
    });

    const inAgeRange = (candidateCard: (typeof candidates)[number]) => {
      if (sourceAgeRange.minAge == null || sourceAgeRange.maxAge == null || candidateCard.age == null || !Number.isFinite(candidateCard.age)) {
        return false;
      }
      return candidateCard.age >= sourceAgeRange.minAge && candidateCard.age <= sourceAgeRange.maxAge;
    };

    const sortByPriority = (list: typeof candidates, label: string) =>
      [...list].sort((a, b) => {
        const distanceGap = compareRegionsByDistance(sourceCard.region, a.region, b.region);
        if (distanceGap !== 0) return distanceGap;
        const aHash = hashSeed(`${sourceCard.id}:${label}:${a.id}`);
        const bHash = hashSeed(`${sourceCard.id}:${label}:${b.id}`);
        if (aHash !== bHash) return aHash - bHash;
        return a.id.localeCompare(b.id);
      });

    const preferred = sortByPriority(candidates.filter(inAgeRange), "preferred");
    const fallback = sortByPriority(candidates.filter((candidateCard) => !inAgeRange(candidateCard)), "fallback");
    const recommendations = [...preferred, ...fallback].slice(0, RECOMMENDATION_LIMIT);

    return {
      source_card_id: sourceCard.id,
      source_card_status: sourceCard.status,
      recommendations,
    };
  });

  return NextResponse.json({ items });
}
