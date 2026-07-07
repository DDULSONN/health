export const OPEN_CARD_LIMIT_MALE = 30;
export const OPEN_CARD_LIMIT_FEMALE = 30;
export const OPEN_CARD_SATURDAY_LIMIT_MALE = 30;
export const OPEN_CARD_SATURDAY_LIMIT_FEMALE = 30;
export const OPEN_CARD_EXPIRE_HOURS = 24;
export const OPEN_CARD_AUTO_REQUEUE_LIMIT = 2;
export const OPEN_CARD_PUBLIC_SLOT_SETTING_KEY = "open_card_public_slots";

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const MAX_EXTRA_OPEN_CARD_PUBLIC_SLOTS = 200;

type OpenCardPublicSlotSetting = {
  maleExtra: number;
  femaleExtra: number;
};

type SiteSettingsClient = {
  // Supabase's query builder is thenable and deeply generic; keep this small helper client intentionally loose.
  from: (table: "site_settings") => unknown;
};

type SiteSettingsQuery = {
  select: (columns: string) => {
    eq: (column: string, value: string) => {
      maybeSingle: () => PromiseLike<{ data: { value_json?: unknown } | null; error: unknown }>;
    };
  };
};

function getKstDate(now = new Date()) {
  return new Date(now.getTime() + KST_OFFSET_MS);
}

export function isKstSaturday(now = new Date()) {
  return getKstDate(now).getUTCDay() === 6;
}

export function getOpenCardLimitBySex(sex: "male" | "female", now = new Date()): number {
  const isSaturday = isKstSaturday(now);
  if (sex === "female") {
    return isSaturday ? OPEN_CARD_SATURDAY_LIMIT_FEMALE : OPEN_CARD_LIMIT_FEMALE;
  }
  return isSaturday ? OPEN_CARD_SATURDAY_LIMIT_MALE : OPEN_CARD_LIMIT_MALE;
}

function normalizeExtraSlot(value: unknown) {
  const numeric = Math.floor(Number(value ?? 0));
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(MAX_EXTRA_OPEN_CARD_PUBLIC_SLOTS, numeric));
}

export function normalizeOpenCardPublicSlotSetting(value: unknown): OpenCardPublicSlotSetting {
  if (!value || typeof value !== "object") {
    return { maleExtra: 0, femaleExtra: 0 };
  }

  const raw = value as { maleExtra?: unknown; femaleExtra?: unknown; male_extra?: unknown; female_extra?: unknown };
  return {
    maleExtra: normalizeExtraSlot(raw.maleExtra ?? raw.male_extra),
    femaleExtra: normalizeExtraSlot(raw.femaleExtra ?? raw.female_extra),
  };
}

export async function readOpenCardPublicSlotSetting(adminClient: SiteSettingsClient): Promise<OpenCardPublicSlotSetting> {
  const siteSettings = adminClient.from("site_settings") as SiteSettingsQuery;
  const { data, error } = await siteSettings
    .select("value_json")
    .eq("key", OPEN_CARD_PUBLIC_SLOT_SETTING_KEY)
    .maybeSingle();

  if (error) {
    console.error("[open-card-public-slots] read failed", error);
    return { maleExtra: 0, femaleExtra: 0 };
  }

  return normalizeOpenCardPublicSlotSetting(data?.value_json);
}

export async function getOpenCardEffectiveLimitBySex(
  adminClient: SiteSettingsClient,
  sex: "male" | "female",
  now = new Date()
): Promise<number> {
  const baseLimit = getOpenCardLimitBySex(sex, now);
  const setting = await readOpenCardPublicSlotSetting(adminClient);
  return baseLimit + (sex === "female" ? setting.femaleExtra : setting.maleExtra);
}

export function getKstDayRangeUtc(now = new Date()): { startUtcIso: string; endUtcIso: string } {
  const kstNowMs = now.getTime() + KST_OFFSET_MS;
  const kstDayStartMs = Math.floor(kstNowMs / (24 * 60 * 60 * 1000)) * 24 * 60 * 60 * 1000;
  const startUtcMs = kstDayStartMs - KST_OFFSET_MS;
  const endUtcMs = startUtcMs + 24 * 60 * 60 * 1000;
  return {
    startUtcIso: new Date(startUtcMs).toISOString(),
    endUtcIso: new Date(endUtcMs).toISOString(),
  };
}

export function formatRemainingToKorean(expiresAtIso: string, now = new Date()): string {
  const diffMs = new Date(expiresAtIso).getTime() - now.getTime();
  if (diffMs <= 0) return "만료됨";

  const totalMinutes = Math.floor(diffMs / (60 * 1000));
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  if (days >= 1) return `${days}일 ${hours}시간 남음`;
  if (hours >= 1) return `${hours}시간 ${minutes}분 남음`;
  return `${Math.max(1, minutes)}분 남음`;
}
