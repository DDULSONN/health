import { NextResponse } from "next/server";
import {
  DATING_ONE_ON_ONE_ACTIVE_STATUSES,
  isDatingOneOnOneLegacyPhoneShareMatch,
  type DatingOneOnOneMatchRow,
} from "@/lib/dating-1on1";
import { sendDatingEmailToAddressDetailed } from "@/lib/dating-swipe";
import {
  appendMarketingEmailFooter,
  fetchMarketingUnsubscribedUserIds,
  normalizeMarketingSubject,
} from "@/lib/marketing-email";
import { requireAdminRoute } from "@/lib/admin-route";
import { createAdminClient } from "@/lib/supabase/server";

const APPLICANT_BATCH_SIZE = 1000;
const MATCH_BATCH_SIZE = 1000;
const PROFILE_BATCH_SIZE = 500;
const SEND_CONCURRENCY = 8;
const RECENT_SUCCESS_HOURS = 24;
const MAIL_LOG_TABLE = "admin_open_card_outreach_mail_logs";
const CAMPAIGN_KEY = "one_on_one_outreach";
const FULL_MATCH_SELECT =
  "id,source_card_id,source_user_id,candidate_card_id,candidate_user_id,state,contact_exchange_status,contact_exchange_requested_at,contact_exchange_paid_at,contact_exchange_paid_by_user_id,contact_exchange_approved_at,contact_exchange_approved_by_user_id,contact_exchange_note,source_phone_share_consented_at,candidate_phone_share_consented_at,admin_sent_by_user_id,source_selected_at,candidate_responded_at,source_final_responded_at,created_at,updated_at";
const LEGACY_MATCH_SELECT =
  "id,source_card_id,source_user_id,candidate_card_id,candidate_user_id,state,admin_sent_by_user_id,source_selected_at,candidate_responded_at,source_final_responded_at,created_at,updated_at";

type AdminClient = ReturnType<typeof createAdminClient>;
type NoticeScope = "all_applicants" | "mutual_only" | "legacy_mutual" | "new_mutual";

type NoticePreviewResponse = {
  scope: NoticeScope;
  recipient_count: number;
  excluded_recent_success_count: number;
  excluded_unsubscribed_count: number;
  legacy_mutual_user_count: number;
  new_mutual_user_count: number;
  subject: string;
  body: string;
  preview_lines: string[];
};

type LegacyNoticeMatchRow = Omit<
  DatingOneOnOneMatchRow,
  | "contact_exchange_status"
  | "contact_exchange_requested_at"
  | "contact_exchange_paid_at"
  | "contact_exchange_paid_by_user_id"
  | "contact_exchange_approved_at"
  | "contact_exchange_approved_by_user_id"
  | "contact_exchange_note"
  | "source_phone_share_consented_at"
  | "candidate_phone_share_consented_at"
> & {
  contact_exchange_status?: never;
};

type NoticeMailLogRow = {
  user_id: string | null;
  sent_at: string | null;
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
  admin_user_id: string;
  meta: Record<string, unknown>;
};

const DEFAULT_NOTICE_SCOPE: NoticeScope = "mutual_only";

function getDefaultNoticeSubject() {
  return "";
}

function buildDefaultNoticeBody() {
  return "";
}

function isMissingContactExchangeColumnsError(error: { message?: string } | null | undefined) {
  const message = String(error?.message ?? "");
  return (
    message.includes("contact_exchange_status") ||
    message.includes("contact_exchange_requested_at") ||
    message.includes("contact_exchange_paid_at") ||
    message.includes("contact_exchange_paid_by_user_id") ||
    message.includes("contact_exchange_approved_at") ||
    message.includes("contact_exchange_approved_by_user_id") ||
    message.includes("contact_exchange_note") ||
    message.includes("source_phone_share_consented_at") ||
    message.includes("candidate_phone_share_consented_at")
  );
}

function isMissingMailLogTableError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String(error.code ?? "") : "";
  const message = "message" in error ? String(error.message ?? "") : "";
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    message.includes(MAIL_LOG_TABLE) ||
    message.toLowerCase().includes("schema cache")
  );
}

