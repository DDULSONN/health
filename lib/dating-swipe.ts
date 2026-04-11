import {
  buildPublicLiteImageUrl,
  buildSignedImageUrl,
  buildSignedImageUrlAllowRaw,
  extractStorageObjectPathFromBuckets,
} from "@/lib/images";
import { getKstDayRangeUtc } from "@/lib/dating-open";
import { getDatingBlockedUserIds } from "@/lib/dating-blocks";
import { createAdminClient } from "@/lib/supabase/server";

export const SWIPE_BASE_DAILY_LIMIT = 5;
export const SWIPE_PREMIUM_DAILY_LIMIT = 15;
export const SWIPE_PREMIUM_PRICE_KRW = 10000;
export const SWIPE_PREMIUM_DURATION_DAYS = 15;
export const SWIPE_DAILY_LIMIT = SWIPE_BASE_DAILY_LIMIT;

type AdminClient = ReturnType<typeof createAdminClient>;

type DatingCardRow = {
  id: string;
  owner_user_id: string;
  sex: "male" | "female";
  display_nickname: string | null;
  age: number | null;
  region: string | null;
  height_cm: number | null;
  job: string | null;
  training_years: number | null;
  ideal_type?: string | null;
  strengths_text?: string | null;
  total_3lift?: number | null;
  is_3lift_verified?: boolean | null;
  photo_visibility?: "blur" | "public" | null;
  photo_paths?: string[] | null;
  blur_paths?: string[] | null;
  blur_thumb_path?: string | null;
  instagram_id?: string | null;
  status: string;
  expires_at?: string | null;
  created_at: string;
};

type ProfileSwipeVisibilityRow = {
  user_id: string;
  swipe_profile_visible: boolean | null;
};

type SwipeSubscriptionRow = {
  id: string;
  status: "pending" | "approved" | "rejected" | "expired";
  amount: number | null;
  daily_limit: number | null;
  duration_days: number | null;
  requested_at: string | null;
  approved_at: string | null;
  expires_at: string | null;
};

export type SwipeLimitInfo = {
  limit: number;
  baseLimit: number;
  premiumLimit: number;
  premiumPriceKrw: number;
  premiumDurationDays: number;
  activeSubscription: {
    id: string;
    approvedAt: string | null;
    expiresAt: string | null;
  } | null;
  pendingSubscription: {
    id: string;
    requestedAt: string | null;
  } | null;
};

function isMissingRelationError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = String((error as { code?: unknown }).code ?? "");
  const message = String((error as { message?: unknown }).message ?? "").toLowerCase();
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    message.includes("does not exist") ||
    message.includes("relation") ||
    message.includes("could not find the table")
  );
}

export type SwipeCandidate = {
  user_id: string;
  card_id: string;
  sex: "male" | "female";
  display_nickname: string;
  age: number | null;
  region: string | null;
  height_cm: number | null;
  job: string | null;
  training_years: number | null;
  ideal_type: string | null;
  strengths_text: string | null;
  total_3lift: number | null;
  is_3lift_verified: boolean;
  photo_visibility: "blur" | "public";
  image_url: string | null;
  source_status: string;
  created_at: string;
};

function normalizePhotoPath(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim();
  if (!trimmed) return "";
  return extractStorageObjectPathFromBuckets(trimmed, ["dating-card-photos", "dating-photos", "dating-card-lite"]) ?? trimmed;
}

function toLitePath(rawPath: string): string {
  return rawPath.replace("/raw/", "/lite/").replace(/\.[^.\/]+$/, ".webp");
}

function toBlurWebpPath(path: string): string {
  return path.includes("/blur/") ? path.replace(/\.[^.\/]+$/, ".webp") : path;
}

function toThumbPath(rawPath: string): string {
  return rawPath.replace("/raw/", "/thumb/").replace(/\.[^.\/]+$/, ".webp");
}

type SwipePreviewRow = Pick<DatingCardRow, "photo_visibility" | "photo_paths" | "blur_paths" | "blur_thumb_path">;

