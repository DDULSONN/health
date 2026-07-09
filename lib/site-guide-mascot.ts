import { createAdminClient } from "@/lib/supabase/server";

export const SITE_GUIDE_MASCOT_SETTING_KEY = "site_guide_mascot";

export type SiteGuideMascotOption = {
  id: string;
  label: string;
  src: string;
};

export const SITE_GUIDE_MASCOT_OPTIONS: SiteGuideMascotOption[] = [
  {
    id: "default",
    label: "기본 짐냥이",
    src: "/mascot/jimnyang-guide-v2.png",
  },
  {
    id: "summer",
    label: "여름 짐냥이",
    src: "/mascot/jimnyang-summer.webp",
  },
  {
    id: "rain",
    label: "비 오는 짐냥이",
    src: "/mascot/jimnyang-rain.webp",
  },
] as const satisfies SiteGuideMascotOption[];

export type SiteGuideMascotId = string;

export type SiteGuideMascotSetting = {
  selectedId: SiteGuideMascotId;
  selected: SiteGuideMascotOption;
  options: SiteGuideMascotOption[];
  customOptions: SiteGuideMascotOption[];
};

export const DEFAULT_SITE_GUIDE_MASCOT_ID: SiteGuideMascotId = "default";

function normalizeCustomMascotOptions(raw: unknown): SiteGuideMascotOption[] {
  if (!Array.isArray(raw)) return [];

  const seen = new Set(SITE_GUIDE_MASCOT_OPTIONS.map((option) => option.id));
  return raw
    .map((item): SiteGuideMascotOption | null => {
      const value = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const id = typeof value.id === "string" ? value.id.trim() : "";
      const label = typeof value.label === "string" ? value.label.trim() : "";
      const src = typeof value.src === "string" ? value.src.trim() : "";
      const allowedSrc = src.startsWith("/i/public-lite/community/site-guide-mascots/");
      if (!id.startsWith("custom-") || seen.has(id) || !label || !allowedSrc) return null;
      seen.add(id);
      return { id, label: label.slice(0, 30), src };
    })
    .filter((item): item is SiteGuideMascotOption => Boolean(item))
    .slice(-20);
}

export function normalizeSiteGuideMascotSetting(value: unknown): SiteGuideMascotSetting {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const customOptions = normalizeCustomMascotOptions(raw.customOptions);
  const options = [...SITE_GUIDE_MASCOT_OPTIONS, ...customOptions];
  const requestedId = typeof raw.selectedId === "string" ? raw.selectedId : typeof raw.id === "string" ? raw.id : "";
  const selected = options.find((option) => option.id === requestedId) ?? options[0];

  return {
    selectedId: selected.id,
    selected,
    options,
    customOptions,
  };
}

export async function readSiteGuideMascotSetting(): Promise<SiteGuideMascotSetting> {
  const adminClient = createAdminClient();
  const { data, error } = await adminClient
    .from("site_settings")
    .select("value_json")
    .eq("key", SITE_GUIDE_MASCOT_SETTING_KEY)
    .maybeSingle();

  if (error) {
    console.error("[readSiteGuideMascotSetting] failed", error);
    return normalizeSiteGuideMascotSetting({ selectedId: DEFAULT_SITE_GUIDE_MASCOT_ID });
  }

  return normalizeSiteGuideMascotSetting(data?.value_json);
}
