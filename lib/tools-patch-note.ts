import { createAdminClient } from "@/lib/supabase/server";

export const TOOLS_PATCH_NOTE_SETTING_KEY = "tools_patch_note";

export type ToolsPatchNoteSetting = {
  enabled: boolean;
  text: string;
};

export const DEFAULT_TOOLS_PATCH_NOTE: ToolsPatchNoteSetting = {
  enabled: false,
  text: "",
};

export function normalizeToolsPatchNote(value: unknown): ToolsPatchNoteSetting {
  if (!value || typeof value !== "object") return DEFAULT_TOOLS_PATCH_NOTE;

  const raw = value as Record<string, unknown>;
  const enabled = typeof raw.enabled === "boolean" ? raw.enabled : DEFAULT_TOOLS_PATCH_NOTE.enabled;
  const text = typeof raw.text === "string" ? raw.text.trim().replace(/\s{2,}/g, " ").slice(0, 100) : "";

  return {
    enabled: enabled && text.length > 0,
    text,
  };
}

export async function readToolsPatchNote() {
  const adminClient = createAdminClient();
  const { data, error } = await adminClient
    .from("site_settings")
    .select("value_json")
    .eq("key", TOOLS_PATCH_NOTE_SETTING_KEY)
    .maybeSingle();

  if (error) {
    console.error("[readToolsPatchNote] failed", error);
    return DEFAULT_TOOLS_PATCH_NOTE;
  }

  return normalizeToolsPatchNote(data?.value_json);
}