export function pickPreviewImage(row: SwipePreviewRow): string | null {
  const visibility = row.photo_visibility === "public" ? "public" : "blur";
  if (visibility === "public") {
    const rawPath = Array.isArray(row.photo_paths)
      ? row.photo_paths.map((item) => normalizePhotoPath(item)).find((item) => item.length > 0) ?? ""
      : "";
    if (rawPath) {
      const litePath = toLitePath(rawPath);
      const thumbPath = toThumbPath(rawPath);
      return (
        buildSignedImageUrl("dating-card-lite", thumbPath) ||
        buildSignedImageUrl("dating-card-lite", litePath) ||
        buildPublicLiteImageUrl("dating-card-lite", thumbPath) ||
        buildPublicLiteImageUrl("dating-card-lite", litePath) ||
        buildSignedImageUrlAllowRaw("dating-card-photos", rawPath) ||
        null
      );
    }
  }

  const blurPath = Array.isArray(row.blur_paths)
    ? row.blur_paths.map((item) => normalizePhotoPath(item)).find((item) => item.length > 0) ?? ""
    : "";
  if (blurPath) {
    const blurWebp = toBlurWebpPath(blurPath);
    return (
      buildSignedImageUrl("dating-card-photos", blurPath) ||
      buildSignedImageUrl("dating-card-lite", blurWebp) ||
      buildPublicLiteImageUrl("dating-card-lite", blurWebp) ||
      null
    );
  }

  const blurThumb = normalizePhotoPath(row.blur_thumb_path ?? "");
  if (blurThumb) {
    const blurWebp = toBlurWebpPath(blurThumb);
    return (
      buildSignedImageUrl("dating-card-photos", blurThumb) ||
      buildSignedImageUrl("dating-card-lite", blurWebp) ||
      buildPublicLiteImageUrl("dating-card-lite", blurWebp) ||
      null
    );
  }

  return null;
}

export function getSwipeDayRangeUtc(now = new Date()) {
  return getKstDayRangeUtc(now);
}

function getSwipeDayKeyKst(now = new Date()): string {
  const kstMillis = now.getTime() + 9 * 60 * 60 * 1000;
  return new Date(kstMillis).toISOString().slice(0, 10);
}

