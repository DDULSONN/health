import { getProfilePhoneVerification } from "@/lib/dating-1on1";
import { hasDatingBlockBetween } from "@/lib/dating-blocks";
import { hasDatingContactPhoneBlockBetween } from "@/lib/dating-contact-blocks";
import { fetchMarketingUnsubscribedUserIds } from "@/lib/marketing-email";
import { isSolapiPhoneOtpConfigured, sendSolapiTextMessage } from "@/lib/solapi-phone-verification";
import type { createAdminClient } from "@/lib/supabase/server";
import { isCurrentOneOnOneNotification } from "@/lib/dating-1on1-notification-guard";
import { normalizeOneOnOneMatchId } from "@/lib/dating-1on1-match-navigation";
import { canDeliverOneOnOneNotification } from "@/lib/dating-1on1-delivery-guard";

type AdminClient = ReturnType<typeof createAdminClient>;

const DELIVERY_TABLE = "dating_1on1_sms_deliveries";
export const ONE_ON_ONE_SELECTION_SMS_TEXT =
  "[짐툴] 1:1 요청이 도착했어요. 상대 프로필을 확인해 주세요.\nhelchang.com/mypage?section=matching";
export function buildOneOnOneSelectionSms(matchId: string) {
  const id = normalizeOneOnOneMatchId(matchId);
  return id ? `[짐툴] 1:1 요청이 도착했어요.\nhelchang.com/m/${id}` : ONE_ON_ONE_SELECTION_SMS_TEXT;
}

export function buildOneOnOneAcceptedSms(matchId: string) {
  const id = normalizeOneOnOneMatchId(matchId);
  return `[짐툴] 1:1 요청을 상대가 수락했어요.\n${id ? `helchang.com/m/${id}` : "helchang.com/community/dating/cards?tab=one_on_one"}`;
}

function isMissingSmsDeliverySchema(error: unknown) {
  const code = String((error as { code?: unknown } | null)?.code ?? "");
  const message = String((error as { message?: unknown } | null)?.message ?? error ?? "").toLowerCase();
  return code === "42P01" || code === "PGRST205" || message.includes(DELIVERY_TABLE) || message.includes("schema cache");
}

async function sendOneOnOneSms(
  admin: AdminClient,
  input: {
    matchId: string;
    sourceUserId: string;
    recipientUserId: string;
  },
  eventKind: "selection_received" | "match_accepted",
) {
  if (!isSolapiPhoneOtpConfigured()) return false;

  try {
    const [memberBlocked, contactBlocked, unsubscribed, phone] = await Promise.all([
      hasDatingBlockBetween(admin, input.sourceUserId, input.recipientUserId),
      hasDatingContactPhoneBlockBetween(admin, input.sourceUserId, input.recipientUserId),
      fetchMarketingUnsubscribedUserIds(admin, [input.recipientUserId], "dating_notifications"),
      getProfilePhoneVerification(admin, input.recipientUserId),
    ]);
    if (
      memberBlocked ||
      contactBlocked ||
      unsubscribed.has(input.recipientUserId) ||
      !phone.phoneVerified ||
      !phone.phoneE164
    ) {
      return false;
    }

    const reserveRes = await admin
      .from(DELIVERY_TABLE)
      .insert({
        match_id: input.matchId,
        recipient_user_id: input.recipientUserId,
        event_kind: eventKind,
        status: "sending",
      })
      .select("id")
      .maybeSingle();
    if (reserveRes.error) {
      if (reserveRes.error.code === "23505" || isMissingSmsDeliverySchema(reserveRes.error)) return false;
      throw reserveRes.error;
    }
    if (!reserveRes.data?.id) return false;

    try {
      // Soft-deleted Auth accounts can retain profile/card rows. Check Auth
      // immediately before sending, and fail closed if it cannot be checked.
      const recipient = await admin.auth.admin.getUserById(input.recipientUserId);
      const user = recipient.data?.user;
      if (recipient.error || !user || (user as typeof user & { deleted_at?: string | null }).deleted_at) {
        await admin.from(DELIVERY_TABLE)
          .update({ status: "failed", provider_error: "RECIPIENT_UNAVAILABLE" })
          .eq("id", reserveRes.data.id).eq("status", "sending");
        return false;
      }
      const type = eventKind === "selection_received" ? "dating_1on1_selection_received" : "dating_1on1_match_accepted";
      if (!await canDeliverOneOnOneNotification(admin, input.matchId, type, input.recipientUserId) ||
        !await isCurrentOneOnOneNotification(admin, input.matchId, type, input.recipientUserId,
          eventKind === "selection_received" ? input.sourceUserId : undefined)) {
        await admin.from(DELIVERY_TABLE).update({ status: "failed", provider_error: "MATCH_NO_LONGER_PENDING" })
          .eq("id", reserveRes.data.id).eq("status", "sending");
        return false;
      }
      const currentPhone = await getProfilePhoneVerification(admin, input.recipientUserId);
      if (!currentPhone.phoneVerified || currentPhone.phoneE164 !== phone.phoneE164) {
        await admin.from(DELIVERY_TABLE).update({ status: "failed", provider_error: "RECIPIENT_PHONE_CHANGED" })
          .eq("id", reserveRes.data.id).eq("status", "sending");
        return false;
      }
      await sendSolapiTextMessage({ phoneE164: phone.phoneE164, text: eventKind === "selection_received"
        ? buildOneOnOneSelectionSms(input.matchId) : buildOneOnOneAcceptedSms(input.matchId) });
      const sentRes = await admin
        .from(DELIVERY_TABLE)
        .update({ status: "sent", sent_at: new Date().toISOString(), provider_error: null })
        .eq("id", reserveRes.data.id)
        .eq("status", "sending");
      if (sentRes.error) {
        console.error("[dating-1on1-sms] sent status update failed", sentRes.error);
      }
      return true;
    } catch (error) {
      const providerError = error instanceof Error ? error.message.slice(0, 500) : "UNKNOWN_ERROR";
      const failedRes = await admin
        .from(DELIVERY_TABLE)
        .update({ status: "failed", provider_error: providerError })
        .eq("id", reserveRes.data.id)
        .eq("status", "sending");
      if (failedRes.error) {
        console.error("[dating-1on1-sms] failed status update failed", failedRes.error);
      }
      console.error("[dating-1on1-sms] provider send failed", { matchId: input.matchId, error });
      return false;
    }
  } catch (error) {
    // SMS is supplementary. Matching must still succeed if preferences,
    // block checks, schema, or the provider are temporarily unavailable.
    console.error("[dating-1on1-sms] send skipped", { matchId: input.matchId, error });
    return false;
  }
}

type SmsInput = { matchId: string; sourceUserId: string; recipientUserId: string };
export function sendOneOnOneSelectionSms(admin: AdminClient, input: SmsInput) {
  return sendOneOnOneSms(admin, input, "selection_received");
}
export function sendOneOnOneAcceptedSms(admin: AdminClient, input: SmsInput) {
  return sendOneOnOneSms(admin, input, "match_accepted");
}
