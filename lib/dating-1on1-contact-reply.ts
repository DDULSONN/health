export const ONE_ON_ONE_CONTACT_REPLY_PRESETS = [
  { key: "happy_to_talk", message: "좋아요, 연락 나눠봐요." },
  { key: "available_this_week", message: "이번 주에 연락 가능해요." },
  { key: "not_right_now", message: "지금은 어려울 것 같아요." },
] as const;

export type OneOnOneContactReplyKey = (typeof ONE_ON_ONE_CONTACT_REPLY_PRESETS)[number]["key"];
export type OneOnOneContactReply = {
  preset_key: OneOnOneContactReplyKey;
  message_text: string;
  created_at: string;
};

export function getOneOnOneContactReplyPreset(key: unknown) {
  return ONE_ON_ONE_CONTACT_REPLY_PRESETS.find(preset => preset.key === key) ?? null;
}

export function parseOneOnOneContactReply(value: unknown): OneOnOneContactReply | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const preset = getOneOnOneContactReplyPreset(row.preset_key);
  if (!preset || typeof row.created_at !== "string" || !Number.isFinite(Date.parse(row.created_at))) return null;
  return { preset_key: preset.key, message_text: preset.message, created_at: row.created_at };
}

// Replies express intent only. Never use this value to authorize payment or phone disclosure.
export function canReplyToOneOnOneContactNudge(match: {
  state?: string | null;
  contact_exchange_status?: string | null;
  contact_exchange_paid_at?: string | null;
  contact_exchange_paid_by_user_id?: string | null;
}) {
  return match.state === "mutual_accepted" &&
    match.contact_exchange_status === "awaiting_applicant_payment" &&
    !match.contact_exchange_paid_at && !match.contact_exchange_paid_by_user_id;
}