function toLegacyCompatibleMatchRow(row: LegacyNoticeMatchRow): DatingOneOnOneMatchRow {
  return {
    ...row,
    contact_exchange_status: "none",
    contact_exchange_requested_at: null,
    contact_exchange_paid_at: null,
    contact_exchange_paid_by_user_id: null,
    contact_exchange_approved_at: null,
    contact_exchange_approved_by_user_id: null,
    contact_exchange_note: null,
    source_phone_share_consented_at: null,
    candidate_phone_share_consented_at: null,
  };
}

async function fetchApplicantUserIds(admin: AdminClient) {
  const userIds = new Set<string>();
  let from = 0;

  while (true) {
    const { data, error } = await admin
      .from("dating_1on1_cards")
      .select("user_id,status")
      .in("status", [...DATING_ONE_ON_ONE_ACTIVE_STATUSES])
      .order("created_at", { ascending: false })
      .range(from, from + APPLICANT_BATCH_SIZE - 1);

    if (error) throw error;

    const batch = (data ?? []) as Array<{ user_id: string | null }>;
    for (const row of batch) {
      const userId = String(row.user_id ?? "").trim();
      if (userId) userIds.add(userId);
    }

    if (batch.length < APPLICANT_BATCH_SIZE) break;
    from += APPLICANT_BATCH_SIZE;
  }

  return [...userIds];
}

async function fetchMutualAcceptedMatches(admin: AdminClient) {
  const rows: DatingOneOnOneMatchRow[] = [];
  let from = 0;
  let useLegacySelect = false;

  while (true) {
    const buildQuery = (selectColumns: string) =>
      admin
        .from("dating_1on1_match_proposals")
        .select(selectColumns)
        .eq("state", "mutual_accepted")
        .order("created_at", { ascending: false })
        .range(from, from + MATCH_BATCH_SIZE - 1);

    let { data, error } = await buildQuery(useLegacySelect ? LEGACY_MATCH_SELECT : FULL_MATCH_SELECT);
    if (error && !useLegacySelect && isMissingContactExchangeColumnsError(error)) {
      useLegacySelect = true;
      ({ data, error } = await buildQuery(LEGACY_MATCH_SELECT));
    }

    if (error) throw error;

    const batch = useLegacySelect
      ? ((data ?? []) as unknown as LegacyNoticeMatchRow[]).map(toLegacyCompatibleMatchRow)
      : ((data ?? []) as unknown as DatingOneOnOneMatchRow[]);

    rows.push(...batch);
    if (batch.length < MATCH_BATCH_SIZE) break;
    from += MATCH_BATCH_SIZE;
  }

  return rows;
}

function parseNoticeScope(value: string | null | undefined): NoticeScope {
  if (value === "all_applicants" || value === "mutual_only" || value === "legacy_mutual" || value === "new_mutual") {
    return value;
  }
  return DEFAULT_NOTICE_SCOPE;
}

function getScopedRecipientUserIds(
  scope: NoticeScope,
  applicantUserIds: string[],
  matches: DatingOneOnOneMatchRow[]
) {
  if (scope === "all_applicants") {
    return applicantUserIds;
  }

  const legacyUsers = new Set<string>();
  const newUsers = new Set<string>();

  for (const match of matches) {
    const targetSet = isDatingOneOnOneLegacyPhoneShareMatch(match) ? legacyUsers : newUsers;
    if (match.source_user_id) targetSet.add(match.source_user_id);
    if (match.candidate_user_id) targetSet.add(match.candidate_user_id);
  }

  if (scope === "legacy_mutual") {
    return [...legacyUsers];
  }
  if (scope === "new_mutual") {
    return [...newUsers];
  }

  return [...new Set([...legacyUsers, ...newUsers])];
}

