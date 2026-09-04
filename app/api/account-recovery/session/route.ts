import { NextRequest, NextResponse } from "next/server";
import {
  ACCOUNT_RECOVERY_COOKIE,
  readAccountRecoveryTicket,
} from "@/lib/account-recovery-ticket";
import { hashPhoneForVerificationStorage } from "@/lib/solapi-phone-verification";
import { createAdminClient, createClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ ok: false, code: "RECOVERY_NOT_AUTHENTICATED" }, { status: 401 });
  }

  const profile = await createAdminClient()
    .from("profiles")
    .select("phone_verified,phone_e164")
    .eq("user_id", user.id)
    .maybeSingle();

  if (profile.error) {
    console.error("[account-recovery/session] profile lookup failed", profile.error.message);
    return NextResponse.json({ ok: false, code: "RECOVERY_CHECK_FAILED" }, { status: 500 });
  }

  const phoneVerified = profile.data?.phone_verified === true;
  const phoneE164 = String(profile.data?.phone_e164 ?? "").trim();
  if (!phoneVerified || !phoneE164) {
    return NextResponse.json({ ok: false, code: "RECOVERY_ACCOUNT_MISMATCH" }, { status: 409 });
  }

  const rawTicket = req.cookies.get(ACCOUNT_RECOVERY_COOKIE)?.value;
  const ticket = readAccountRecoveryTicket(rawTicket);
  if (rawTicket && !ticket) {
    return NextResponse.json({ ok: false, code: "RECOVERY_SESSION_EXPIRED" }, { status: 409 });
  }
  if (ticket && ticket.phoneHash !== hashPhoneForVerificationStorage(phoneE164)) {
    return NextResponse.json({ ok: false, code: "RECOVERY_ACCOUNT_MISMATCH" }, { status: 409 });
  }

  const response = NextResponse.json({ ok: true, targetMatched: ticket ? true : null });
  if (ticket) response.cookies.delete(ACCOUNT_RECOVERY_COOKIE);
  return response;
}
