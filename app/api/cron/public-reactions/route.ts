import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { isReactionCronAuthorized, reactionFailureCode, runPublicReactionScan } from "@/lib/public-reactions-server";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function GET(request: Request) {
  if (!isReactionCronAuthorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const result = await runPublicReactionScan(createAdminClient());
    return NextResponse.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = reactionFailureCode(error);
    // Log only a controlled code, never provider output, URLs or credentials.
    console.error("[cron/public-reactions]", code);
    return NextResponse.json({ ok: false, code }, { status: 503 });
  }
}
