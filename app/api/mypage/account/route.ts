import { getAccountDeletionConfigError, getRequestIp, performAccountDeletion } from "@/lib/account-deletion";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function DELETE(req: Request) {
  const { user } = await getRequestAuthContext(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const configError = getAccountDeletionConfigError();
  if (configError) {
    console.error("[DELETE /api/mypage/account] missing config", configError.debugMessage);
    return NextResponse.json({ error: configError.userMessage }, { status: 500 });
  }

  const admin = createAdminClient();
  const result = await performAccountDeletion({
    admin,
    userId: user.id,
    email: user.email,
    ipAddress: getRequestIp(req),
    userAgent: req.headers.get("user-agent"),
    initiatedByUserId: user.id,
    initiatedByRole: "self",
  });

  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.error,
        debug: result.debug,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    mode: result.mode,
    message: "회원 탈퇴가 처리되었습니다.",
  });
}
