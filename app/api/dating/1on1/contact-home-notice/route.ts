import { NextResponse } from "next/server";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";
import { getContactHomeNoticeMatchId } from "@/lib/dating-1on1-contact-home-notice";

const headers = { "Cache-Control": "private, no-store" };
const entryHeaders = { ...headers, Vary: "Cookie, Authorization" };

export async function GET(req: Request) {
  const { user } = await getRequestAuthContext(req);
  if (!user) return NextResponse.json({ matchId: null }, { status: 401, headers });
  if (new URL(req.url).searchParams.get("entry") === "1") {
    const { readOpenCardOneOnOneEntry, EMPTY_OPEN_CARD_ONE_ON_ONE_ENTRY, canShowOpenCardOneOnOneEntryAccount } =
      await import("@/lib/dating-open-card-one-on-one-entry");
    const empty = { ...EMPTY_OPEN_CARD_ONE_ON_ONE_ENTRY, matchId: null };
    const now = Date.now();
    // The expected viewer cannot authorize a read: it must agree with the
    // independently verified session, or the browser is switching accounts.
    if (req.headers.get("X-Jimtul-Viewer") !== user.id) return NextResponse.json(empty, { status: 409, headers: entryHeaders });
    if (!canShowOpenCardOneOnOneEntryAccount(user, now)) return NextResponse.json(empty, { headers: entryHeaders });
    try {
      const [{ checkRouteRateLimit, extractClientIp }, { randomUUID }] = await Promise.all([
        import("@/lib/request-rate-limit"), import("node:crypto"),
      ]);
      const limit = await checkRouteRateLimit({ requestId: randomUUID(), scope: "open-card-1on1-entry",
        userId: user.id, ip: extractClientIp(req), userLimitPerMin: 8, ipLimitPerMin: 8 });
      if (!limit.allowed) return NextResponse.json(empty, { status: 429, headers: {
        ...entryHeaders, "Retry-After": String(Math.max(1, limit.retryAfterSec)),
      } });
      const admin = createAdminClient();
      return NextResponse.json(await readOpenCardOneOnOneEntry(admin, user.id, now,
        () => getContactHomeNoticeMatchId(admin, user.id)), { headers: entryHeaders });
    } catch {
      // Do not advertise matches if current viewer eligibility is unknown.
      return NextResponse.json(empty, { status: 503, headers: entryHeaders });
    }
  }
  try {
    const matchId = await getContactHomeNoticeMatchId(createAdminClient(), user.id);
    return NextResponse.json({ matchId }, { headers });
  } catch {
    // Never let an optional homepage notice affect the existing matching flow.
    return NextResponse.json({ matchId: null }, { status: 503, headers });
  }
}
