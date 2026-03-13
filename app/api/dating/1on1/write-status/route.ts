import { isAllowedAdminUser } from "@/lib/admin";
import { getDatingOneOnOneWriteStatus, getProfilePhoneVerification } from "@/lib/dating-1on1";
import { createAdminClient } from "@/lib/supabase/server";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const { user } = await getRequestAuthContext(req);

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
  const [countRes, activeRes] = await Promise.all([
    admin.from("dating_1on1_cards").select("id", { count: "exact", head: true }),
    admin
      .from("dating_1on1_cards")
      .select("status")
      .eq("user_id", user.id)
      .in("status", ["submitted", "reviewing", "approved"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const activeRequestStatus = typeof activeRes.data?.status === "string" ? activeRes.data.status : null;
  const canWrite = phoneVerified && writeStatus === "approved" && !activeRequestStatus;
  const totalApplications = countRes.error ? 0 : Math.max(0, Number(countRes.count ?? 0));

  return NextResponse.json({
    loggedIn: true,
    isAdmin,
    phoneVerified,
    writeStatus,
    canWrite,
    activeRequestStatus,
    totalApplications,
    reason: canWrite
      ? null
      : !phoneVerified
      ? "PHONE_NOT_VERIFIED"
      : activeRequestStatus
      ? "ACTIVE_REQUEST_EXISTS"
      : "WRITE_PAUSED",
  });
}
