import { createHmac, timingSafeEqual } from "node:crypto";
import type { createAdminClient } from "@/lib/supabase/server";

export const IMPRESSION_TABLE = "dating_1on1_candidate_impressions";
export const IMPRESSION_HISTORY_MS = 30 * 86400000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_CARDS = 32;
type Ticket = { v: 1; user: string; source: string; cards: string[]; issued: number; expires: number };
export type CandidateImpression = { candidate_user_id: string; first_seen_at: string };

function signature(payload: string) {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return secret ? createHmac("sha256", secret).update(`dating-impressions:v1:${payload}`).digest("base64url") : null;
}

// A receipt authorizes acknowledgement only of cards this server actually sent.
// It is not an authentication token or permission to read any profile/contact.
export function createImpressionTicket(user: string, source: string, cards: string[], now = Date.now()) {
  const ids = [...new Set(cards)];
  if (![user, source, ...ids].every(id => UUID.test(id)) || !ids.length || ids.length > MAX_CARDS) return null;
  const payload = Buffer.from(JSON.stringify({ v: 1, user, source, cards: ids, issued: now, expires: now + 86400000 } satisfies Ticket)).toString("base64url");
  const sig = signature(payload);
  return sig ? `${payload}.${sig}` : null;
}

export function verifyImpressionTicket(value: unknown, user: string, cards: unknown, now = Date.now()): Ticket | null {
  if (typeof value !== "string" || value.length > 5000 || !Array.isArray(cards) || !cards.length || cards.length > MAX_CARDS ||
    cards.some(id => typeof id !== "string" || !UUID.test(id)) || new Set(cards).size !== cards.length) return null;
  const [payload, sig, extra] = value.split(".");
  const expected = payload && signature(payload);
  if (!expected || !sig || extra || Buffer.byteLength(sig) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const ticket = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Ticket;
    if (ticket.v !== 1 || ticket.user !== user || !UUID.test(ticket.source) || !Array.isArray(ticket.cards) ||
      !Number.isFinite(ticket.issued) || !Number.isFinite(ticket.expires) || ticket.issued > now || ticket.expires <= now ||
      ticket.expires - ticket.issued !== 86400000 || cards.some(id => !ticket.cards.includes(id))) return null;
    return ticket;
  } catch { return null; }
}

export async function readCandidateImpressions(admin: ReturnType<typeof createAdminClient>, userId: string, now = Date.now()) {
  const rows: CandidateImpression[] = [];
  // Include the seven-day seed replay window so each page uses history as of its
  // generation, not observations recorded afterwards. Bounded and viewer-scoped.
  for (let from = 0; from < 5000; from += 500) {
    const result = await admin.from(IMPRESSION_TABLE).select("candidate_user_id,first_seen_at")
      .eq("viewer_user_id", userId).gte("first_seen_at", new Date(now - IMPRESSION_HISTORY_MS - 7 * 86400000).toISOString())
      .lte("first_seen_at", new Date(now).toISOString())
      .order("first_seen_at", { ascending: true }).order("candidate_user_id", { ascending: true }).range(from, from + 499);
    if (result.error) {
      if (["42P01", "PGRST205"].includes(result.error.code)) return { available: false, rows: [] };
      throw new Error("Candidate impression history unavailable");
    }
    rows.push(...(result.data ?? []) as CandidateImpression[]);
    if ((result.data?.length ?? 0) < 500) return { available: true, rows };
  }
  throw new Error("Candidate impression history exceeds safe read bound");
}
