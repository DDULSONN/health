import { createAdminClient } from "@/lib/supabase/server";

type AdminClient = ReturnType<typeof createAdminClient>;

type InstagramCandidate = {
  instagramId: string;
  createdAt: number;
};

export function normalizeDatingInstagramId(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const normalized = value
    .trim()
    .replace(/^@+/, "")
    .replace(/^https?:\/\/(?:www\.)?instagram\.com\//i, "")
    .split(/[/?#]/)[0]
    .trim();

  return /^[A-Za-z0-9._]{1,30}$/.test(normalized) ? normalized : null;
}

function setLatestCandidate(
  candidates: Map<string, InstagramCandidate>,
  userId: unknown,
  instagramId: unknown,
  createdAt: unknown
) {
  if (typeof userId !== "string" || !userId) return;
  const normalized = normalizeDatingInstagramId(instagramId);
  if (!normalized) return;

  const timestamp = typeof createdAt === "string" ? Date.parse(createdAt) : 0;
  const safeTimestamp = Number.isFinite(timestamp) ? timestamp : 0;
  const current = candidates.get(userId);
  if (!current || safeTimestamp > current.createdAt) {
    candidates.set(userId, { instagramId: normalized, createdAt: safeTimestamp });
  }
}

export async function loadLatestDatingInstagramByUser(
  adminClient: AdminClient,
  userIds: Iterable<string>
): Promise<Map<string, string>> {
  const ids = [...new Set([...userIds].map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) return new Map();

  const [cardsRes, applicationsRes] = await Promise.all([
    adminClient
      .from("dating_cards")
      .select("owner_user_id, instagram_id, created_at")
      .in("owner_user_id", ids)
      .not("instagram_id", "is", null)
      .neq("instagram_id", "")
      .order("created_at", { ascending: false })
      .limit(5000),
    adminClient
      .from("dating_card_applications")
      .select("applicant_user_id, instagram_id, created_at")
      .in("applicant_user_id", ids)
      .not("instagram_id", "is", null)
      .neq("instagram_id", "")
      .order("created_at", { ascending: false })
      .limit(5000),
  ]);

  if (cardsRes.error) {
    console.error("[dating-instagram] card fallback lookup failed", cardsRes.error);
  }
  if (applicationsRes.error) {
    console.error("[dating-instagram] application fallback lookup failed", applicationsRes.error);
  }

  const candidates = new Map<string, InstagramCandidate>();
  for (const row of cardsRes.data ?? []) {
    setLatestCandidate(candidates, row.owner_user_id, row.instagram_id, row.created_at);
  }
  for (const row of applicationsRes.data ?? []) {
    setLatestCandidate(candidates, row.applicant_user_id, row.instagram_id, row.created_at);
  }

  return new Map([...candidates].map(([userId, candidate]) => [userId, candidate.instagramId]));
}
