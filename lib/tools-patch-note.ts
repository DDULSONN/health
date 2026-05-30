import { createAdminClient } from "@/lib/supabase/server";

export const TOOLS_PATCH_NOTE_SETTING_KEY = "tools_patch_note";

export type ToolsPatchNoteItem = {
  id: string;
  text: string;
  createdAt: string;
};

export type ToolsPatchNoteSetting = {
  enabled: boolean;
  text: string;
  items: ToolsPatchNoteItem[];
};

export const DEFAULT_TOOLS_PATCH_NOTE: ToolsPatchNoteSetting = {
  enabled: false,
  text: "",
  items: [],
};

export function normalizeToolsPatchNoteText(value: unknown, max = 120): string {
  return typeof value === "string" ? value.trim().replace(/\s{2,}/g, " ").slice(0, max) : "";
}

function normalizeToolsPatchNoteItem(value: unknown): ToolsPatchNoteItem | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const text = normalizeToolsPatchNoteText(raw.text);
  if (!text) return null;
  const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim().slice(0, 80) : crypto.randomUUID();
  const createdAtRaw = typeof raw.createdAt === "string" ? raw.createdAt : typeof raw.created_at === "string" ? raw.created_at : "";
  const createdAt = Number.isFinite(Date.parse(createdAtRaw)) ? new Date(createdAtRaw).toISOString() : new Date().toISOString();
  return { id, text, createdAt };
}

export function normalizeToolsPatchNote(value: unknown): ToolsPatchNoteSetting {
  if (!value || typeof value !== "object") return DEFAULT_TOOLS_PATCH_NOTE;

  const raw = value as Record<string, unknown>;
  const enabled = typeof raw.enabled === "boolean" ? raw.enabled : DEFAULT_TOOLS_PATCH_NOTE.enabled;
  const legacyText = normalizeToolsPatchNoteText(raw.text);
  const items = Array.isArray(raw.items)
    ? raw.items.map((item) => normalizeToolsPatchNoteItem(item)).filter((item): item is ToolsPatchNoteItem => Boolean(item))
    : [];
  const normalizedItems = items.length > 0 ? items : legacyText ? [{ id: "legacy", text: legacyText, createdAt: new Date().toISOString() }] : [];
  const text = normalizedItems[0]?.text ?? "";

  return {
    enabled: enabled && normalizedItems.length > 0,
    text,
    items: normalizedItems.slice(0, 20),
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
