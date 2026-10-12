import { getProfilePhoneVerification } from "@/lib/dating-1on1";
import { hasDatingBlockBetween } from "@/lib/dating-blocks";
import { hasDatingContactPhoneBlockBetween } from "@/lib/dating-contact-blocks";
import { fetchMarketingUnsubscribedUserIds } from "@/lib/marketing-email";
import { isSolapiPhoneOtpConfigured, sendSolapiTextMessage } from "@/lib/solapi-phone-verification";
import type { createAdminClient } from "@/lib/supabase/server";
import { isCurrentOneOnOneNotification } from "@/lib/dating-1on1-notification-guard";
import { normalizeOneOnOneMatchId } from "@/lib/dating-1on1-match-navigation";

type AdminClient = ReturnType<typeof createAdminClient>;

const DELIVERY_TABLE = "dating_1on1_sms_deliveries";
export const ONE_ON_ONE_SELECTION_SMS_TEXT =
  "[짐툴] 1:1 요청이 도착했어요. 상대 프로필을 확인해 주세요.\nhelchang.com/mypage?section=matching";
export function buildOneOnOneSelectionSms(matchId: string) {
  const id = normalizeOneOnOneMatchId(matchId);
  return id ? `[짐툴] 1:1 요청이 도착했어요.\nhelchang.com/m/${id}` : ONE_ON_ONE_SELECTION_SMS_TEXT;
}

function isMissingSmsDeliverySchema(error: unknown) {
  const code = String((error as { code?: unknown } | null)?.code ?? "");
  const message = String((error as { message?: unknown } | null)?.message ?? error ?? "").toLowerCase();
  return code === "42P01" || code === "PGRST205" || message.includes(DELIVERY_TABLE) || message.includes("schema cache");
}

export async function sendOneOnOneSelectionSms(
  admin: AdminClient,
  input: {
    matchId: string;
    sourceUserId: string;
    recipientUserId: string;
  },
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
        event_kind: "selection_received",
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
      if (!await isCurrentOneOnOneNotification(admin, input.matchId, "dating_1on1_selection_received", input.recipientUserId, input.sourceUserId)) {
        await admin.from(DELIVERY_TABLE).update({ status: "failed", provider_error: "MATCH_NO_LONGER_PENDING" })
          .eq("id", reserveRes.data.id).eq("status", "sending");
        return false;
      }
      await sendSolapiTextMessage({ phoneE164: phone.phoneE164, text: buildOneOnOneSelectionSms(input.matchId) });
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
