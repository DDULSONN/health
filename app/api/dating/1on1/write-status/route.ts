import { isAllowedAdminUser } from "@/lib/admin";
import { getDatingOneOnOneWriteStatus, isPhoneVerified } from "@/lib/dating-1on1";
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
  const phoneVerified = isPhoneVerified(user);

  const admin = createAdminClient();
  const writeStatus = await getDatingOneOnOneWriteStatus(admin);
  const canWrite = isAdmin && phoneVerified && writeStatus === "approved";

  return NextResponse.json({
    loggedIn: true,
    isAdmin,
    phoneVerified,
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

