import type { createAdminClient } from "@/lib/supabase/server";
import { loadOneOnOneRecommendations, type RecommendationRefreshPlan } from "@/lib/dating-1on1-recommendation-service";
import { sendDatingEmailNotification } from "@/lib/dating-swipe";
import { isOneOnOneReminderHour } from "@/lib/dating-1on1-reminders";
import type { RefreshOutcome } from "@/lib/dating-1on1-refresh-monitor-record";

type Admin = ReturnType<typeof createAdminClient>;
export type RefreshAuditAttempt = {
  id: string; user_id: string; source_card_id: string; created_at: string;
  expected_refresh_at: string | null; planned_at: string; source_profile_key: string;
  outcome: RefreshOutcome; persist_page: boolean; changed_count: number; rotated_count: number;
  before_candidate_ids: string[]; before_user_ids: string[]; after_user_ids: string[];
  main_candidate_ids: string[]; extra_candidate_ids: string[]; pool_count: number; safe_local_change: boolean;
  widened_count?: number; age_mismatch_count?: number;
};
type AuditJob = { id: string; user_id: string; attempt_id: string; lease_token: string; day_key: string };
export type RefreshAuditFinding = "healthy" | "quota_limit" | "pool_small" | "repeat_review" | "check_failed"
  | "superseded" | "repair_ready" | "repair_review" | "repaired" | "fit_review";

export function classifyRefreshAudit(a: RefreshAuditAttempt, plan?: RecommendationRefreshPlan): RefreshAuditFinding {
  if (a.outcome === "limited") return "quota_limit";
  if (a.outcome === "conflict") return "superseded";
  if (a.outcome === "unchanged") return a.pool_count <= new Set(a.before_user_ids).size ? "pool_small" : "repeat_review";
  if (a.outcome !== "failed") {
    const before = new Set(a.before_user_ids), after = new Set(a.after_user_ids);
    const different = [...after].filter(id => !before.has(id)).length;
    if (!different || (a.outcome === "changed" && a.changed_count === 0)) return "repeat_review";
    if (after.size && Math.max(a.widened_count ?? 0, a.age_mismatch_count ?? 0) >= Math.ceil(after.size / 2)) return "fit_review";
    return "healthy";
  }
  if (!plan) return "check_failed";
  const sameSeed = plan.expected_refresh_used_at === a.expected_refresh_at || (plan.expected_refresh_used_at != null
    && a.expected_refresh_at != null && Date.parse(plan.expected_refresh_used_at) === Date.parse(a.expected_refresh_at));
  if (plan.source_card_id !== a.source_card_id || !sameSeed
    || plan.source_profile_key !== a.source_profile_key) return "superseded";
  // A timeout may have committed successfully. The unchanged source seed above
  // is mandatory; never repeat a write with an uncertain/newer generation.
  const originallyAvailable = new Set([...a.main_candidate_ids, ...a.extra_candidate_ids].filter(id => !a.before_candidate_ids.includes(id)));
  const canRestore = [...plan.main_candidate_ids, ...plan.extra_candidate_ids].some(id => originallyAvailable.has(id));
  return a.persist_page && plan.persist_page && a.rotated_count > 0 && plan.rotated_candidate_count > 0
    && a.safe_local_change && plan.monitor?.safe_local_change && canRestore ? "repair_ready" : "repair_review";
}

async function finish(admin: Admin, job: AuditJob, finding: RefreshAuditFinding) {
  const result = await admin.from("dating_1on1_refresh_audits").update({ state: "done", finding,
    checked_at: new Date().toISOString() }).eq("id", job.id).eq("state", "running").eq("lease_token", job.lease_token);
  if (result.error) throw Error("AUDIT_FINISH_FAILED");
}

export async function auditRefreshAttempt(admin: Admin, job: AuditJob, a: RefreshAuditAttempt, mode: string) {
  let plan: RecommendationRefreshPlan | undefined;
  if (a.outcome === "failed") {
    const response = await loadOneOnOneRecommendations(admin, { id: a.user_id }, {
      sourceCardId: a.source_card_id, at: new Date().toISOString(),
    });
    if (response.ok) plan = (await response.json()).plan;
  }
  let finding = classifyRefreshAudit(a, plan);
  if (finding === "healthy") {
    const history = await admin.from("dating_1on1_refresh_attempts")
      .select("before_user_ids,after_user_ids,outcome").eq("user_id", a.user_id).eq("source_card_id", a.source_card_id)
      .gte("planned_at", `${job.day_key}T00:00:00+09:00`).lte("planned_at", a.planned_at)
      .in("outcome", ["changed", "rotated", "unchanged"]).order("planned_at", { ascending: false }).limit(3);
    if (history.error) throw Error("AUDIT_HISTORY_FAILED");
    const repetitive = (history.data ?? []).filter(row => {
      const before = new Set<string>(row.before_user_ids ?? []), after = new Set<string>(row.after_user_ids ?? []);
      return after.size > 0 && [...after].filter(id => before.has(id)).length / after.size >= 0.8;
    });
    // Review-only threshold: high overlap is NOT proof of a bug or grounds for
    // an automatic replacement, quota grant, or outbound message.
    if (repetitive.length >= 2) finding = "repeat_review";
  }
  if (finding === "repair_ready" && mode === "repair" && plan) {
    const result = await admin.rpc("repair_dating_1on1_refresh_audit", {
      p_job_id: job.id, p_token: job.lease_token, p_refresh_at: plan.refresh_at,
      p_main: plan.main_candidate_ids, p_extra: plan.extra_candidate_ids, p_source_key: plan.source_profile_key,
    });
    // An uncertain result is never retried here and never sends a notification.
    // SQL atomically persisted its own notification/outbox if it did succeed.
    if (result.error) throw Error("AUDIT_REPAIR_UNCERTAIN");
    if (result.data === true) return "repaired";
    finding = "superseded";
  }
  await finish(admin, job, finding);
  return finding;
}

