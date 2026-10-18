import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { CONTACT_CARE_MESSAGES } from "@/lib/contact-care";

export const CARE_CLAIM_FIELDS = "id,user_id,match_id,order_id,exchanged_at,counterparty_name,first_contact_at,explanation,reason,status,evidence_count,supplement_due_at,created_at,review_note,used_at,used_match_id";

// Preserve PostgreSQL microseconds in cursors; never interpolate unvalidated text.
export function parseCareCursor(raw: string) {
  const match = raw.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2}))\|([0-9a-f-]{36})$/i);
  if (!match || !Number.isFinite(Date.parse(match[1])) || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(match[2])) return null;
  return { at: match[1], id: match[2] };
}

export async function readCareJson(req: Request, maxBytes: number) {
  if (!req.body) throw Error("CARE_INPUT");
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw Error("CARE_INPUT"); }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally { reader.releaseLock(); }
}
export function careJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}
export function careError(error: unknown) {
  const e = error as { code?: string; message?: string };
  const code = Object.keys(CONTACT_CARE_MESSAGES).find(key => e?.message?.includes(key));
  if (code) return careJson({ error: CONTACT_CARE_MESSAGES[code], code }, 409);
  if (["42P01", "PGRST202", "PGRST205"].includes(e?.code ?? "")) {
    return careJson({ error: "교환권 기능을 준비 중이에요. 기존 결제·번호 교환은 그대로 이용할 수 있어요.", code: "CARE_NOT_INSTALLED" }, 503);
  }
  // Do not log application text, phone numbers or receipt data.
  console.error("[contact-care] request failed", e?.code ?? "unknown");
  return careJson({ error: "처리 결과를 확인하지 못했어요. 다시 조회해 주세요. 결제를 추가로 진행하지 마세요." }, 500);
}
export async function careMatchNames(admin: SupabaseClient, rows: { id: string; source_user_id: string; source_card_id: string; candidate_card_id: string }[], userId: string) {
  const ids = [...new Set(rows.map(m => m.source_user_id === userId ? m.candidate_card_id : m.source_card_id))];
  if (!ids.length) return new Map<string, string>();
  const cards = await admin.from("dating_1on1_cards").select("id,name").in("id", ids);
  if (cards.error) throw cards.error;
  const names = new Map<string, string>((cards.data ?? []).map(c => [c.id, c.name]));
  return new Map(rows.map(m => [m.id, names.get(m.source_user_id === userId ? m.candidate_card_id : m.source_card_id) || "상대 프로필"]));
}
