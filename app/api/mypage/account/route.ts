import { accountDeletionMessage, getAccountDeletionConfigError, getRequestIp, performAccountDeletion } from "@/lib/account-deletion";
import { ensureAllowedMutationOrigin } from "@/lib/request-origin";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export async function DELETE(req: Request) {
  const originError = ensureAllowedMutationOrigin(req);
  if (originError) return originError;

  const { user } = await getRequestAuthContext(req);
  if (!user) {
    return NextResponse.json({ error: "로그인 상태를 확인하지 못했습니다. 다시 로그인한 뒤 탈퇴해 주세요." }, { status: 401 });
  }

  // The header is only a mismatch guard. The deletion target ALWAYS comes
  // from server-verified Auth, never from a client-supplied identifier.
  const expectedUserId = req.headers.get("x-account-user-id");
  if (expectedUserId && expectedUserId !== user.id) {
    return NextResponse.json({ error: "로그인 계정이 변경되었습니다. 새로고침한 뒤 다시 확인해 주세요." }, { status: 409 });
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

  const response = NextResponse.json({
    ok: true,
    mode: result.mode,
    cleanup_pending: result.cleanupPending,
    hidden_open_cards: result.hiddenOpenCards,
    message: accountDeletionMessage(result.cleanupPending),
  });

  // Auth deletion already ends the account. Expire only this project's login
  // cookies as well, even if the browser's follow-up signOut request fails.
  const cookieStore = await cookies();
  const projectRef = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname.split(".")[0];
  const sessionKey = `sb-${projectRef}-auth-token`;
  const names = new Set([sessionKey, ...cookieStore.getAll().map(({ name }) => name)]);
  for (const name of names) {
    const suffix = name.slice(sessionKey.length);
    if (!name.startsWith(sessionKey) || (suffix !== "" && !/^\.\d+$/.test(suffix))) continue;
    const options = { path: "/", maxAge: 0, sameSite: "lax" as const };
    cookieStore.set(name, "", options);
    response.cookies.set(name, "", options);
  }
  return response;
}
