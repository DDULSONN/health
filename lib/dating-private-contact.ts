// Shared input/display contract. Never put a phone in this payload.
export type PayerContactChoice = { mode: "instagram"; instagram: string };
export const PRIVATE_CONTACT_MARKER = "instagram:v1:";

export function normalizeContactInstagram(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const handle = value.trim().replace(/^@/, "").toLowerCase();
  return /^(?!.*\.\.)(?!\.)(?!.*\.$)[a-z0-9._]{1,30}$/.test(handle) ? handle : null;
}

export function parsePayerContact(value: unknown): PayerContactChoice | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("공개할 연락처를 다시 확인해 주세요.");
  const input = value as Record<string, unknown>;
  const instagram = normalizeContactInstagram(input.instagram);
  if (input.mode !== "instagram" || !instagram) throw new Error("인스타 아이디를 확인해 주세요. @ 뒤의 아이디만 입력해 주세요.");
  return { mode: "instagram", instagram };
}

export type ExchangedContact = {
  counterparty_phone?: string | null;
  counterparty_instagram?: string | null;
  contact_chat_url?: string | null;
  my_contact_method?: "phone" | "instagram";
};
