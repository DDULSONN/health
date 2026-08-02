import { ensureCronAuthorized } from "@/lib/cron-auth";
import { sendExpoPushToUser } from "@/lib/expo-push";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

type ReminderKind = "pending_24h" | "pending_72h";
type ApplicationSource = "open" | "paid";

type ApplicationRow = {
  id: string;
  card_id: string;
  applicant_user_id: string;
  applicant_display_nickname: string | null;
  created_at: string;
};

type PendingApplication = ApplicationRow & {
  owner_user_id: string;
  source: ApplicationSource;
};

type NotificationRow = {
  meta_json: Record<string, unknown> | null;
};

const MIN_REMINDER_AGE_HOURS = 24;
const SECOND_REMINDER_AGE_HOURS = 72;
const MAX_REMINDER_AGE_DAYS = 14;
const QUERY_PAGE_SIZE = 1000;
const MAX_BATCHES_PER_RUN = 100;

function isoHoursAgo(nowMs: number, hours: number) {
  return new Date(nowMs - hours * 60 * 60 * 1000).toISOString();
}

function safeNickname(value: string | null | undefined) {
  return String(value ?? "").trim() || "회원";
}

function getReminderKind(createdAt: string, nowMs: number): ReminderKind {
  const ageHours = (nowMs - new Date(createdAt).getTime()) / (60 * 60 * 1000);
  return ageHours >= SECOND_REMINDER_AGE_HOURS ? "pending_72h" : "pending_24h";
}

function getMetaText(meta: Record<string, unknown> | null, key: string) {
  const value = meta?.[key];
  return typeof value === "string" ? value.trim() : "";
}

async function loadRows<T>(
  loadPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message?: string } | null }>
) {
  const rows: T[] = [];
  for (let from = 0; ; from += QUERY_PAGE_SIZE) {
    const result = await loadPage(from, from + QUERY_PAGE_SIZE - 1);
    if (result.error) throw result.error;
    const page = result.data ?? [];
    rows.push(...page);
    if (page.length < QUERY_PAGE_SIZE) break;
  }
  return rows;
}

async function loadOpenApplications(
  admin: ReturnType<typeof createAdminClient>,
  newerThan: string,
  olderThan: string
): Promise<PendingApplication[]> {
  const applications = await loadRows<ApplicationRow>((from, to) =>
    admin
      .from("dating_card_applications")
      .select("id,card_id,applicant_user_id,applicant_display_nickname,created_at")
      .eq("status", "submitted")
      .gte("created_at", newerThan)
      .lte("created_at", olderThan)
      .order("created_at", { ascending: false })
      .range(from, to)
  );
  if (applications.length === 0) return [];

  const cardIds = [...new Set(applications.map((item) => item.card_id))];
  const cardOwners = new Map<string, string>();
  for (let start = 0; start < cardIds.length; start += 300) {
    const result = await admin
      .from("dating_cards")
      .select("id,owner_user_id")
      .in("id", cardIds.slice(start, start + 300));
    if (result.error) throw result.error;
    for (const card of result.data ?? []) {
      cardOwners.set(String(card.id), String(card.owner_user_id));
    }
  }

  return applications.flatMap((application) => {
    const ownerUserId = cardOwners.get(application.card_id);
    if (!ownerUserId || ownerUserId === application.applicant_user_id) return [];
    return [{ ...application, owner_user_id: ownerUserId, source: "open" as const }];
  });
}

async function loadPaidApplications(
  admin: ReturnType<typeof createAdminClient>,
  newerThan: string,
  olderThan: string
): Promise<PendingApplication[]> {
  const rawApplications = await loadRows<{
    id: string;
    paid_card_id: string;
    applicant_user_id: string;
    applicant_display_nickname: string | null;
    created_at: string;
  }>((from, to) =>
    admin
      .from("dating_paid_card_applications")
      .select("id,paid_card_id,applicant_user_id,applicant_display_nickname,created_at")
      .eq("status", "submitted")
      .gte("created_at", newerThan)
      .lte("created_at", olderThan)
      .order("created_at", { ascending: false })
      .range(from, to)
  );
  if (rawApplications.length === 0) return [];

  const cardIds = [...new Set(rawApplications.map((item) => item.paid_card_id))];
  const cardOwners = new Map<string, string>();
  for (let start = 0; start < cardIds.length; start += 300) {
    const result = await admin
      .from("dating_paid_cards")
      .select("id,user_id")
      .in("id", cardIds.slice(start, start + 300));
    if (result.error) throw result.error;
    for (const card of result.data ?? []) {
      cardOwners.set(String(card.id), String(card.user_id));
    }
  }

  return rawApplications.flatMap((application) => {
    const ownerUserId = cardOwners.get(application.paid_card_id);
    if (!ownerUserId || ownerUserId === application.applicant_user_id) return [];
    return [
      {
        id: application.id,
        card_id: application.paid_card_id,
        applicant_user_id: application.applicant_user_id,
        applicant_display_nickname: application.applicant_display_nickname,
        created_at: application.created_at,
        owner_user_id: ownerUserId,
        source: "paid" as const,
      },
    ];
  });
}