async function fetchRecentSuccessfulMailMap(admin: AdminClient, userIds: string[]) {
  const sentAtByUserId = new Map<string, string>();
  if (!userIds.length) return sentAtByUserId;

  const cutoff = new Date(Date.now() - RECENT_SUCCESS_HOURS * 60 * 60 * 1000).toISOString();
  for (let start = 0; start < userIds.length; start += PROFILE_BATCH_SIZE) {
    const chunk = userIds.slice(start, start + PROFILE_BATCH_SIZE);
    const res = await admin
      .from(MAIL_LOG_TABLE)
      .select("user_id,sent_at")
      .eq("campaign_key", CAMPAIGN_KEY)
      .eq("success", true)
      .gte("sent_at", cutoff)
      .in("user_id", chunk)
      .order("sent_at", { ascending: false });

    if (res.error) {
      if (isMissingMailLogTableError(res.error)) {
        console.warn(`[1on1-notice] mail log table missing: ${MAIL_LOG_TABLE}`);
        return new Map<string, string>();
      }
      throw new Error(`메일 발송 로그를 불러오지 못했습니다. ${res.error.message}`);
    }

    for (const row of (res.data ?? []) as NoticeMailLogRow[]) {
      const userId = String(row.user_id ?? "").trim();
      const sentAt = String(row.sent_at ?? "").trim();
      if (userId && sentAt && !sentAtByUserId.has(userId)) {
        sentAtByUserId.set(userId, sentAt);
      }
    }
  }

  return sentAtByUserId;
}

async function filterLegalRecipients(admin: AdminClient, userIds: string[]) {
  const [recentSuccessByUserId, unsubscribedUserIds] = await Promise.all([
    fetchRecentSuccessfulMailMap(admin, userIds),
    fetchMarketingUnsubscribedUserIds(admin, userIds, CAMPAIGN_KEY),
  ]);

  return {
    userIds: userIds.filter((userId) => !recentSuccessByUserId.has(userId) && !unsubscribedUserIds.has(userId)),
    excludedRecentSuccessCount: userIds.filter((userId) => recentSuccessByUserId.has(userId)).length,
    excludedUnsubscribedCount: userIds.filter((userId) => unsubscribedUserIds.has(userId)).length,
  };
}

async function buildNoticePreview(
  admin: AdminClient,
  scope: NoticeScope
): Promise<NoticePreviewResponse> {
  const [applicantUserIds, matches] = await Promise.all([
    fetchApplicantUserIds(admin),
    fetchMutualAcceptedMatches(admin),
  ]);

  const legacyUsers = new Set<string>();
  const newUsers = new Set<string>();

  for (const match of matches) {
    const targetSet = isDatingOneOnOneLegacyPhoneShareMatch(match) ? legacyUsers : newUsers;
    if (match.source_user_id) targetSet.add(match.source_user_id);
    if (match.candidate_user_id) targetSet.add(match.candidate_user_id);
  }

  const scopedUserIds = getScopedRecipientUserIds(scope, applicantUserIds, matches);
  const eligible = await filterLegalRecipients(admin, scopedUserIds);
  const body = buildDefaultNoticeBody();

  return {
    scope,
    recipient_count: eligible.userIds.length,
    excluded_recent_success_count: eligible.excludedRecentSuccessCount,
    excluded_unsubscribed_count: eligible.excludedUnsubscribedCount,
    legacy_mutual_user_count: legacyUsers.size,
    new_mutual_user_count: newUsers.size,
    subject: getDefaultNoticeSubject(),
    body,
    preview_lines: body ? body.split("\n") : [],
  };
}

async function insertLogs(admin: AdminClient, rows: MailLogInsertRow[]) {
  if (!rows.length) return;
  const res = await admin.from(MAIL_LOG_TABLE).insert(rows);
  if (res.error) {
    if (isMissingMailLogTableError(res.error)) return;
    console.error("[1on1-notice] failed to insert mail logs", res.error);
  }
}

