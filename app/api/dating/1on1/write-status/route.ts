import { isAllowedAdminUser } from "@/lib/admin";
import { getDatingOneOnOneWriteStatus, getProfilePhoneVerification } from "@/lib/dating-1on1";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({
      loggedIn: false,
      isAdmin: false,
      phoneVerified: false,
      writeStatus: "paused",
      canWrite: false,
      reason: "AUTH_REQUIRED",
    });
  }

  const isAdmin = isAllowedAdminUser(user.id, user.email);
  const admin = createAdminClient();
  const phoneState = await getProfilePhoneVerification(admin, user.id);
  const phoneVerified = phoneState.phoneVerified;
  const writeStatus = await getDatingOneOnOneWriteStatus(admin);
  const canWrite = isAdmin && phoneVerified && writeStatus === "approved";

  return NextResponse.json({
    loggedIn: true,
    isAdmin,
    phoneVerified,
    phoneE164: phoneState.phoneE164,
    phoneVerifiedAt: phoneState.phoneVerifiedAt,
    writeStatus,
    canWrite,
    reason: canWrite
      ? null
      : !isAdmin
      ? "ADMIN_ONLY"
      : !phoneVerified
      ? "PHONE_NOT_VERIFIED"
      : "WRITE_PAUSED",
  });
}
