import { NextResponse } from "next/server";
import { ensureCronAuthorized } from "@/lib/cron-auth";
import { sendDatingEmailToAddressDetailed } from "@/lib/dating-swipe";
import { appendMarketingEmailFooter } from "@/lib/marketing-email";
import { createAdminClient } from "@/lib/supabase/server";

const JOB_TABLE = "admin_outreach_mail_jobs";
const LOG_TABLE = "admin_open_card_outreach_mail_logs";
const WORKER_CHUNK_SIZE = 60;
const SEND_CONCURRENCY = 2;
const SEND_BATCH_PAUSE_MS = 200;

type OutreachJobRow = {
  id: string;
  campaign_key: string;
  status: "queued" | "running" | "completed" | "failed" | "canceled";
  subject: string;
  body: string;
  filters: Record<string, unknown> | null;
  recipients: unknown;
  total_count: number | null;
  processed_count: number | null;
  sent_count: number | null;
  failed_count: number | null;
  failure_summary: unknown;
  first_failure: string | null;
  admin_user_id: string | null;
};

type JobRecipient = {
  user_id: string;
  email: string | null;
  nickname?: string | null;
  reason?: string | null;
  expired_days?: number | null;
  activity_at?: string | null;
};

type MailLogInsertRow = {
  campaign_key: string;
  user_id: string;
  email: string | null;
  subject: string;
  success: boolean;
  provider: string;
  provider_status: number | null;
  provider_error: string | null;
  sent_at: string;
  admin_user_id: string | null;
  meta: Record<string, unknown>;
};

function normalizeRecipients(value: unknown): JobRecipient[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const userId = String(row.user_id ?? "").trim();
      if (!userId) return null;
      const email = String(row.email ?? "").trim() || null;
      return {
        user_id: userId,
        email,
        nickname: String(row.nickname ?? "").trim() || null,
        reason: String(row.reason ?? "").trim() || null,
        expired_days: Number.isFinite(Number(row.expired_days)) ? Number(row.expired_days) : null,
        activity_at: String(row.activity_at ?? "").trim() || null,
      } satisfies JobRecipient;
    })
    .filter(Boolean) as JobRecipient[];
}

function normalizeFailureSummary(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean).slice(0, 10) : [];
}

function mergeFailureSummary(current: string[], bucket: Map<string, number>) {
  const next = Array.from(bucket.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([reason, count]) => `${count}건 · ${reason}`);
  return Array.from(new Set([...current, ...next])).slice(0, 10);
}

function isMissingTableError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String(error.code ?? "").trim() : "";
  const message = "message" in error ? String(error.message ?? "").trim() : "";
  return code === "42P01" || code === "PGRST205" || message.toLowerCase().includes("schema cache");
}

async function insertLogs(admin: ReturnType<typeof createAdminClient>, rows: MailLogInsertRow[]) {
  if (!rows.length) return;
  const res = await admin.from(LOG_TABLE).insert(rows);
  if (res.error) {
    console.error("[admin-outreach-mail-jobs] failed to insert logs", res.error);
  }
}

