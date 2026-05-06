import crypto from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizePhoneToE164, isLikelyKoreanMobileE164, isLikelyValidE164 } from "@/lib/phone-verification";

type PhoneBlockRow = {
  user_id: string | null;
  phone_hash: string | null;
};

export type OneOnOnePhoneBlockMap = Map<string, Set<string>>;

const PHONE_BLOCK_BATCH_SIZE = 500;

function getPhoneBlockSecret() {
  return (
    process.env.PHONE_BLOCK_HASH_SECRET?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.NEXTAUTH_SECRET?.trim() ||
    "local-phone-block-secret"
  );
}

export function normalizePhoneForOneOnOneBlock(raw: string): string {
  const normalized = normalizePhoneToE164(raw);
  if (!normalized || !isLikelyValidE164(normalized)) return "";
  if (normalized.startsWith("+82") && !isLikelyKoreanMobileE164(normalized)) return "";
  return normalized;
}

export function hashOneOnOneBlockedPhone(phoneE164: string) {
  return crypto.createHmac("sha256", getPhoneBlockSecret()).update(phoneE164).digest("hex");
}

export function maskBlockedPhone(phoneE164: string) {
  const digits = phoneE164.replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : "";
}

export function isMissingPhoneBlocksTableError(error: { message?: string; code?: string } | null | undefined) {
  const message = String(error?.message ?? "");
  return (
    error?.code === "42P01" ||
    message.includes("dating_1on1_phone_blocks") ||
    message.includes("schema cache")
  );
}

export async function getOneOnOnePhoneBlockMapForUsers(
  adminClient: SupabaseClient,
  userIds: string[]
): Promise<OneOnOnePhoneBlockMap> {
  const uniqueUserIds = [...new Set(userIds.map((id) => String(id ?? "").trim()).filter(Boolean))];
  const blockMap: OneOnOnePhoneBlockMap = new Map();
  if (uniqueUserIds.length === 0) return blockMap;

  for (let start = 0; start < uniqueUserIds.length; start += PHONE_BLOCK_BATCH_SIZE) {
    const chunk = uniqueUserIds.slice(start, start + PHONE_BLOCK_BATCH_SIZE);
    const { data, error } = await adminClient
      .from("dating_1on1_phone_blocks")
      .select("user_id,phone_hash")
      .in("user_id", chunk);

    if (error) {
      if (isMissingPhoneBlocksTableError(error)) return new Map();
      throw error;
    }

    for (const row of (data ?? []) as PhoneBlockRow[]) {
      const userId = String(row.user_id ?? "").trim();
      const phoneHash = String(row.phone_hash ?? "").trim();
      if (!userId || !phoneHash) continue;
      const bucket = blockMap.get(userId) ?? new Set<string>();
      bucket.add(phoneHash);
      blockMap.set(userId, bucket);
    }
  }

  return blockMap;
}

export function isOneOnOnePhoneBlockedPair({
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
  blockMap: OneOnOnePhoneBlockMap;
}) {
  if (!sourceUserId || !candidateUserId || sourceUserId === candidateUserId) return false;

  const sourcePhoneE164 = sourcePhone ? normalizePhoneForOneOnOneBlock(sourcePhone) : "";
  const candidatePhoneE164 = candidatePhone ? normalizePhoneForOneOnOneBlock(candidatePhone) : "";
  const sourceBlockedHashes = blockMap.get(sourceUserId);
  const candidateBlockedHashes = blockMap.get(candidateUserId);

  if (candidatePhoneE164 && sourceBlockedHashes?.has(hashOneOnOneBlockedPhone(candidatePhoneE164))) {
    return true;
  }
  if (sourcePhoneE164 && candidateBlockedHashes?.has(hashOneOnOneBlockedPhone(sourcePhoneE164))) {
    return true;
  }

  return false;
}