function getDeterministicCandidateRank(actorUserId: string, dayKey: string, ownerId: string, cardId: string): number {
  const source = `${actorUserId}|${dayKey}|${ownerId}|${cardId}`;
  let hash = 2166136261;
  for (let i = 0; i < source.length; i += 1) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export async function getSwipeDailyUsage(adminClient: AdminClient, actorUserId: string): Promise<number> {
  const { startUtcIso, endUtcIso } = getSwipeDayRangeUtc();
  const res = await adminClient
    .from("dating_card_swipes")
    .select("id", { count: "exact", head: true })
    .eq("actor_user_id", actorUserId)
    .gte("created_at", startUtcIso)
    .lt("created_at", endUtcIso);

  if (res.error) {
    throw res.error;
  }
  return Math.max(0, Number(res.count ?? 0));
}

export async function getSwipeLimitInfo(
  adminClient: AdminClient,
  userId: string,
  now = new Date()
): Promise<SwipeLimitInfo> {
  const fallback: SwipeLimitInfo = {
    limit: SWIPE_BASE_DAILY_LIMIT,
    baseLimit: SWIPE_BASE_DAILY_LIMIT,
    premiumLimit: SWIPE_PREMIUM_DAILY_LIMIT,
    premiumPriceKrw: SWIPE_PREMIUM_PRICE_KRW,
    premiumDurationDays: SWIPE_PREMIUM_DURATION_DAYS,
    activeSubscription: null,
    pendingSubscription: null,
  };

  const res = await adminClient
    .from("dating_swipe_subscription_requests")
    .select("id,status,amount,daily_limit,duration_days,requested_at,approved_at,expires_at")
    .eq("user_id", userId)
    .in("status", ["pending", "approved"])
    .order("created_at", { ascending: false })
    .limit(20);

  if (res.error) {
    if (isMissingRelationError(res.error)) {
      return fallback;
    }
    throw res.error;
  }

  const rows = (res.data ?? []) as SwipeSubscriptionRow[];
  const nowMs = now.getTime();
  const staleApprovedIds = rows
    .filter((row) => row.status === "approved" && row.expires_at)
    .filter((row) => {
      const expiresAt = new Date(String(row.expires_at)).getTime();
      return Number.isFinite(expiresAt) && expiresAt <= nowMs;
    })
    .map((row) => row.id);

  if (staleApprovedIds.length > 0) {
    const expireRes = await adminClient
      .from("dating_swipe_subscription_requests")
      .update({
        status: "expired",
        reviewed_at: now.toISOString(),
        updated_at: now.toISOString(),
      })
      .in("id", staleApprovedIds);

    if (expireRes.error && !isMissingRelationError(expireRes.error)) {
      console.error("[dating-swipe] expire stale subscriptions failed", expireRes.error);
    }
  }

  const activeSubscription =
    rows.find((row) => {
      if (row.status !== "approved" || !row.expires_at) return false;
      const expiresAt = new Date(String(row.expires_at)).getTime();
      return Number.isFinite(expiresAt) && expiresAt > nowMs;
    }) ?? null;

  const pendingSubscription = rows.find((row) => row.status === "pending") ?? null;

  return {
    limit:
      activeSubscription && Number.isFinite(Number(activeSubscription.daily_limit))
        ? Math.max(SWIPE_BASE_DAILY_LIMIT, Number(activeSubscription.daily_limit))
        : SWIPE_BASE_DAILY_LIMIT,
    baseLimit: SWIPE_BASE_DAILY_LIMIT,
    premiumLimit: SWIPE_PREMIUM_DAILY_LIMIT,
    premiumPriceKrw: SWIPE_PREMIUM_PRICE_KRW,
    premiumDurationDays: SWIPE_PREMIUM_DURATION_DAYS,
    activeSubscription: activeSubscription
      ? {
          id: activeSubscription.id,
          approvedAt: activeSubscription.approved_at ?? null,
          expiresAt: activeSubscription.expires_at ?? null,
        }
      : null,
    pendingSubscription: pendingSubscription
      ? {
          id: pendingSubscription.id,
          requestedAt: pendingSubscription.requested_at ?? null,
        }
      : null,
  };
}

export async function getLatestSwipeCardForUser(
  adminClient: AdminClient,
  userId: string
): Promise<(DatingCardRow & { instagram_id: string }) | null> {
  const res = await adminClient
    .from("dating_cards")
    .select(
      "id, owner_user_id, sex, display_nickname, age, region, height_cm, job, training_years, ideal_type, strengths_text, total_3lift, is_3lift_verified, photo_visibility, photo_paths, blur_paths, blur_thumb_path, instagram_id, status, expires_at, created_at"
    )
    .eq("owner_user_id", userId)
    .order("created_at", { ascending: false })
    .limit(30);

  if (res.error) {
    throw res.error;
  }

  for (const row of (res.data ?? []) as DatingCardRow[]) {
    const instagramId = String(row.instagram_id ?? "").trim();
    if (!instagramId) continue;
    return {
      ...row,
      instagram_id: instagramId,
    };
  }

  return null;
}

export async function getSwipeCandidate(
  adminClient: AdminClient,
  actorUserId: string,
  sex: "male" | "female"
): Promise<SwipeCandidate | null> {
  const [swipesRes, matchesRes, cardsRes, blockedUserIds] = await Promise.all([
    adminClient.from("dating_card_swipes").select("target_user_id").eq("actor_user_id", actorUserId).limit(5000),
    adminClient
      .from("dating_card_swipe_matches")
      .select("user_a_id,user_b_id")
      .or(`user_a_id.eq.${actorUserId},user_b_id.eq.${actorUserId}`)
      .limit(5000),
    adminClient
      .from("dating_cards")
      .select(
        "id, owner_user_id, sex, display_nickname, age, region, height_cm, job, training_years, ideal_type, strengths_text, total_3lift, is_3lift_verified, photo_visibility, photo_paths, blur_paths, blur_thumb_path, instagram_id, status, expires_at, created_at"
      )
      .eq("sex", sex)
      .order("created_at", { ascending: false })
      .limit(250),
    getDatingBlockedUserIds(adminClient, actorUserId),
  ]);

  if (swipesRes.error) throw swipesRes.error;
  if (matchesRes.error) throw matchesRes.error;
  if (cardsRes.error) throw cardsRes.error;

  const ownerIds = Array.from(
    new Set(
      ((cardsRes.data ?? []) as DatingCardRow[])
        .map((row) => String(row.owner_user_id ?? "").trim())
        .filter((value) => value.length > 0)
    )
  );
  const visibilityByUserId = new Map<string, boolean>();
  if (ownerIds.length > 0) {
    const profilesRes = await adminClient
      .from("profiles")
      .select("user_id, swipe_profile_visible")
      .in("user_id", ownerIds);

    if (profilesRes.error && !profilesRes.error.message?.includes("swipe_profile_visible")) {
      throw profilesRes.error;
    }

    const profileRows =
      profilesRes.error && profilesRes.error.message?.includes("swipe_profile_visible")
        ? []
        : ((profilesRes.data ?? []) as ProfileSwipeVisibilityRow[]);

    for (const row of profileRows) {
      const userId = String(row.user_id ?? "").trim();
      if (!userId) continue;
      visibilityByUserId.set(userId, row.swipe_profile_visible !== false);
    }
  }

  const excludedUserIds = new Set<string>();
  for (const row of swipesRes.data ?? []) {
    const userId = String(row.target_user_id ?? "").trim();
    if (userId) excludedUserIds.add(userId);
  }
  for (const row of matchesRes.data ?? []) {
    const a = String(row.user_a_id ?? "");
    const b = String(row.user_b_id ?? "");
    if (a === actorUserId && b) excludedUserIds.add(b);
    if (b === actorUserId && a) excludedUserIds.add(a);
  }

  const seenOwners = new Set<string>();
  const dayKey = getSwipeDayKeyKst();
  const candidates: Array<{ rank: number; candidate: SwipeCandidate }> = [];

  for (const row of (cardsRes.data ?? []) as DatingCardRow[]) {
    const ownerId = String(row.owner_user_id ?? "").trim();
    if (!ownerId || ownerId === actorUserId) continue;
    if (seenOwners.has(ownerId)) continue;
    if (excludedUserIds.has(ownerId)) continue;
    if (blockedUserIds.has(ownerId)) continue;
    if (visibilityByUserId.get(ownerId) === false) continue;
    if (!String(row.instagram_id ?? "").trim()) continue;
    seenOwners.add(ownerId);

    candidates.push({
      rank: getDeterministicCandidateRank(actorUserId, dayKey, ownerId, row.id),
      candidate: {
        user_id: ownerId,
        card_id: row.id,
        sex: row.sex,
        display_nickname: String(row.display_nickname ?? "익명").trim() || "익명",
        age: row.age ?? null,
        region: row.region ?? null,
        height_cm: row.height_cm ?? null,
        job: row.job ?? null,
        training_years: row.training_years ?? null,
        ideal_type: row.ideal_type ?? null,
        strengths_text: row.strengths_text ?? null,
        total_3lift: row.total_3lift ?? null,
        is_3lift_verified: row.is_3lift_verified === true,
        photo_visibility: row.photo_visibility === "public" ? "public" : "blur",
        image_url: pickPreviewImage(row),
        source_status: row.status,
        created_at: row.created_at,
      },
    });
  }

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    return b.candidate.created_at.localeCompare(a.candidate.created_at);
  });

  return candidates[0]?.candidate ?? null;
}

export async function sendDatingEmailNotification(
  adminClient: AdminClient,
  userId: string,
  subject: string,
  text: string
): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.NOTIFY_FROM_EMAIL?.trim();
  if (!apiKey || !from) {
    return false;
  }

  const userRes = await adminClient.auth.admin.getUserById(userId).catch(() => null);
  const to = userRes?.data?.user?.email?.trim();
  if (!to) {
    return false;
  }

  const html = text
    .split("\n")
    .map((line) => line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"))
    .join("<br />");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      text,
      html,
    }),
  }).catch(() => null);

  return Boolean(res?.ok);
}
