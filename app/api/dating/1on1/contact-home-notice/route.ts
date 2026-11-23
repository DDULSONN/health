import { NextResponse } from "next/server";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";
import { getContactHomeNoticeMatchId } from "@/lib/dating-1on1-contact-home-notice";

const headers = { "Cache-Control": "private, no-store" };

export async function GET(req: Request) {
  const { user } = await getRequestAuthContext(req);
  if (!user) return NextResponse.json({ matchId: null }, { status: 401, headers });
  try {
    const matchId = await getContactHomeNoticeMatchId(createAdminClient(), user.id);
    return NextResponse.json({ matchId }, { headers });
  } catch {
    // Never let an optional homepage notice affect the existing matching flow.
    return NextResponse.json({ matchId: null }, { status: 503, headers });
  }
}
