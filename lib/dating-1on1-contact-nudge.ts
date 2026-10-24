import type { OneOnOneContactReply } from "@/lib/dating-1on1-contact-reply";

export const ONE_ON_ONE_CONTACT_NUDGE_DELAY_HOURS = 0;
export const ONE_ON_ONE_CONTACT_NUDGE_DELAY_MS = ONE_ON_ONE_CONTACT_NUDGE_DELAY_HOURS * 60 * 60 * 1000;

export const ONE_ON_ONE_CONTACT_NUDGE_PRESETS = [
  {
    key: "want_to_exchange",
    message: "저는 연락처를 교환하고 싶어요 🙂",
  },
  {
    key: "when_comfortable",
    message: "부담 없으실 때 연락처 교환 진행해 주세요!",
  },
  {
    key: "coffee_on_me",
    message: "연락처 교환해 주시면 첫 커피는 제가 살게요 ☕",
  },
  {
    key: "keep_talking",
    message: "조금 더 이야기해보고 싶어요. 연락처 교환 어떠세요?",
  },
] as const;

// Historical messages remain valid and are never rewritten on behalf of senders.
export const ONE_ON_ONE_CONTACT_GREETING_PRESETS = [
  { key: "nice_to_meet", message: "반가워요. 편하게 이야기 나눠보고 싶어요 🙂" },
  { key: "coffee_together", message: "처음엔 가볍게 커피 한잔하면 좋겠어요 ☕" },
  { key: "workout_chat", message: "운동 이야기부터 나눠봐도 좋겠네요!" },
] as const;

const ALL_CONTACT_NUDGE_PRESETS = [...ONE_ON_ONE_CONTACT_NUDGE_PRESETS, ...ONE_ON_ONE_CONTACT_GREETING_PRESETS];
export type OneOnOneContactNudgePresetKey = (typeof ALL_CONTACT_NUDGE_PRESETS)[number]["key"];

export type OneOnOneContactNudgeItem = {
  id?: string;
  read_at?: string | null;
  preset_key: OneOnOneContactNudgePresetKey;
  message_text: string;
  created_at: string;
  sender_display_name?: string | null;
  reply?: OneOnOneContactReply | null;
};

export type OneOnOneContactNudgeSummary = {
  available: boolean;
  read_receipts_available?: boolean;
  can_mark_read?: boolean;
  replies_available?: boolean;
  can_reply?: boolean;
  greetings_available?: boolean;
  eligible_at: string | null;
  can_send: boolean;
  sent_by_me: OneOnOneContactNudgeItem | null;
  received_from_other: OneOnOneContactNudgeItem | null;
};

export function canConfirmOneOnOneContactNudge(match: {
  state?: string | null;
  contact_exchange_status?: string | null;
}) {
  return match.state === "mutual_accepted" &&
    ["none", "awaiting_applicant_payment", "payment_pending_admin", "approved"].includes(match.contact_exchange_status ?? "");
}

export function isMissingContactNudgeReadColumn(error: { code?: string | null; message?: string | null }) {
  return ["42703", "PGRST204"].includes(error.code ?? "") &&
    /\bread_at\b/i.test(error.message ?? "");
}

function normalizeOneOnOneSenderName(value: string | null | undefined) {
  return typeof value === "string" ? value.replace(/[\r\n]+/g, " ").trim().slice(0, 30) : "";
}

export function getOneOnOneContactNudgeSenderDisplayName(options: {
  storedSenderName?: string | null;
  oneOnOneCardName?: string | null;
  actorNickname?: string | null;
}) {
  return normalizeOneOnOneSenderName(options.storedSenderName) ||
    normalizeOneOnOneSenderName(options.oneOnOneCardName) ||
    normalizeOneOnOneSenderName(options.actorNickname);
}

export function getOneOnOneContactNudgeMessage(value: unknown) {
  if (typeof value !== "string") return null;
  return ALL_CONTACT_NUDGE_PRESETS.find((preset) => preset.key === value) ?? null;
}

export function buildOneOnOneContactNudgeEmail(message: string, senderDisplayName?: string | null) {
  const preset = ALL_CONTACT_NUDGE_PRESETS.find((item) => item.message === message);
  const safeMessage = preset?.message ?? "연락처를 교환하고 싶다는 한마디가 도착했어요.";
  const safeSenderName = getOneOnOneContactNudgeSenderDisplayName({ storedSenderName: senderDisplayName });
  const senderSubject = safeSenderName ? `${safeSenderName}님이` : "1:1 상대가";
  return {
    subject: `[짐툴] ${senderSubject} 한마디를 보냈어요`,
    text: [
      `${senderSubject} 1:1 한마디를 보냈어요.`,
      "",
      `“${safeMessage}”`,
      "",
      "연락처 교환 후 잠수하거나 상대방에게 불쾌한 언행을 할 경우 제재 대상입니다.",
      "",
      "짐툴 1:1 매칭 화면에서 확인하고, 원하시면 연락처 교환을 진행해 주세요.",
    ].join("\n"),
  };
}

type ContactNudgeMatchState = {
  state?: string | null;
  contact_exchange_status?: string | null;
  contact_exchange_paid_at?: string | null;
  contact_exchange_paid_by_user_id?: string | null;
  source_final_responded_at?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
};

export function getOneOnOneContactNudgeEligibility(match: ContactNudgeMatchState, nowMs = Date.now(), delayHours = ONE_ON_ONE_CONTACT_NUDGE_DELAY_HOURS) {
  const basis = match.source_final_responded_at ?? match.updated_at ?? match.created_at ?? "";
  const basisMs = Date.parse(basis);
  const eligibleAtMs = Number.isFinite(basisMs) ? basisMs + delayHours * 60 * 60 * 1000 : Number.NaN;
  const unpaid = !match.contact_exchange_paid_at && !match.contact_exchange_paid_by_user_id;
  const pending =
    match.state === "mutual_accepted" &&
    match.contact_exchange_status === "awaiting_applicant_payment" &&
    unpaid;

  return {
    eligibleAt: Number.isFinite(eligibleAtMs) ? new Date(eligibleAtMs).toISOString() : null,
    eligible: pending && Number.isFinite(eligibleAtMs) && nowMs >= eligibleAtMs,
  };
}
