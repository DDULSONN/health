import type { SupabaseClient, User } from "@supabase/supabase-js";

export type DatingSex = "male" | "female";
export type DatingViewerSexSource = "open_card" | "one_on_one" | "metadata" | null;
export type DatingViewerSexStatus = "resolved" | "missing" | "conflict" | "unavailable";

export type DatingViewerSexResolution = {
  status: DatingViewerSexStatus;
  viewerSex: DatingSex | null;
  targetSex: DatingSex | null;
  source: DatingViewerSexSource;
};

const RESOLUTION_CACHE_TTL_MS = 30_000;
const resolutionCache = new Map<string, { expiresAt: number; value: DatingViewerSexResolution }>();
const resolutionInFlight = new Map<string, Promise<DatingViewerSexResolution>>();

export function normalizeDatingSex(value: unknown): DatingSex | null {
  return value === "male" || value === "female" ? value : null;
}

export function getOppositeDatingSex(sex: DatingSex): DatingSex {
  return sex === "male" ? "female" : "male";
}

export function resolveDatingViewerSexFromSources(
  openCardSex: DatingSex | null,
  oneOnOneSex: DatingSex | null,
  metadataSex: DatingSex | null
): DatingViewerSexResolution {
  if (openCardSex && oneOnOneSex && openCardSex !== oneOnOneSex) {
    return { status: "conflict", viewerSex: null, targetSex: null, source: null };
  }

  const resolvedSex = openCardSex ?? oneOnOneSex;
  if (resolvedSex) {
    return {
      status: "resolved",
      viewerSex: resolvedSex,
      targetSex: getOppositeDatingSex(resolvedSex),
      source: openCardSex ? "open_card" : "one_on_one",
    };
  }

  if (metadataSex) {
    return {
      status: "resolved",
      viewerSex: metadataSex,
      targetSex: getOppositeDatingSex(metadataSex),
      source: "metadata",
    };
  }

  return { status: "missing", viewerSex: null, targetSex: null, source: null };
}

function readMetadataSex(user: Pick<User, "user_metadata">): DatingSex | null {
  const metadata = user.user_metadata;
  if (!metadata || typeof metadata !== "object") return null;
  return normalizeDatingSex((metadata as Record<string, unknown>).dating_sex);
}

async function lookupDatingViewerSex(
  admin: SupabaseClient,
  user: Pick<User, "id" | "user_metadata">
): Promise<DatingViewerSexResolution> {
  const [openCardResult, oneOnOneResult] = await Promise.all([
    admin
      .from("dating_cards")
      .select("sex,created_at")
      .eq("owner_user_id", user.id)
      .in("sex", ["male", "female"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from("dating_1on1_cards")
      .select("sex,created_at")
      .eq("user_id", user.id)
      .in("sex", ["male", "female"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (openCardResult.error || oneOnOneResult.error) {
    console.error("[dating-viewer-sex] source lookup failed", {
      userId: user.id,
      openCardCode: openCardResult.error?.code ?? null,
      oneOnOneCode: oneOnOneResult.error?.code ?? null,
    });
    return { status: "unavailable", viewerSex: null, targetSex: null, source: null };
  }

  const openCardSex = normalizeDatingSex(openCardResult.data?.sex);
  const oneOnOneSex = normalizeDatingSex(oneOnOneResult.data?.sex);
  const metadataSex = readMetadataSex(user);

  if (openCardSex && oneOnOneSex && openCardSex !== oneOnOneSex) {
    const openCardCreatedAt = Date.parse(String(openCardResult.data?.created_at ?? ""));
    const oneOnOneCreatedAt = Date.parse(String(oneOnOneResult.data?.created_at ?? ""));
    const useOneOnOne =
      Number.isFinite(oneOnOneCreatedAt) &&
      (!Number.isFinite(openCardCreatedAt) || oneOnOneCreatedAt > openCardCreatedAt);
    const selectedSex = useOneOnOne ? oneOnOneSex : openCardSex;

    console.warn("[dating-viewer-sex] conflicting sources; using most recent card", {
      userId: user.id,
      selectedSource: useOneOnOne ? "one_on_one" : "open_card",
    });

    return {
      status: "resolved",
      viewerSex: selectedSex,
      targetSex: getOppositeDatingSex(selectedSex),
      source: useOneOnOne ? "one_on_one" : "open_card",
    };
  }

  return resolveDatingViewerSexFromSources(openCardSex, oneOnOneSex, metadataSex);
}

export function cacheDatingViewerSexResolution(userId: string, value: DatingViewerSexResolution) {
  resolutionCache.set(userId, { expiresAt: Date.now() + RESOLUTION_CACHE_TTL_MS, value });
}

export async function resolveDatingViewerSex(
  admin: SupabaseClient,
  user: Pick<User, "id" | "user_metadata">
): Promise<DatingViewerSexResolution> {
  const cached = resolutionCache.get(user.id);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (cached) resolutionCache.delete(user.id);

  const existingTask = resolutionInFlight.get(user.id);
  if (existingTask) return existingTask;

  const task = lookupDatingViewerSex(admin, user);
  resolutionInFlight.set(user.id, task);
  try {
    const value = await task;
    if (value.status !== "unavailable") cacheDatingViewerSexResolution(user.id, value);
    return value;
  } finally {
    if (resolutionInFlight.get(user.id) === task) resolutionInFlight.delete(user.id);
  }
}
