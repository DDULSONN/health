import { ensureCronAuthorized } from "@/lib/cron-auth";
import { oneOnOneReviewCandidate, ruleReview, withReviewSnapshot, REVIEW_RULES_VERSION } from "@/lib/dating-profile-review";
import { readReviewSnapshot, reviewContentFingerprint } from "@/lib/dating-review-confirmation";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export const maxDuration = 60;
const MAX_SCAN_PER_RUN = 1000;
const BATCH_SIZE = 200;
const ACTIVE_STATUSES = ["submitted", "reviewing", "approved"];

export async function GET(req: Request) {
  const unauthorized = ensureCronAuthorized(req);
  if (unauthorized) return unauthorized;
  const admin = createAdminClient();
  try {
    const { data, error } = await admin.from("dating_1on1_cards")
      .select("id,user_id,status,name,birth_year,job,region,intro_text,strengths_text,preferred_partner_text,photo_paths,admin_tags,created_at")
      .in("status", ACTIVE_STATUSES).order("created_at", { ascending: false }).limit(MAX_SCAN_PER_RUN);
    if (error) throw error;
    const cards = (data ?? []) as Record<string, unknown>[];
    const nicknames = new Map<string, string>();
    const existing = new Map<string, Record<string, unknown>>();
    const userIds = [...new Set(cards.map(card => String(card.user_id ?? "")).filter(Boolean))];
    for (let start = 0; start < userIds.length; start += BATCH_SIZE) {
      const result = await admin.from("profiles").select("user_id,nickname").in("user_id", userIds.slice(start, start + BATCH_SIZE));
      if (result.error) throw result.error;
      for (const profile of result.data ?? []) nicknames.set(profile.user_id, profile.nickname ?? "");
    }
    for (let start = 0; start < cards.length; start += BATCH_SIZE) {
      const result = await admin.from("admin_dating_card_ai_reviews").select("id,card_id,raw_result,scanned_at")
        .eq("source_type", "one_on_one").in("card_id", cards.slice(start, start + BATCH_SIZE).map(card => String(card.id)));
      if (result.error) throw result.error;
      for (const row of result.data ?? []) existing.set(row.card_id, row);
    }
    const scannedAt = new Date().toISOString();
    const changes = cards.flatMap(rawCard => {
      const card = oneOnOneReviewCandidate(rawCard, nicknames.get(String(rawCard.user_id ?? "")));
      const saved = existing.get(card.cardId);
      const raw = (saved?.raw_result ?? {}) as Record<string, unknown>;
      const snapshot = readReviewSnapshot(raw);
      // Identical content and rules need no write. In particular, never replace
      // unchanged manual AI findings or invalidate an administrator's confirmation.
      if (snapshot?.contentFingerprint === reviewContentFingerprint(card) && raw.confirmationRulesVersion === REVIEW_RULES_VERSION) return [];
      const review = withReviewSnapshot(card, ruleReview(card));
      return [{ saved, row: {
        source_type: "one_on_one", card_id: card.cardId, user_id: card.userId,
        card_status: card.status, display_name: card.displayName,
        suspicion_level: review.suspicionLevel, flags: review.flags, summary: review.summary,
        photo_flags: review.photoFlags, text_flags: review.textFlags, raw_result: review.raw,
        scanned_at: scannedAt, admin_user_id: null,
      } }];
    });
    const newRows = changes.filter(change => !change.saved).map(change => change.row);
    for (let start = 0; start < newRows.length; start += BATCH_SIZE) {
      // A manual result created while this run was reading must win the race.
      const result = await admin.from("admin_dating_card_ai_reviews").upsert(newRows.slice(start, start + BATCH_SIZE),
        { onConflict: "source_type,card_id", ignoreDuplicates: true });
      if (result.error) throw result.error;
    }
    const changedRows = changes.filter(change => change.saved);
    let updated = 0, deferred = 0;
    const writeDeadline = Date.now() + 35_000;
    for (let start = 0; start < changedRows.length; start += 10) {
      if (Date.now() >= writeDeadline) { deferred = changedRows.length - start; break; }
      await Promise.all(changedRows.slice(start, start + 10).map(async ({ saved, row }) => {
        // Compare-and-set: a newer manual scan/confirmation upgrade is never overwritten.
        let query = admin.from("admin_dating_card_ai_reviews").update(row).eq("id", String(saved!.id));
        query = saved!.scanned_at == null ? query.is("scanned_at", null) : query.eq("scanned_at", String(saved!.scanned_at));
        const result = await query.select("id");
        if (result.error) throw result.error;
        updated += result.data?.length ?? 0;
      }));
    }
    return NextResponse.json({ ok: true, scanned: cards.length, reviewRows: newRows.length + updated,
      unchanged: cards.length - changes.length, deferred,
      suspicious: changes.filter(change => ["medium", "high"].includes(change.row.suspicion_level)).length, scannedAt });
  } catch (error) {
    console.error("[cron dating-1on1-card-review] review failed", error);
    return NextResponse.json({ ok: false, error: "review_failed" }, { status: 500 });
  }
}
