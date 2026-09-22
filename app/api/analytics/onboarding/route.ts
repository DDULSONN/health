import { NextResponse } from "next/server";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";
import { parseOnboardingEvent } from "@/lib/onboarding-funnel";
import { checkRateLimit } from "@/lib/request-rate-limit";

const empty = () => new NextResponse(null, { status: 204, headers: { "Cache-Control": "private, no-store" } });
export async function POST(request: Request) {
  // Stricter than legacy analytics: only browser same-origin requests are accepted.
  if (request.headers.get("origin") !== new URL(request.url).origin ||
      !request.headers.get("content-type")?.startsWith("application/json")) return empty();
  try {
    if (Number(request.headers.get("content-length") || 0) > 256) return empty();
    const reader = request.body?.getReader();
    if (!reader) return empty();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 256) { await reader.cancel(); return empty(); }
      chunks.push(value);
    }
    const payload = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) { payload.set(chunk, offset); offset += chunk.byteLength; }
    const text = new TextDecoder().decode(payload);
    const event = parseOnboardingEvent(JSON.parse(text));
    if (!event) return empty();
    const { user } = await getRequestAuthContext(request);
    if (!user) return empty();
    if (!checkRateLimit("onboarding-diagnostics:" + user.id, 30, 60_000).allowed) return empty();
    // First occurrence only; at most the fixed event count per existing member.
    // Missing optional SQL, deleted accounts or diagnostics outages never affect the caller.
    await createAdminClient().from("onboarding_funnel_events").upsert(
      { user_id: user.id, event_name: event },
      { onConflict: "user_id,event_name", ignoreDuplicates: true },
    ).abortSignal(AbortSignal.timeout(3000));
  } catch { /* Do not log request bodies or authentication details. */ }
  return empty();
}
