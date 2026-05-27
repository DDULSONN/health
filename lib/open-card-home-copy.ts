import { createAdminClient } from "@/lib/supabase/server";

export const OPEN_CARD_HOME_COPY_SETTING_KEY = "open_card_home_copy";

export type OpenCardHomeCopySetting = {
  subtitle: string;
};

export const DEFAULT_OPEN_CARD_HOME_COPY: OpenCardHomeCopySetting = {
  subtitle: "둘러보고 바로 지원하거나, 내 카드도 자연스럽게 공개할 수 있어요.",
};

export function normalizeOpenCardHomeCopy(value: unknown): OpenCardHomeCopySetting {
  if (!value || typeof value !== "object") return DEFAULT_OPEN_CARD_HOME_COPY;

  const raw = value as Record<string, unknown>;
  const subtitle =
    typeof raw.subtitle === "string" && raw.subtitle.trim().length > 0
      ? raw.subtitle.trim().slice(0, 90)
      : DEFAULT_OPEN_CARD_HOME_COPY.subtitle;

  return { subtitle };
}

export async function readOpenCardHomeCopy() {
  const adminClient = createAdminClient();
  const { data, error } = await adminClient
    .from("site_settings")
    .select("value_json")
    .eq("key", OPEN_CARD_HOME_COPY_SETTING_KEY)
    .maybeSingle();

  if (error) {
    console.error("[readOpenCardHomeCopy] failed", error);
    return DEFAULT_OPEN_CARD_HOME_COPY;
  }

  return normalizeOpenCardHomeCopy(data?.value_json);
}
