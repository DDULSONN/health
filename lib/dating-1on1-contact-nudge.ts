export const ONE_ON_ONE_CONTACT_NUDGE_DELAY_MS = 48 * 60 * 60 * 1000;

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

export type OneOnOneContactNudgePresetKey = (typeof ONE_ON_ONE_CONTACT_NUDGE_PRESETS)[number]["key"];

export type OneOnOneContactNudgeItem = {
  preset_key: OneOnOneContactNudgePresetKey;
  message_text: string;
  created_at: string;
};

export type OneOnOneContactNudgeSummary = {
  available: boolean;
  eligible_at: string | null;
  can_send: boolean;
  sent_by_me: OneOnOneContactNudgeItem | null;
  received_from_other: OneOnOneContactNudgeItem | null;
};

export function getOneOnOneContactNudgeMessage(value: unknown) {
  if (typeof value !== "string") return null;
  return ONE_ON_ONE_CONTACT_NUDGE_PRESETS.find((preset) => preset.key === value) ?? null;
}

export function buildOneOnOneContactNudgeEmail(message: string) {
  const preset = ONE_ON_ONE_CONTACT_NUDGE_PRESETS.find((item) => item.message === message);
  const safeMessage = preset?.message ?? "연락처를 교환하고 싶다는 한마디가 도착했어요.";
  return {
    subject: "[짐툴] 1:1 상대가 한마디를 보냈어요",
    text: [
      "1:1 쌍방 매칭 상대가 연락처 교환 한마디를 보냈어요.",
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

export function getOneOnOneContactNudgeEligibility(match: ContactNudgeMatchState, nowMs = Date.now()) {
  const basis = match.source_final_responded_at ?? match.updated_at ?? match.created_at ?? "";
  const basisMs = Date.parse(basis);
  const eligibleAtMs = Number.isFinite(basisMs) ? basisMs + ONE_ON_ONE_CONTACT_NUDGE_DELAY_MS : Number.NaN;
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
