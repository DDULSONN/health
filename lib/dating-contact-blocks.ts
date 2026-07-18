import crypto from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizePhoneToE164, isLikelyKoreanMobileE164, isLikelyValidE164 } from "@/lib/phone-verification";

export type DatingContactBlockType = "phone" | "instagram";

type ContactBlockRow = {
  user_id: string | null;
  block_type: DatingContactBlockType | null;
  value_hash: string | null;
};

type ProfilePhoneRow = {
  user_id: string | null;
  phone_e164: string | null;
};

export type DatingContactBlockItem = {
  id: string;
  block_type: DatingContactBlockType;
  value_hint: string | null;
  label: string | null;
  created_at: string;
};

export type DatingContactBlockCardLike = {
  owner_user_id?: string | null;
  instagram_id?: string | null;
};

const CONTACT_BLOCK_BATCH_SIZE = 500;

export type DatingContactBlockMap = Map<string, Set<string>>;

function getContactBlockSecret() {
  return (
    process.env.CONTACT_BLOCK_HASH_SECRET?.trim() ||
    process.env.PHONE_BLOCK_HASH_SECRET?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.NEXTAUTH_SECRET?.trim() ||
    "local-contact-block-secret"
  );
}

export function isMissingDatingContactBlocksTableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = String((error as { code?: unknown }).code ?? "");
  const message = String((error as { message?: unknown }).message ?? "").toLowerCase();
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    message.includes("dating_contact_blocks") ||
    message.includes("could not find the table") ||
    message.includes("does not exist") ||
    message.includes("schema cache")
  );
}

export function normalizeDatingContactPhone(raw: string): string {
  const normalized = normalizePhoneToE164(raw);
  if (!normalized || !isLikelyValidE164(normalized)) return "";
  if (normalized.startsWith("+82") && !isLikelyKoreanMobileE164(normalized)) return "";
  return normalized;
}