export async function deliverRefreshRepairEmails(admin: Admin, deadline: number) {
  if (!isOneOnOneReminderHour(Date.now()) || !process.env.RESEND_API_KEY?.trim() || !process.env.NOTIFY_FROM_EMAIL?.trim()) return 0;
  const settings = await admin.from("dating_1on1_refresh_monitor_settings").select("mode,email_enabled").eq("singleton", true).single();
  if (settings.error || settings.data?.mode !== "repair" || !settings.data.email_enabled) return 0;
  const pending = await admin.from("dating_1on1_refresh_audits").select("id,user_id,attempt_id,repaired_at")
    .eq("email_state", "pending").gte("repaired_at", new Date(Date.now() - 86400000).toISOString())
    .order("repaired_at").limit(10);
  if (pending.error) throw Error("AUDIT_EMAIL_READ_FAILED");
  let sent = 0;
  for (const row of pending.data ?? []) {
    if (Date.now() > deadline - 15000) break;
    const reserved = await admin.from("dating_1on1_refresh_audits").update({ email_state: "sending" })
      .eq("id", row.id).eq("email_state", "pending").select("id");
    if (reserved.error || !reserved.data?.length) continue;
    try {
      const ok = await sendDatingEmailNotification(admin, row.user_id, "[짐툴] 1:1 후보 새로고침 복구 안내",
        "안녕하세요, 짐툴입니다.\n\n회원님의 1:1 후보 새로고침 처리 오류를 확인해 후보 목록을 복구했습니다.\n"
        + "이번 복구에는 새로고침 횟수를 사용하지 않았습니다. 보내신 요청, 찜, 진행 중인 매칭과 연락처 교환 내역은 그대로 유지됩니다.\n\n"
        + "현재 후보는 아래 화면에서 확인하실 수 있습니다.\nhttps://helchang.com/community/dating/cards?tab=one_on_one\n\n"
        + "이용에 불편을 드려 죄송합니다. 계속 점검하겠습니다.\n짐툴 드림",
        async () => {
          const [setting, attempt, profile] = await Promise.all([
            admin.from("dating_1on1_refresh_monitor_settings").select("mode,email_enabled").eq("singleton", true).single(),
            admin.from("dating_1on1_refresh_attempts").select("source_card_id").eq("id", row.attempt_id).maybeSingle(),
            admin.from("profiles").select("is_banned").eq("user_id", row.user_id).maybeSingle(),
          ]);
          if (setting.error || setting.data?.mode !== "repair" || !setting.data.email_enabled
            || attempt.error || !attempt.data || profile.error || !profile.data || profile.data.is_banned) return false;
          const current = await admin.from("dating_1on1_cards").select("id").eq("id", attempt.data.source_card_id)
            .eq("user_id", row.user_id).eq("recommendation_refresh_used_at", row.repaired_at)
            .in("status", ["submitted", "reviewing", "approved"]).maybeSingle();
          return !current.error && Boolean(current.data);
        }, `refresh-repair-${row.id}`);
      // The existing boolean sender deliberately does not distinguish an opt-out
      // from an uncertain provider outcome. Do not claim delivery or retry either.
      await admin.from("dating_1on1_refresh_audits").update({ email_state: ok ? "sent" : "unknown" })
        .eq("id", row.id).eq("email_state", "sending");
      if (ok) sent++;
    } catch {
      await admin.from("dating_1on1_refresh_audits").update({ email_state: "unknown" }).eq("id", row.id).eq("email_state", "sending");
    }
  }
  return sent;
}

export async function runRefreshMonitor(admin: Admin, deadline = Date.now() + 45000) {
  const settings = await admin.from("dating_1on1_refresh_monitor_settings").select("mode").eq("singleton", true).single();
  if (settings.error) {
    if (["42P01", "PGRST205"].includes(settings.error.code)) return { configured: false, checked: 0, sent: 0 };
    throw Error("AUDIT_SETTINGS_FAILED");
  }
  if (settings.data.mode === "off") {
    // The claim RPC only performs bounded retention cleanup in off mode.
    const cleanup = await admin.rpc("claim_dating_1on1_refresh_audit");
    if (cleanup.error) throw Error("AUDIT_RETENTION_FAILED");
    return { configured: true, checked: 0, sent: 0 };
  }
  let checked = 0;
  for (let i = 0; i < 20 && Date.now() < deadline - 20000; i++) {
    const claimed = await admin.rpc("claim_dating_1on1_refresh_audit");
    if (claimed.error) throw Error("AUDIT_CLAIM_FAILED");
    if (!claimed.data) break;
    const { job, attempt } = claimed.data as { job: AuditJob; attempt: RefreshAuditAttempt };
    try { await auditRefreshAttempt(admin, job, attempt, settings.data.mode); checked++; }
    catch { console.warn("[refresh-monitor] check incomplete", { auditId: job.id }); }
  }
  const sent = await deliverRefreshRepairEmails(admin, deadline);
  return { configured: true, checked, sent };
}
