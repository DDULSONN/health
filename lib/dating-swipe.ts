import { buildPublicLiteImageUrl, buildSignedImageUrl, extractStorageObjectPathFromBuckets } from "@/lib/images";
import { getKstDayRangeUtc } from "@/lib/dating-open";
import { createAdminClient } from "@/lib/supabase/server";

export const SWIPE_DAILY_LIMIT = 10;
const ELIGIBLE_CARD_STATUSES = new Set(["public", "expired", "hidden"]);

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

function pickPreviewImage(row: DatingCardRow): string | null {
  const visibility = row.photo_visibility === "public" ? "public" : "blur";
  if (visibility === "public") {
    const rawPath = Array.isArray(row.photo_paths)
      ? row.photo_paths.map((item) => normalizePhotoPath(item)).find((item) => item.length > 0) ?? ""
      : "";
    if (rawPath) {
      const litePath = toLitePath(rawPath);
      return buildPublicLiteImageUrl("dating-card-lite", litePath) || buildSignedImageUrl("dating-card-photos", rawPath) || null;
    }
  }

  const blurPath = Array.isArray(row.blur_paths)
    ? row.blur_paths.map((item) => normalizePhotoPath(item)).find((item) => item.length > 0) ?? ""
    : "";
  if (blurPath) {
    const blurWebp = toBlurWebpPath(blurPath);
    return buildPublicLiteImageUrl("dating-card-lite", blurWebp) || buildSignedImageUrl("dating-card-photos", blurPath) || null;
  }

  const blurThumb = normalizePhotoPath(row.blur_thumb_path ?? "");
  if (blurThumb) {
    const blurWebp = toBlurWebpPath(blurThumb);
    return buildPublicLiteImageUrl("dating-card-lite", blurWebp) || buildSignedImageUrl("dating-card-photos", blurThumb) || null;
  }

  return null;
}

export function isSwipeEligibleStatus(status: string | null | undefined): boolean {
  return ELIGIBLE_CARD_STATUSES.has(String(status ?? ""));
}

export function getSwipeDayRangeUtc(now = new Date()) {
  return getKstDayRangeUtc(now);
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
    if (!isSwipeEligibleStatus(row.status)) continue;
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
  const [swipesRes, matchesRes, cardsRes] = await Promise.all([
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
  ]);

  if (swipesRes.error) throw swipesRes.error;
  if (matchesRes.error) throw matchesRes.error;
  if (cardsRes.error) throw cardsRes.error;

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
  for (const row of (cardsRes.data ?? []) as DatingCardRow[]) {
    const ownerId = String(row.owner_user_id ?? "").trim();
    if (!ownerId || ownerId === actorUserId) continue;
    if (seenOwners.has(ownerId)) continue;

    if (excludedUserIds.has(ownerId)) continue;
    if (!isSwipeEligibleStatus(row.status)) continue;
    if (!String(row.instagram_id ?? "").trim()) continue;
    seenOwners.add(ownerId);

    return {
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
    };
  }

  return null;
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
