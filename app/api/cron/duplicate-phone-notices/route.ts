import { NextResponse } from "next/server";
import { ensureCronAuthorized } from "@/lib/cron-auth";
import {
  DUPLICATE_PHONE_NOTICE_COOLDOWN_MS,
  DUPLICATE_PHONE_NOTICE_DELAY_MS,
  DUPLICATE_PHONE_NOTICE_PROVIDER,
  DUPLICATE_PHONE_NOTICE_TEXT,
  DUPLICATE_PHONE_PROVIDER_ERROR,
  isDuplicatePhoneNoticeDue,
  readDuplicatePhoneOwnerUserId,
  withDuplicatePhoneNoticeStatus,
} from "@/lib/duplicate-phone-notice";
import { normalizePhoneToE164 } from "@/lib/phone-verification";
import {
  hashPhoneForVerificationStorage,
  isSolapiPhoneOtpConfigured,
  sendSolapiTextMessage,
} from "@/lib/solapi-phone-verification";
import { createAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ATTEMPT_LOG_TABLE = "profile_phone_verification_attempts";
const BATCH_SIZE = 50;

type DuplicateAttemptRow = {
  id: string;
  user_id: string | null;
  phone_hash: string | null;
  request_id: string | null;
  meta: Record<string, unknown> | null;
};

async function updateNoticeStatus(
  admin: ReturnType<typeof createAdminClient>,
  row: DuplicateAttemptRow,
  status: "processing" | "sent" | "suppressed" | "failed",
  details: Record<string, unknown> = {},
) {
  const result = await admin
    .from(ATTEMPT_LOG_TABLE)
    .update({ meta: withDuplicatePhoneNoticeStatus(row.meta, status, details) })
    .eq("id", row.id);
  if (result.error) throw new Error(result.error.message);
}

async function claimPendingNotice(admin: ReturnType<typeof createAdminClient>, row: DuplicateAttemptRow) {
  const result = await admin
    .from(ATTEMPT_LOG_TABLE)
    .update({ meta: withDuplicatePhoneNoticeStatus(row.meta, "processing") })
    .eq("id", row.id)
    .contains("meta", { duplicate_notice_status: "pending" })
    .select("id")
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  return Boolean(result.data?.id);
}

export async function GET(request: Request) {
  const unauthorized = ensureCronAuthorized(request);
  if (unauthorized) return unauthorized;

  if (!isSolapiPhoneOtpConfigured()) {
    return NextResponse.json({ ok: true, examined: 0, sent: 0, suppressed: 0, failed: 0, reason: "sms_not_configured" });
  }

  const admin = createAdminClient();
  const nowMs = Date.now();
  const dueBefore = new Date(nowMs - DUPLICATE_PHONE_NOTICE_DELAY_MS).toISOString();
  const cooldownAfter = new Date(nowMs - DUPLICATE_PHONE_NOTICE_COOLDOWN_MS).toISOString();
  const pending = await admin
    .from(ATTEMPT_LOG_TABLE)
    .select("id,user_id,phone_hash,request_id,meta")
    .eq("action", "send")
    .eq("status", "fail")
    .eq("provider_error", DUPLICATE_PHONE_PROVIDER_ERROR)
    .contains("meta", { duplicate_notice_status: "pending" })
    .lte("created_at", dueBefore)
    .order("created_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (pending.error) {
    console.error("[duplicate-phone-notices] pending lookup failed", pending.error);
    return NextResponse.json({ ok: false, error: "pending_lookup_failed" }, { status: 500 });
  }

  const rows = (pending.data ?? []) as DuplicateAttemptRow[];
  const attemptedPhoneHashes = new Set<string>();
  const results = { examined: rows.length, sent: 0, suppressed: 0, failed: 0 };

  for (const row of rows) {
    const ownerUserId = readDuplicatePhoneOwnerUserId(row.meta);
    try {
      if (!isDuplicatePhoneNoticeDue(row.meta, nowMs)) continue;
      if (!(await claimPendingNotice(admin, row))) continue;

      if (!ownerUserId || !row.phone_hash) {
        await updateNoticeStatus(admin, row, "failed", { duplicate_notice_error: "INVALID_QUEUE_ROW" });
        results.failed += 1;
        continue;
      }

      if (attemptedPhoneHashes.has(row.phone_hash)) {
        await updateNoticeStatus(admin, row, "suppressed", { duplicate_notice_reason: "SAME_BATCH" });
        results.suppressed += 1;
        continue;
      }

      const priorDelivery = await admin
        .from(ATTEMPT_LOG_TABLE)
        .select("id")
        .eq("phone_hash", row.phone_hash)
        .eq("provider", DUPLICATE_PHONE_NOTICE_PROVIDER)
        .eq("status", "success")
        .gte("created_at", cooldownAfter)
        .limit(1)
        .maybeSingle();
      if (priorDelivery.error && priorDelivery.error.code !== "PGRST116") {
        throw new Error(priorDelivery.error.message);
      }
      if (priorDelivery.data?.id) {
        await updateNoticeStatus(admin, row, "suppressed", { duplicate_notice_reason: "COOLDOWN_24H" });
        results.suppressed += 1;
        continue;
      }

      // The provider may accept the SMS even if inserting the separate delivery
      // audit later fails. The source row is a second cooldown record so a user
      // never receives another notice because of an audit-only failure.
      const priorSentSource = await admin
        .from(ATTEMPT_LOG_TABLE)
        .select("id")
        .eq("phone_hash", row.phone_hash)
        .eq("provider_error", DUPLICATE_PHONE_PROVIDER_ERROR)
        .contains("meta", { duplicate_notice_status: "sent" })
        .gte("created_at", cooldownAfter)
        .limit(1)
        .maybeSingle();
      if (priorSentSource.error && priorSentSource.error.code !== "PGRST116") {
        throw new Error(priorSentSource.error.message);
      }
      if (priorSentSource.data?.id) {
        await updateNoticeStatus(admin, row, "suppressed", { duplicate_notice_reason: "SOURCE_COOLDOWN_24H" });
        results.suppressed += 1;
        continue;
      }

      const owner = await admin
        .from("profiles")
        .select("phone_e164,phone_verified")
        .eq("user_id", ownerUserId)
        .maybeSingle();
      if (owner.error && owner.error.code !== "PGRST116") throw new Error(owner.error.message);

      const phoneE164 = normalizePhoneToE164(owner.data?.phone_e164 ?? "");
      if (!owner.data?.phone_verified || !phoneE164 || hashPhoneForVerificationStorage(phoneE164) !== row.phone_hash) {
        await updateNoticeStatus(admin, row, "failed", { duplicate_notice_error: "VERIFIED_PHONE_CHANGED" });
        results.failed += 1;
        continue;
      }

      attemptedPhoneHashes.add(row.phone_hash);
      await sendSolapiTextMessage({ phoneE164, text: DUPLICATE_PHONE_NOTICE_TEXT });

      const deliveryLog = await admin.from(ATTEMPT_LOG_TABLE).insert({
        user_id: row.user_id,
        phone_e164: null,
        phone_hash: row.phone_hash,
        action: "send",
        status: "success",
        provider: DUPLICATE_PHONE_NOTICE_PROVIDER,
        provider_error: null,
        request_id: row.request_id,
        ip_hash: null,
        retry_after_sec: null,
        meta: {
          duplicate_phone_owner_user_id: ownerUserId,
          duplicate_notice_source_attempt_id: row.id,
        },
      });
      if (deliveryLog.error) {
        console.error("[duplicate-phone-notices] delivery log failed", { rowId: row.id, error: deliveryLog.error.message });
      }

      await updateNoticeStatus(admin, row, "sent");
      results.sent += 1;
    } catch (error) {
      console.error("[duplicate-phone-notices] delivery failed", { rowId: row.id, error });
      try {
        await updateNoticeStatus(admin, row, "failed", {
          duplicate_notice_error: error instanceof Error ? error.message.slice(0, 300) : "UNKNOWN_ERROR",
        });
        if (ownerUserId && row.phone_hash) {
          await admin.from(ATTEMPT_LOG_TABLE).insert({
            user_id: row.user_id,
            phone_e164: null,
            phone_hash: row.phone_hash,
            action: "send",
            status: "fail",
            provider: DUPLICATE_PHONE_NOTICE_PROVIDER,
            provider_error: error instanceof Error ? error.message.slice(0, 300) : "UNKNOWN_ERROR",
            request_id: row.request_id,
            ip_hash: null,
            retry_after_sec: null,
            meta: {
              duplicate_phone_owner_user_id: ownerUserId,
              duplicate_notice_source_attempt_id: row.id,
            },
          });
        }
      } catch (statusError) {
        console.error("[duplicate-phone-notices] failed to record delivery failure", { rowId: row.id, error: statusError });
      }
      results.failed += 1;
    }
  }

  return NextResponse.json({ ok: true, ...results });
}
