import type { SupabaseClient } from "@supabase/supabase-js";
import { buildSignedImageUrl, extractStorageObjectPathFromBuckets } from "@/lib/images";

export type DatingOneOnOneWriteStatus = "approved" | "paused";
export const DATING_ONE_ON_ONE_ACTIVE_STATUSES = ["submitted", "reviewing", "approved"] as const;
export const DATING_ONE_ON_ONE_AUTO_EXPIRE_DAYS = 30;
export const DATING_ONE_ON_ONE_MATCH_SOURCE_PENDING_STATES = ["proposed", "candidate_accepted"] as const;
export const DATING_ONE_ON_ONE_MATCH_CANDIDATE_PENDING_STATES = ["source_selected"] as const;
export const DATING_ONE_ON_ONE_MATCH_TERMINAL_STATES = [
  "source_skipped",
  "candidate_rejected",
  "source_declined",
  "admin_canceled",
  "mutual_accepted",
] as const;
export const DATING_ONE_ON_ONE_MATCH_ACTIVE_PAIR_STATES = [
  "proposed",
  "source_selected",
  "candidate_accepted",
  "mutual_accepted",
] as const;
export const DATING_ONE_ON_ONE_MATCH_CANDIDATE_SINGLE_TRACK_STATES = [
  "source_selected",
  "candidate_accepted",
  "mutual_accepted",
] as const;

export type DatingOneOnOneMatchState =
  | "proposed"
  | "source_selected"
  | "source_skipped"
  | "candidate_accepted"
  | "candidate_rejected"
  | "source_declined"
  | "admin_canceled"
  | "mutual_accepted";

export type DatingOneOnOneCardDetail = {
  id: string;
  user_id: string;
  sex: "male" | "female";
  name: string;
  birth_year: number;
  age: number | null;
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
  photo_signed_urls: string[];
};

export type DatingOneOnOneMatchRow = {
  id: string;
  source_card_id: string;
  source_user_id: string;
  candidate_card_id: string;
  candidate_user_id: string;
  state: DatingOneOnOneMatchState;
  admin_sent_by_user_id: string | null;
  source_selected_at: string | null;
  candidate_responded_at: string | null;
  source_final_responded_at: string | null;
  created_at: string;
  updated_at: string;
};

type DatingOneOnOneCardRow = {
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

type SiteSettingRow = {
  value_json: Record<string, unknown> | null;
};

type ProfilePhoneRow = {
  phone_verified: boolean | null;
  phone_e164: string | null;
  phone_verified_at: string | null;
};

export async function getDatingOneOnOneWriteStatus(
  adminClient: SupabaseClient
): Promise<DatingOneOnOneWriteStatus> {
  const { data } = await adminClient
    .from("site_settings")
    .select("value_json")
    .eq("key", "dating_1on1_write_status")
    .maybeSingle<SiteSettingRow>();

  const statusRaw =
    data && data.value_json && typeof data.value_json.status === "string"
      ? data.value_json.status
      : "approved";

  return statusRaw === "approved" ? "approved" : "paused";
}

export async function getProfilePhoneVerification(
  adminClient: SupabaseClient,
  userId: string
): Promise<{ phoneVerified: boolean; phoneE164: string | null; phoneVerifiedAt: string | null }> {
  const { data } = await adminClient
    .from("profiles")
    .select("phone_verified,phone_e164,phone_verified_at")
    .eq("user_id", userId)
    .maybeSingle<ProfilePhoneRow>();

  return {
    phoneVerified: data?.phone_verified === true,
    phoneE164: data?.phone_e164 ?? null,
    phoneVerifiedAt: data?.phone_verified_at ?? null,
  };
}

export function getDatingOneOnOneExpireBeforeIso(now = new Date()): string {
  return new Date(now.getTime() - DATING_ONE_ON_ONE_AUTO_EXPIRE_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

export function normalizeDatingOneOnOnePhotoPath(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim();
  if (!trimmed) return "";
  return extractStorageObjectPathFromBuckets(trimmed, ["dating-1on1-photos"]) ?? trimmed;
}

export function toDatingOneOnOneAge(birthYear: number | null | undefined): number | null {
  if (!birthYear || !Number.isFinite(birthYear)) return null;
  return new Date().getFullYear() - birthYear + 1;
}

export function toDatingOneOnOneCardDetail(row: DatingOneOnOneCardRow): DatingOneOnOneCardDetail {
  const photoPaths = Array.isArray(row.photo_paths)
    ? row.photo_paths
        .map((path) => normalizeDatingOneOnOnePhotoPath(path))
        .filter((path): path is string => typeof path === "string" && path.length > 0)
    : [];

  return {
    id: row.id,
    user_id: row.user_id,
    sex: row.sex,
    name: row.name,
    birth_year: row.birth_year,
    age: toDatingOneOnOneAge(row.birth_year),
    height_cm: row.height_cm,
    job: row.job,
    region: row.region,
    intro_text: row.intro_text,
    strengths_text: row.strengths_text,
    preferred_partner_text: row.preferred_partner_text,
    smoking: row.smoking,
    workout_frequency: row.workout_frequency,
    status: row.status,
    created_at: row.created_at,
    photo_signed_urls: photoPaths
      .map((path) => buildSignedImageUrl("dating-1on1-photos", path))
      .filter((url) => url.length > 0),
  };
}

export async function getDatingOneOnOneCardsByIds(
  adminClient: SupabaseClient,
  ids: string[]
): Promise<Map<string, DatingOneOnOneCardDetail>> {
  const uniqueIds = [...new Set(ids.map((id) => id.trim()).filter((id) => id.length > 0))];
  if (uniqueIds.length === 0) {
    return new Map();
  }

  const { data, error } = await adminClient
    .from("dating_1on1_cards")
    .select(
      "id,user_id,sex,name,birth_year,height_cm,job,region,intro_text,strengths_text,preferred_partner_text,smoking,workout_frequency,status,created_at,photo_paths"
    )
    .in("id", uniqueIds);

  if (error) {
    throw error;
  }

  return new Map((data ?? []).map((row) => [row.id, toDatingOneOnOneCardDetail(row as DatingOneOnOneCardRow)]));
}

export async function expireStaleDatingOneOnOneCards(
  adminClient: SupabaseClient,
  userId?: string | null
): Promise<number> {
  const nowIso = new Date().toISOString();
  let query = adminClient
    .from("dating_1on1_cards")
    .update({
      status: "rejected",
      reviewed_at: nowIso,
      updated_at: nowIso,
    })
    .in("status", [...DATING_ONE_ON_ONE_ACTIVE_STATUSES])
    .lt("created_at", getDatingOneOnOneExpireBeforeIso())
    .select("id");

  if (userId) {
    query = query.eq("user_id", userId);
  }

  const { data, error } = await query;
  if (error) {
    throw error;
  }
  return Array.isArray(data) ? data.length : 0;
}