export async function GET(request: Request) {
  const authResponse = ensureCronAuthorized(request);
  if (authResponse) return authResponse;

  const admin = createAdminClient();
  const nowMs = Date.now();
  const newerThan = isoHoursAgo(nowMs, MAX_REMINDER_AGE_DAYS * 24);
  const olderThan = isoHoursAgo(nowMs, MIN_REMINDER_AGE_HOURS);

  let applications: PendingApplication[];
  try {
    const [openApplications, paidApplications] = await Promise.all([
      loadOpenApplications(admin, newerThan, olderThan),
      loadPaidApplications(admin, newerThan, olderThan),
    ]);
    applications = [...openApplications, ...paidApplications].sort((a, b) =>
      b.created_at.localeCompare(a.created_at)
    );
  } catch (error) {
    console.error("[cron dating-application-reminders] pending applications query failed", error);
    return NextResponse.json({ error: "지원 리마인드 대상을 불러오지 못했습니다." }, { status: 500 });
  }

  const existingNotifications = await loadRows<NotificationRow>((from, to) =>
    admin
      .from("notifications")
      .select("meta_json")
      .eq("type", "dating_application_received")
      .gte("created_at", newerThan)
      .order("created_at", { ascending: false })
      .range(from, to)
  ).catch((error) => {
    console.error("[cron dating-application-reminders] notification dedupe query failed", error);
    return null;
  });

  if (!existingNotifications) {
    return NextResponse.json({ error: "지원 리마인드 중복 여부를 확인하지 못했습니다." }, { status: 500 });
  }

  const sentKeys = new Set(
    existingNotifications.flatMap((notification) => {
      const reminderKind = getMetaText(notification.meta_json, "reminder_kind");
      if (!reminderKind) return [];
      const source = getMetaText(notification.meta_json, "source_kind") || "open";
      const applicationIds = Array.isArray(notification.meta_json?.application_ids)
        ? notification.meta_json.application_ids.filter(
            (value): value is string => typeof value === "string" && value.trim().length > 0
          )
        : [];
      const applicationId = getMetaText(notification.meta_json, "application_id");
      if (applicationId) applicationIds.push(applicationId);
      return [...new Set(applicationIds)].map((id) => `${source}:${id}:${reminderKind}`);
    })
  );

  const batches = new Map<
    string,
    {
      owner_user_id: string;
      source: ApplicationSource;
      reminder_kind: ReminderKind;
      applications: PendingApplication[];
    }
  >();

  let skipped = 0;
  for (const application of applications) {
    const reminderKind = getReminderKind(application.created_at, nowMs);
    const dedupeKey = `${application.source}:${application.id}:${reminderKind}`;
    if (sentKeys.has(dedupeKey)) {
      skipped += 1;
      continue;
    }

    const batchKey = `${application.owner_user_id}:${application.source}:${reminderKind}`;
    const batch = batches.get(batchKey) ?? {
      owner_user_id: application.owner_user_id,
      source: application.source,
      reminder_kind: reminderKind,
      applications: [],
    };
    batch.applications.push(application);
    batches.set(batchKey, batch);
  }

  const orderedBatches = [...batches.values()].sort((a, b) =>
    b.applications[0].created_at.localeCompare(a.applications[0].created_at)
  );

  const result = {
    candidates: applications.length,
    batches: orderedBatches.length,
    sent: 0,
    skipped,
    failed: 0,
  };

  for (const batch of orderedBatches.slice(0, MAX_BATCHES_PER_RUN)) {
    const latestApplication = batch.applications[0];
    const applicationIds = batch.applications.map((application) => application.id);
    const sourceLabel = batch.source === "paid" ? "대기 없이 등록 카드" : "오픈카드";
    const title = batch.reminder_kind === "pending_72h" ? "아직 답변하지 않은 지원이 있어요" : "지원 답변이 기다리고 있어요";
    const body =
      batch.applications.length === 1
        ? `${safeNickname(latestApplication.applicant_display_nickname)}님의 ${sourceLabel} 지원이 대기 중이에요. 수락하거나 거절해 주세요.`
        : `${sourceLabel} 지원 ${batch.applications.length}건이 대기 중이에요. 확인 후 수락하거나 거절해 주세요.`;
    const route = batch.source === "paid" ? "/mypage#paid-card-received" : "/mypage#open-card-received";

    const insertResult = await admin.from("notifications").insert({
      user_id: batch.owner_user_id,
      actor_id: latestApplication.applicant_user_id,
      type: "dating_application_received",
      post_id: null,
      comment_id: null,
      meta_json: {
        card_id: latestApplication.card_id,
        application_id: latestApplication.id,
        application_ids: applicationIds,
        pending_count: batch.applications.length,
        reminder_kind: batch.reminder_kind,
        source_kind: batch.source,
        notification_title: title,
        notification_body: body,
        notification_route: route,
      },
    });

    if (insertResult.error) {
      console.error("[cron dating-application-reminders] notification insert failed", {
        applicationIds,
        source: batch.source,
        error: insertResult.error,
      });
      result.failed += 1;
      continue;
    }

    for (const applicationId of applicationIds) {
      sentKeys.add(`${batch.source}:${applicationId}:${batch.reminder_kind}`);
    }
    await sendExpoPushToUser(admin, batch.owner_user_id, {
      title,
      body,
      data: {
        type: "dating_application_received",
        cardId: latestApplication.card_id,
        applicationId: latestApplication.id,
        reminderKind: batch.reminder_kind,
        sourceKind: batch.source,
        route,
      },
    }).catch((error) => {
      console.error("[cron dating-application-reminders] expo push failed", {
        applicationIds,
        source: batch.source,
        error,
      });
    });
    result.sent += 1;
  }

  return NextResponse.json({ ok: true, result });
}
