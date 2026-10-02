import { NextResponse } from "next/server";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";
import { ensureAllowedMutationOrigin } from "@/lib/request-origin";
import { readReturnProfileReward } from "@/lib/return-profile-reward-server";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" };
async function handle(request: Request, claim: boolean) {
  if (claim) {
    const denied = ensureAllowedMutationOrigin(request);
    if (denied) return denied;
    // Never accept a member ID, reward amount, or eligibility timestamp from the browser.
    if (request.body !== null) return NextResponse.json({ error: "invalid_body" }, { status: 400, headers });
  }
  try {
    const { user } = await getRequestAuthContext(request);
    if (!user || user.deleted_at) return NextResponse.json({ reward: null }, { status: 401, headers });
    const reward = await readReturnProfileReward(createAdminClient(), user.id, claim);
    return NextResponse.json({ userId: user.id, reward }, { headers });
  } catch {
    return NextResponse.json({ error: "혜택을 확인하지 못했어요. 잠시 후 다시 확인해 주세요." }, { status: 503, headers });
  }
}
export const GET = (request: Request) => handle(request, false);
export const POST = (request: Request) => handle(request, true);
