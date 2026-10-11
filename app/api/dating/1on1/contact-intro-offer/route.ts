import { NextResponse } from "next/server";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";
import { isContactIntroId } from "@/lib/contact-intro-offer";
import { readContactIntroOffer } from "@/lib/contact-intro-offer-server";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" };
export async function GET(request: Request) {
  const matchId = new URL(request.url).searchParams.get("matchId");
  if (!isContactIntroId(matchId)) return NextResponse.json({ offer: null }, { status: 400, headers });
  try {
    const { user } = await getRequestAuthContext(request);
    if (!user || user.deleted_at) return NextResponse.json({ offer: null }, { status: 401, headers });
    const offer = await readContactIntroOffer(createAdminClient(), user.id, matchId);
    return NextResponse.json({ offer }, { headers });
  } catch {
    return NextResponse.json({ offer: null }, { status: 503, headers });
  }
}