async function processJob(admin: ReturnType<typeof createAdminClient>, job: OutreachJobRow) {
  const recipients = normalizeRecipients(job.recipients);
  const processed = Math.max(0, Number(job.processed_count ?? 0));
  const chunk = recipients.slice(processed, processed + WORKER_CHUNK_SIZE);

  if (!chunk.length) {
    await admin
      .from(JOB_TABLE)
      .update({
        status: "completed",
        total_count: recipients.length,
        processed_count: recipients.length,
        finished_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id);
    return { job_id: job.id, processed: 0, sent: 0, failed: 0, completed: true };
  }

  await admin
    .from(JOB_TABLE)
    .update({
      status: "running",
      locked_at: new Date().toISOString(),
      started_at: new Date().toISOString(),
      total_count: recipients.length,
      updated_at: new Date().toISOString(),
    })
    .eq("id", job.id);

  let sent = 0;
  let failed = 0;
  let firstFailure = job.first_failure ?? null;
  const failureBuckets = new Map<string, number>();

  for (let start = 0; start < chunk.length; start += SEND_CONCURRENCY) {
    const batch = chunk.slice(start, start + SEND_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (item, index) => {
        const sentAt = new Date().toISOString();
        const meta = {
          ...(job.filters ?? {}),
          background_job_id: job.id,
          reason: item.reason ?? null,
          expired_days: item.expired_days ?? null,
          activity_at: item.activity_at ?? null,
        };

        if (!item.email) {
          return {
            ok: false as const,
            error: `발송 실패: ${item.nickname ?? item.user_id} / EMAIL_MISSING`,
            logRow: {
              campaign_key: job.campaign_key,
              user_id: item.user_id,
              email: null,
              subject: job.subject,
              success: false,
              provider: "resend",
              provider_status: null,
              provider_error: "EMAIL_MISSING",
              sent_at: sentAt,
              admin_user_id: job.admin_user_id,
              meta,
            } satisfies MailLogInsertRow,
          };
        }

        const mailBody = appendMarketingEmailFooter({
          body: job.body,
          userId: item.user_id,
          email: item.email,
          campaignKey: job.campaign_key,
        });
        const result = await sendDatingEmailToAddressDetailed(item.email, job.subject, mailBody, {
          idempotencyKey: `outreach-job:${job.id}:${item.user_id}:${processed + start + index}`,
        }).catch(() => ({
          ok: false,
          status: undefined,
          error: "UNHANDLED_SEND_ERROR",
          retryable: false,
        }));

        return result.ok
          ? {
              ok: true as const,
              error: null,
              logRow: {
                campaign_key: job.campaign_key,
                user_id: item.user_id,
                email: item.email,
                subject: job.subject,
                success: true,
                provider: "resend",
                provider_status: result.status ?? 200,
                provider_error: null,
                sent_at: sentAt,
                admin_user_id: job.admin_user_id,
                meta,
              } satisfies MailLogInsertRow,
            }
          : {
              ok: false as const,
              error: `발송 실패: ${item.nickname ?? item.email} (${item.email}) / ${result.status ?? "-"} / ${
                result.error ?? "UNKNOWN"
              }`,
              logRow: {
                campaign_key: job.campaign_key,
                user_id: item.user_id,
                email: item.email,
                subject: job.subject,
                success: false,
                provider: "resend",
                provider_status: result.status ?? null,
                provider_error: result.error ?? "UNKNOWN",
                sent_at: sentAt,
                admin_user_id: job.admin_user_id,
                meta,
              } satisfies MailLogInsertRow,
            };
      })
    );

    await insertLogs(
      admin,
      results.map((result) => result.logRow)
    );

    for (const result of results) {
      if (result.ok) {
        sent += 1;
        continue;
      }
      failed += 1;
      if (!firstFailure && result.error) firstFailure = result.error;
      if (result.error) {
        const bucketKey = result.error.split(" / ").slice(1).join(" / ") || result.error;
        failureBuckets.set(bucketKey, (failureBuckets.get(bucketKey) ?? 0) + 1);
      }
    }

    if (start + SEND_CONCURRENCY < chunk.length) {
      await new Promise((resolve) => setTimeout(resolve, SEND_BATCH_PAUSE_MS));
    }
  }

  const nextProcessed = Math.min(recipients.length, processed + chunk.length);
  const completed = nextProcessed >= recipients.length;
  const currentFailureSummary = normalizeFailureSummary(job.failure_summary);

  const updateRes = await admin
    .from(JOB_TABLE)
    .update({
      status: completed ? "completed" : "running",
      processed_count: nextProcessed,
      sent_count: Number(job.sent_count ?? 0) + sent,
      failed_count: Number(job.failed_count ?? 0) + failed,
      failure_summary: mergeFailureSummary(currentFailureSummary, failureBuckets),
      first_failure: firstFailure,
      finished_at: completed ? new Date().toISOString() : null,
      locked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", job.id);

  if (updateRes.error) throw updateRes.error;

  return { job_id: job.id, processed: chunk.length, sent, failed, completed };
}

export async function GET(request: Request) {
  const authResponse = ensureCronAuthorized(request);
  if (authResponse) return authResponse;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from(JOB_TABLE)
    .select(
      "id,campaign_key,status,subject,body,filters,recipients,total_count,processed_count,sent_count,failed_count,failure_summary,first_failure,admin_user_id"
    )
    .in("status", ["queued", "running"])
    .order("created_at", { ascending: true })
    .limit(1);

  if (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json({ ok: false, error: "admin_outreach_mail_jobs table is missing" }, { status: 500 });
    }
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const job = ((data ?? []) as OutreachJobRow[])[0] ?? null;
  if (!job) {
    return NextResponse.json({ ok: true, processed_jobs: 0 });
  }

  try {
    const result = await processJob(admin, job);
    return NextResponse.json({ ok: true, processed_jobs: 1, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown outreach mail job error";
    await admin
      .from(JOB_TABLE)
      .update({
        status: "failed",
        last_error: message,
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id);
    return NextResponse.json({ ok: false, error: message, job_id: job.id }, { status: 500 });
  }
}
