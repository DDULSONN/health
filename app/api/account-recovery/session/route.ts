import { NextRequest, NextResponse } from "next/server";
import {
  ACCOUNT_RECOVERY_COOKIE,
  readAccountRecoveryTicket,
} from "@/lib/account-recovery-ticket";
import { hashPhoneForVerificationStorage } from "@/lib/solapi-phone-verification";
import { createAdminClient, createClient } from "@/lib/supabase/server";

const reply = (body: { ok: boolean; code?: string; targetMatched?: boolean | null }, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError && authError.name !== "AuthSessionMissingError" && authError.code !== "session_not_found"
      && authError.code !== "user_not_found" && authError.status !== 401) {
      return reply({ ok: false, code: "RECOVERY_CHECK_FAILED" }, 503);
    }
    if (authError || !user || user.deleted_at) {
      return reply({ ok: false, code: "RECOVERY_NOT_AUTHENTICATED" }, 401);
    }

    const profile = await createAdminClient()
      .from("profiles")
      .select("phone_verified,phone_e164")
      .eq("user_id", user.id)
      .maybeSingle();

    if (profile.error) {
      console.error("[account-recovery/session] profile lookup failed", profile.error.message);
      return reply({ ok: false, code: "RECOVERY_CHECK_FAILED" }, 503);
    }

    const phoneVerified = profile.data?.phone_verified === true;
    const phoneE164 = String(profile.data?.phone_e164 ?? "").trim();
    if (!phoneVerified || !phoneE164) {
      return reply({ ok: false, code: "RECOVERY_ACCOUNT_MISMATCH" }, 409);
    }

    const rawTicket = req.cookies.get(ACCOUNT_RECOVERY_COOKIE)?.value;
    const ticket = readAccountRecoveryTicket(rawTicket);
    if (rawTicket && !ticket) {
      return reply({ ok: false, code: "RECOVERY_SESSION_EXPIRED" }, 409);
    }
    if (ticket && ticket.phoneHash !== hashPhoneForVerificationStorage(phoneE164)) {
      return reply({ ok: false, code: "RECOVERY_ACCOUNT_MISMATCH" }, 409);
    }

    const response = reply({ ok: true, targetMatched: ticket ? true : null });
    if (ticket) response.cookies.delete(ACCOUNT_RECOVERY_COOKIE);
    return response;
  } catch {
    // Infrastructure failures are not proof that the authenticated account is incorrect.
    return reply({ ok: false, code: "RECOVERY_CHECK_FAILED" }, 503);
  }
}
