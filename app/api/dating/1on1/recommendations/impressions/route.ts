import { NextResponse } from "next/server";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";
import { ensureAllowedMutationOrigin } from "@/lib/request-origin";
import { verifyImpressionTicket } from "@/lib/dating-1on1-impressions";

export async function POST(req: Request) {
  const originError = ensureAllowedMutationOrigin(req);
  if (originError) return originError;
  const { user } = await getRequestAuthContext(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body;
  try {
    if (Number(req.headers.get("content-length")) > 10000) throw new Error("oversize");
    const reader = req.body?.getReader();
    if (!reader) throw new Error("empty");
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 10000) { await reader.cancel(); throw new Error("oversize"); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("invalid");
  } catch { return NextResponse.json({ error: "Invalid acknowledgement" }, { status: 400 }); }
  const ticket = verifyImpressionTicket(body.ticket, user.id, body.candidate_ids);
  if (!ticket) return NextResponse.json({ error: "Invalid or expired acknowledgement" }, { status: 400 });
  try {
    const { error } = await createAdminClient().rpc("record_dating_1on1_candidate_impressions", {
      p_user_id: user.id, p_source_card_id: ticket.source, p_candidate_card_ids: body.candidate_ids,
    });
    if (error) throw error;
    return NextResponse.json({ recorded: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    // Optional telemetry must never break viewing, selection, or contact exchange.
    console.warn("[dating impressions] acknowledgement unavailable");
    return NextResponse.json({ recorded: false }, { status: 202, headers: { "Cache-Control": "private, no-store" } });
  }
}
