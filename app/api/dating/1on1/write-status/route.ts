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
      totalApplications: 0,
    });
  }

  const isAdmin = isAllowedAdminUser(user.id, user.email);
  const admin = createAdminClient();
  const phoneState = await getProfilePhoneVerification(admin, user.id);
  const phoneVerified = phoneState.phoneVerified;
  const writeStatus = await getDatingOneOnOneWriteStatus(admin);
  const canWrite = phoneVerified && writeStatus === "approved";
  const countRes = await admin
    .from("dating_1on1_cards")
    .select("id", { count: "exact", head: true });
  const totalApplications = countRes.error ? 0 : Math.max(0, Number(countRes.count ?? 0));

  return NextResponse.json({
    loggedIn: true,
    isAdmin,
    phoneVerified,
    phoneE164: phoneState.phoneE164,
    phoneVerifiedAt: phoneState.phoneVerifiedAt,
    writeStatus,
    canWrite,
    totalApplications,
    reason: canWrite
      ? null
      : !phoneVerified
      ? "PHONE_NOT_VERIFIED"
      : "WRITE_PAUSED",
  });
}
