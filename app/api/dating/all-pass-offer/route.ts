import { NextResponse } from "next/server";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";
import { ensureAllowedMutationOrigin } from "@/lib/request-origin";
import { readAllPassProfileOffer } from "@/lib/all-pass-profile-offer-server";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" };
async function handle(request: Request, start: boolean) {
  if (start) {
    const denied = ensureAllowedMutationOrigin(request);
    if (denied) return denied;
    if (request.body !== null) return NextResponse.json({ error: "invalid_body" }, { status: 400, headers });
  }
  try {
    const { user } = await getRequestAuthContext(request);
    if (!user || user.deleted_at) return NextResponse.json({ offer: null }, { status: 401, headers });
    const offer = await readAllPassProfileOffer(createAdminClient(), user.id, start);
    return NextResponse.json({ userId: user.id, offer }, { headers });
  } catch {
    return NextResponse.json({ error: "할인 안내를 확인하지 못했어요. 잠시 후 다시 확인해 주세요." }, { status: 503, headers });
  }
}
export const GET = (request: Request) => handle(request, false);
export const POST = (request: Request) => handle(request, true);