async function sendInBatches(
  userIds: string[],
  admin: AdminClient,
  adminUserId: string,
  subject: string,
  text: string,
  scope: NoticeScope
) {
  let sent = 0;
  let failed = 0;

  for (let start = 0; start < userIds.length; start += SEND_CONCURRENCY) {
    const batch = userIds.slice(start, start + SEND_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (userId) => {
        const sentAt = new Date().toISOString();
        const userRes = await admin.auth.admin.getUserById(userId).catch(() => null);
        const email = userRes?.data?.user?.email?.trim() || null;
        const meta = { scope, source: "admin_1on1_notice" };

        if (!email) {
          return {
            ok: false,
            logRow: {
              campaign_key: CAMPAIGN_KEY,
              user_id: userId,
              email: null,
              subject,
              success: false,
              provider: "resend",
              provider_status: null,
              provider_error: "EMAIL_MISSING",
              sent_at: sentAt,
              admin_user_id: adminUserId,
              meta,
            } satisfies MailLogInsertRow,
          };
        }

        const mailBody = appendMarketingEmailFooter({
          body: text,
          userId,
          email,
          campaignKey: CAMPAIGN_KEY,
        });
        const result = await sendDatingEmailToAddressDetailed(email, subject, mailBody, {
          idempotencyKey: `one-on-one-notice:${userId}:${sentAt.slice(0, 10)}:${subject}`,
        }).catch(() => ({
          ok: false,
          status: undefined,
          error: "UNHANDLED_SEND_ERROR",
          retryable: false,
        }));

        return {
          ok: result.ok,
          logRow: {
            campaign_key: CAMPAIGN_KEY,
            user_id: userId,
            email,
            subject,
            success: result.ok,
            provider: "resend",
            provider_status: result.status ?? null,
            provider_error: result.ok ? null : result.error ?? "UNKNOWN",
            sent_at: sentAt,
            admin_user_id: adminUserId,
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
      if (result.ok) sent += 1;
      else failed += 1;
    }
  }

  return { sent, failed };
}

export async function GET(request: Request) {
  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;

  try {
    const scope = parseNoticeScope(new URL(request.url).searchParams.get("scope"));
    const preview = await buildNoticePreview(auth.admin, scope);
    return NextResponse.json(preview);
  } catch (error) {
    console.error("[GET /api/admin/dating/1on1/notice] failed", error);
    return NextResponse.json({ error: "안내 메일 미리보기를 불러오지 못했습니다." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;

  try {
    let body: { scope?: NoticeScope; subject?: string; body?: string } | null = null;
    try {
      body = (await request.json()) as { scope?: NoticeScope; subject?: string; body?: string };
    } catch {
      body = null;
    }

    const requestScope = parseNoticeScope(body?.scope);
    const subject = normalizeMarketingSubject(String(body?.subject ?? "").trim());
    const text = String(body?.body ?? "").trim();

    if (!String(body?.subject ?? "").trim()) {
      return NextResponse.json({ error: "메일 제목을 입력해주세요." }, { status: 400 });
    }
    if (!text) {
      return NextResponse.json({ error: "메일 본문을 입력해주세요." }, { status: 400 });
    }

    const [applicantUserIds, matches] = await Promise.all([
      fetchApplicantUserIds(auth.admin),
      fetchMutualAcceptedMatches(auth.admin),
    ]);
    const scopedUserIds = getScopedRecipientUserIds(requestScope, applicantUserIds, matches);
    const eligible = await filterLegalRecipients(auth.admin, scopedUserIds);
    const { sent, failed } = await sendInBatches(
      eligible.userIds,
      auth.admin,
      auth.user.id,
      subject,
      text,
      requestScope
    );

    return NextResponse.json({
      ok: true,
      scope: requestScope,
      requested: eligible.userIds.length,
      sent,
      failed,
      excluded_recent_success_count: eligible.excludedRecentSuccessCount,
      excluded_unsubscribed_count: eligible.excludedUnsubscribedCount,
    });
  } catch (error) {
    console.error("[POST /api/admin/dating/1on1/notice] failed", error);
    return NextResponse.json({ error: "안내 메일 발송에 실패했습니다." }, { status: 500 });
  }
}
