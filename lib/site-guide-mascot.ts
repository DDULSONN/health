import { createAdminClient } from "@/lib/supabase/server";

export const SITE_GUIDE_MASCOT_SETTING_KEY = "site_guide_mascot";

export const SITE_GUIDE_MASCOT_OPTIONS = [
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
] as const;

export type SiteGuideMascotId = (typeof SITE_GUIDE_MASCOT_OPTIONS)[number]["id"];

export type SiteGuideMascotSetting = {
  selectedId: SiteGuideMascotId;
  selected: (typeof SITE_GUIDE_MASCOT_OPTIONS)[number];
  options: typeof SITE_GUIDE_MASCOT_OPTIONS;
};

export const DEFAULT_SITE_GUIDE_MASCOT_ID: SiteGuideMascotId = "default";

export function normalizeSiteGuideMascotSetting(value: unknown): SiteGuideMascotSetting {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const requestedId = typeof raw.selectedId === "string" ? raw.selectedId : typeof raw.id === "string" ? raw.id : "";
  const selected = SITE_GUIDE_MASCOT_OPTIONS.find((option) => option.id === requestedId) ?? SITE_GUIDE_MASCOT_OPTIONS[0];

  return {
    selectedId: selected.id,
    selected,
    options: SITE_GUIDE_MASCOT_OPTIONS,
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
