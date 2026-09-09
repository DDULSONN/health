import type { createAdminClient } from "@/lib/supabase/server";

type Admin = ReturnType<typeof createAdminClient>;

export function isReportUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

// Reporters can read their own reports. Never copy private contacts or storage URLs here.
const EVIDENCE_FIELDS = new Set([
  "id", "name", "display_nickname", "nickname", "sex", "age", "region", "height_cm", "job",
  "intro", "intro_text", "strengths_text", "preferred_partner_text", "ideal_type", "status", "state", "message", "created_at",
]);

export function safeReportEvidence(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result = Object.fromEntries(Object.entries(value).filter(([key, item]) =>
    EVIDENCE_FIELDS.has(key) && (item === null || ["string", "number", "boolean"].includes(typeof item))
  ));
  return Object.keys(result).length > 0 ? result : null;
}

export async function applyReportBlock(admin: Admin, reporterId: string, reportedId: string) {
  let blocked = false;
  let pendingMatchesCanceled = false;
  try {
    const result = await admin.from("dating_user_blocks").upsert({
      blocker_user_id: reporterId,
      blocked_user_id: reportedId,
      reason: "신고 접수 자동 차단",
    }, { onConflict: "blocker_user_id,blocked_user_id" });
    if (result.error) throw result.error;
    blocked = true;
  } catch (error) {
    console.error("[dating report] saved, but automatic block failed", error);
  }

  // A saved report must remain successful even if an independent follow-up fails.
  // Do not cancel mutual matches, payment processing, or an approved contact exchange.
  if (blocked) {
    try {
      const result = await admin.from("dating_1on1_match_proposals")
        .update({ state: "admin_canceled", updated_at: new Date().toISOString() })
        .or(`and(source_user_id.eq.${reporterId},candidate_user_id.eq.${reportedId}),and(source_user_id.eq.${reportedId},candidate_user_id.eq.${reporterId})`)
        .in("state", ["proposed", "source_selected", "candidate_accepted"])
        .eq("contact_exchange_status", "none")
        .is("contact_exchange_paid_at", null)
        .is("contact_exchange_approved_at", null);
      if (result.error) throw result.error;
      pendingMatchesCanceled = true;
    } catch (error) {
      console.error("[dating report] saved and blocked, but pending cleanup failed", error);
    }
  }
  return { blocked, pending_matches_canceled: pendingMatchesCanceled };
}

export function reportResultMessage(alreadyReported: boolean, blocked: boolean, pendingCanceled: boolean) {
  const receipt = alreadyReported ? "이미 접수된 신고입니다. 기존 신고 내용은 유지됩니다." : "신고가 접수됐습니다.";
  if (!blocked) return `${receipt} 다만 차단을 완료하지 못했습니다. 잠시 후 신고 버튼으로 다시 시도해 주세요.`;
  if (!pendingCanceled) return `${receipt} 상대 회원은 차단됐지만 대기 중인 요청 정리가 지연되고 있습니다. 잠시 후 다시 확인해 주세요.`;
  return `${receipt} 상대 회원을 차단했습니다. 이미 교환된 연락처는 회수되지 않습니다.`;
}