export function normalizeDatingContactInstagram(raw: string): string {
  const withoutUrl = raw
    .trim()
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, "")
    .replace(/^instagram\.com\//i, "")
    .split(/[/?#]/)[0]
    .trim();
  const normalized = withoutUrl.replace(/^@+/, "").replace(/\s+/g, "").toLowerCase();
  return /^[a-z0-9._]{1,30}$/.test(normalized) ? normalized : "";
}

export function normalizeDatingContactBlockInput(type: DatingContactBlockType, raw: string) {
  return type === "phone" ? normalizeDatingContactPhone(raw) : normalizeDatingContactInstagram(raw);
}

export function hashDatingContactBlockValue(type: DatingContactBlockType, normalizedValue: string) {
  return crypto
    .createHmac("sha256", getContactBlockSecret())
    .update(`${type}:${normalizedValue}`)
    .digest("hex");
}

export function maskDatingContactBlockValue(type: DatingContactBlockType, normalizedValue: string) {
  if (type === "phone") {
    const digits = normalizedValue.replace(/\D/g, "");
    return digits.length >= 4 ? `끝자리 ${digits.slice(-4)}` : "휴대폰 번호";
  }
  return `@${normalizedValue}`;
}

function addHash(bucket: Map<string, Set<string>>, userId: string, type: DatingContactBlockType, valueHash: string) {
  const key = `${userId}:${type}`;
  const set = bucket.get(key) ?? new Set<string>();
  set.add(valueHash);
  bucket.set(key, set);
}

function hasHash(bucket: Map<string, Set<string>>, userId: string, type: DatingContactBlockType, valueHash: string) {
  return bucket.get(`${userId}:${type}`)?.has(valueHash) === true;
}

export async function getDatingContactBlockMapForUsers(adminClient: SupabaseClient, userIds: string[]) {
  const uniqueUserIds = [...new Set(userIds.map((id) => String(id ?? "").trim()).filter(Boolean))];
  const blockMap = new Map<string, Set<string>>();
  if (uniqueUserIds.length === 0) return blockMap;

  for (let start = 0; start < uniqueUserIds.length; start += CONTACT_BLOCK_BATCH_SIZE) {
    const chunk = uniqueUserIds.slice(start, start + CONTACT_BLOCK_BATCH_SIZE);
    const { data, error } = await adminClient
      .from("dating_contact_blocks")
      .select("user_id,block_type,value_hash")
      .in("user_id", chunk);

    if (error) {
      if (isMissingDatingContactBlocksTableError(error)) return new Map();
      throw error;
    }

    for (const row of (data ?? []) as ContactBlockRow[]) {
      const userId = String(row.user_id ?? "").trim();
      const type = row.block_type === "phone" || row.block_type === "instagram" ? row.block_type : null;
      const valueHash = String(row.value_hash ?? "").trim();
      if (!userId || !type || !valueHash) continue;
      addHash(blockMap, userId, type, valueHash);
    }
  }

  return blockMap;
}

export function isDatingContactPhoneBlockedPair({
  sourceUserId,
  sourcePhone,
  candidateUserId,
  candidatePhone,
  blockMap,
}: {
  sourceUserId: string;
  sourcePhone?: string | null;
  candidateUserId: string;
  candidatePhone?: string | null;
  blockMap: DatingContactBlockMap;
}) {
  if (!sourceUserId || !candidateUserId || sourceUserId === candidateUserId) return false;

  const sourcePhoneE164 = normalizeDatingContactPhone(String(sourcePhone ?? ""));
  const candidatePhoneE164 = normalizeDatingContactPhone(String(candidatePhone ?? ""));

  if (
    candidatePhoneE164 &&
    hasHash(blockMap, sourceUserId, "phone", hashDatingContactBlockValue("phone", candidatePhoneE164))
  ) {
    return true;
  }
  if (
    sourcePhoneE164 &&
    hasHash(blockMap, candidateUserId, "phone", hashDatingContactBlockValue("phone", sourcePhoneE164))
  ) {
    return true;
  }

  return false;
}

async function getPhoneByUserId(adminClient: SupabaseClient, userIds: string[]) {
  const uniqueUserIds = [...new Set(userIds.map((id) => String(id ?? "").trim()).filter(Boolean))];
  const phoneByUserId = new Map<string, string>();
  if (uniqueUserIds.length === 0) return phoneByUserId;

  const { data, error } = await adminClient
    .from("profiles")
    .select("user_id,phone_e164")
    .in("user_id", uniqueUserIds);

  if (error) {
    const message = String(error.message ?? "").toLowerCase();
    if (message.includes("phone_e164") || message.includes("could not find")) return phoneByUserId;
    throw error;
  }

  for (const row of (data ?? []) as ProfilePhoneRow[]) {
    const userId = String(row.user_id ?? "").trim();
    const phone = normalizeDatingContactPhone(String(row.phone_e164 ?? ""));
    if (userId && phone) phoneByUserId.set(userId, phone);
  }
  return phoneByUserId;
}

async function getLatestInstagramIdsByOwner(adminClient: SupabaseClient, userIds: string[]) {
  const uniqueUserIds = [...new Set(userIds.map((id) => String(id ?? "").trim()).filter(Boolean))];
  const idsByUserId = new Map<string, Set<string>>();
  if (uniqueUserIds.length === 0) return idsByUserId;

  const { data, error } = await adminClient
    .from("dating_cards")
    .select("owner_user_id,instagram_id")
    .in("owner_user_id", uniqueUserIds)
    .order("created_at", { ascending: false })
    .limit(Math.max(uniqueUserIds.length * 5, 50));

  if (error) throw error;

  for (const row of (data ?? []) as Array<{ owner_user_id: string | null; instagram_id: string | null }>) {
    const userId = String(row.owner_user_id ?? "").trim();
    const instagram = normalizeDatingContactInstagram(String(row.instagram_id ?? ""));
    if (!userId || !instagram) continue;
    const bucket = idsByUserId.get(userId) ?? new Set<string>();
    bucket.add(instagram);
    idsByUserId.set(userId, bucket);
  }
  return idsByUserId;
}

export async function filterDatingCardsByContactBlocks<T extends DatingContactBlockCardLike>(
  adminClient: SupabaseClient,
  viewerUserId: string,
  cards: T[]
): Promise<T[]> {
  if (!viewerUserId || cards.length === 0) return cards;
  const ownerIds = [
    ...new Set(cards.map((row) => String(row.owner_user_id ?? "").trim()).filter((id) => id && id !== viewerUserId)),
  ];
  if (ownerIds.length === 0) return cards;

  const [blockMap, phoneByUserId, instagramIdsByOwner] = await Promise.all([
    getDatingContactBlockMapForUsers(adminClient, [viewerUserId, ...ownerIds]),
    getPhoneByUserId(adminClient, [viewerUserId, ...ownerIds]),
    getLatestInstagramIdsByOwner(adminClient, [viewerUserId]),
  ]);

  if (blockMap.size === 0) return cards;

  const viewerPhone = phoneByUserId.get(viewerUserId) ?? "";
  const viewerPhoneHash = viewerPhone ? hashDatingContactBlockValue("phone", viewerPhone) : "";
  const viewerInstagramHashes = [...(instagramIdsByOwner.get(viewerUserId) ?? new Set<string>())].map((instagram) =>
    hashDatingContactBlockValue("instagram", instagram)
  );

  return cards.filter((card) => {
    const ownerId = String(card.owner_user_id ?? "").trim();
    if (!ownerId || ownerId === viewerUserId) return true;

    const ownerPhone = phoneByUserId.get(ownerId) ?? "";
    if (ownerPhone && hasHash(blockMap, viewerUserId, "phone", hashDatingContactBlockValue("phone", ownerPhone))) {
      return false;
    }

    const ownerInstagram = normalizeDatingContactInstagram(String(card.instagram_id ?? ""));
    if (
      ownerInstagram &&
      hasHash(blockMap, viewerUserId, "instagram", hashDatingContactBlockValue("instagram", ownerInstagram))
    ) {
      return false;
    }

    if (viewerPhoneHash && hasHash(blockMap, ownerId, "phone", viewerPhoneHash)) {
      return false;
    }

    for (const instagramHash of viewerInstagramHashes) {
      if (hasHash(blockMap, ownerId, "instagram", instagramHash)) return false;
    }

    return true;
  });
}

export async function hasDatingContactBlockBetween(
  adminClient: SupabaseClient,
  userAId: string,
  userBId: string,
  options: {
    userAInstagramIds?: Array<string | null | undefined>;
    userBInstagramIds?: Array<string | null | undefined>;
  } = {}
) {
  if (!userAId || !userBId || userAId === userBId) return false;

  const [blockMap, phoneByUserId, fallbackInstagramIdsByOwner] = await Promise.all([
    getDatingContactBlockMapForUsers(adminClient, [userAId, userBId]),
    getPhoneByUserId(adminClient, [userAId, userBId]),
    getLatestInstagramIdsByOwner(adminClient, [userAId, userBId]),
  ]);
  if (blockMap.size === 0) return false;

  const aPhones = [phoneByUserId.get(userAId)].filter((value): value is string => Boolean(value));
  const bPhones = [phoneByUserId.get(userBId)].filter((value): value is string => Boolean(value));
  const aInstagrams = [
    ...(options.userAInstagramIds ?? []),
    ...(fallbackInstagramIdsByOwner.get(userAId) ?? new Set<string>()),
  ]
    .map((value) => normalizeDatingContactInstagram(String(value ?? "")))
    .filter(Boolean);
  const bInstagrams = [
    ...(options.userBInstagramIds ?? []),
    ...(fallbackInstagramIdsByOwner.get(userBId) ?? new Set<string>()),
  ]
    .map((value) => normalizeDatingContactInstagram(String(value ?? "")))
    .filter(Boolean);

  for (const phone of bPhones) {
    if (hasHash(blockMap, userAId, "phone", hashDatingContactBlockValue("phone", phone))) return true;
  }
  for (const instagram of bInstagrams) {
    if (hasHash(blockMap, userAId, "instagram", hashDatingContactBlockValue("instagram", instagram))) return true;
  }
  for (const phone of aPhones) {
    if (hasHash(blockMap, userBId, "phone", hashDatingContactBlockValue("phone", phone))) return true;
  }
  for (const instagram of aInstagrams) {
    if (hasHash(blockMap, userBId, "instagram", hashDatingContactBlockValue("instagram", instagram))) return true;
  }

  return false;
}
