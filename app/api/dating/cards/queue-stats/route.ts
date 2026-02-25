import { getOpenCardLimitBySex } from "@/lib/dating-open";
import { syncOpenCardQueue } from "@/lib/dating-cards-queue";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

type RegionDistribution = { city: string; count: number };

function isMissingColumnError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = String((error as { code?: unknown }).code ?? "");
  const message = String((error as { message?: unknown }).message ?? "").toLowerCase();
  return code === "42703" || code === "PGRST204" || message.includes("could not find") || message.includes("column");
}

const PROVINCE_TOKENS = new Set([
  "서울",
  "서울시",
  "서울특별시",
  "경기",
  "경기도",
  "인천",
  "인천시",
  "인천광역시",
  "부산",
  "부산시",
  "부산광역시",
  "대구",
  "대구시",
  "대구광역시",
  "광주",
  "광주시",
  "광주광역시",
  "대전",
  "대전시",
  "대전광역시",
  "울산",
  "울산시",
  "울산광역시",
  "세종",
  "세종시",
  "세종특별자치시",
  "강원",
  "강원도",
  "충북",
  "충청북도",
  "충남",
  "충청남도",
  "전북",
  "전라북도",
  "전남",
  "전라남도",
  "경북",
  "경상북도",
  "경남",
  "경상남도",
  "제주",
  "제주시",
  "제주도",
  "제주특별자치도",
]);

function normalizeCityToken(token: string): string {
  const t = token.trim().replace(/[()]/g, "");
  return t.replace(/(특별자치도|특별자치시|특별시|광역시|자치시|자치도|시|군|구)$/u, "");
}

function extractCity(region: string | null): string | null {
  const raw = (region ?? "").trim();
  if (!raw) return null;

  const tokens = raw
    .replace(/[,-]/g, " ")
    .split(/\s+/)
    .map((v) => v.trim())
    .filter(Boolean);

  if (tokens.length === 0) return null;

  const first = tokens[0];
  const cityToken = PROVINCE_TOKENS.has(first) ? tokens[1] ?? "" : first;
  const city = normalizeCityToken(cityToken);

  if (!city || city.length < 2) return null;
  return city;
}

async function countPublic(adminClient: ReturnType<typeof createAdminClient>, sex: "male" | "female") {
  let { count, error } = await adminClient
    .from("dating_cards")
    .select("id", { head: true, count: "exact" })
    .eq("sex", sex)
    .eq("status", "public")
    .gt("expires_at", new Date().toISOString());

  if (error && isMissingColumnError(error)) {
    const legacy = await adminClient
      .from("dating_cards")
      .select("id", { head: true, count: "exact" })
      .eq("sex", sex)
      .eq("status", "public");
    count = legacy.count;
    error = legacy.error;
  }

  if (error) throw error;
  return count ?? 0;
}

async function countPending(adminClient: ReturnType<typeof createAdminClient>, sex: "male" | "female") {
  const { count, error } = await adminClient
    .from("dating_cards")
    .select("id", { head: true, count: "exact" })
    .eq("sex", sex)
    .eq("status", "pending");

  if (error) throw error;
  return count ?? 0;
}

async function pendingRegionDistribution(
  adminClient: ReturnType<typeof createAdminClient>,
  sex: "male" | "female"
): Promise<RegionDistribution[]> {
  const { data, error } = await adminClient
    .from("dating_cards")
    .select("region")
    .eq("sex", sex)
    .eq("status", "pending")
    .limit(5000);

  if (error) throw error;

  const rows = Array.isArray(data) ? data : [];
  const counts = new Map<string, number>();

  for (const row of rows) {
    const city = extractCity((row as { region?: string | null }).region ?? null);
    if (!city) continue;
    counts.set(city, (counts.get(city) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([city, count]) => ({ city, count }))
    .sort((a, b) => b.count - a.count || a.city.localeCompare(b.city, "ko"))
    .slice(0, 8);
}

async function countAcceptedMatches(adminClient: ReturnType<typeof createAdminClient>) {
  const { count, error } = await adminClient
    .from("dating_card_applications")
    .select("id", { head: true, count: "exact" })
    .eq("status", "accepted");

  if (error) throw error;
  return count ?? 0;
}

export async function GET() {
  const adminClient = createAdminClient();
  const requestId = crypto.randomUUID();

  try {
    await syncOpenCardQueue(adminClient);
  } catch (error) {
    console.error("[GET /api/dating/cards/queue-stats] queue sync failed", {
      requestId,
      error,
    });
  }

  const safeCount = async (label: string, fn: () => Promise<number>) => {
    try {
      return await fn();
    } catch (error) {
      console.error("[GET /api/dating/cards/queue-stats] count failed", { requestId, label, error });
      return 0;
    }
  };

  try {
    const [malePublic, femalePublic, malePending, femalePending, malePendingRegions, femalePendingRegions, acceptedMatches] = await Promise.all([
      safeCount("malePublic", () => countPublic(adminClient, "male")),
      safeCount("femalePublic", () => countPublic(adminClient, "female")),
      safeCount("malePending", () => countPending(adminClient, "male")),
      safeCount("femalePending", () => countPending(adminClient, "female")),
      pendingRegionDistribution(adminClient, "male").catch((error) => {
        console.error("[GET /api/dating/cards/queue-stats] region failed", { requestId, sex: "male", error });
        return [];
      }),
      pendingRegionDistribution(adminClient, "female").catch((error) => {
        console.error("[GET /api/dating/cards/queue-stats] region failed", { requestId, sex: "female", error });
        return [];
      }),
      safeCount("acceptedMatches", () => countAcceptedMatches(adminClient)),
    ]);

    return NextResponse.json({
      male: {
        public_count: malePublic,
        pending_count: malePending,
        slot_limit: getOpenCardLimitBySex("male"),
        pending_regions: malePendingRegions,
      },
      female: {
        public_count: femalePublic,
        pending_count: femalePending,
        slot_limit: getOpenCardLimitBySex("female"),
        pending_regions: femalePendingRegions,
      },
      accepted_matches_count: acceptedMatches,
    });
  } catch (error) {
    console.error("[GET /api/dating/cards/queue-stats] failed", { requestId, error });
    return NextResponse.json(
      {
        male: { public_count: 0, pending_count: 0, slot_limit: getOpenCardLimitBySex("male"), pending_regions: [] },
        female: { public_count: 0, pending_count: 0, slot_limit: getOpenCardLimitBySex("female"), pending_regions: [] },
        accepted_matches_count: 0,
      },
      { status: 200 }
    );
  }
}

