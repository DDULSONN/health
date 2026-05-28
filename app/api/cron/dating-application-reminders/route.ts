import { ensureCronAuthorized } from "@/lib/cron-auth";
import { sendExpoPushToUser } from "@/lib/expo-push";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

type ReminderKind = "pending_24h";

type ApplicationRow = {
  id: string;
  card_id: string;
  applicant_user_id: string;
  applicant_display_nickname: string | null;
  created_at: string;
  status: string | null;
};

type CardRow = {
  id: string;
  owner_user_id: string;
};

const REMINDER_WINDOWS: Array<{
  kind: ReminderKind;
  minAgeHours: number;
  maxAgeHours: number;
  title: string;
  body: string;
}> = [
  {
    kind: "pending_24h",
    minAgeHours: 24,
    maxAgeHours: 26,
    title: "지원 답변이 기다리고 있어요",
    body: "아직 대기 중인 오픈카드 지원이 있어요. 수락하거나 패스해 주세요.",
  },
];

function isoHoursAgo(nowMs: number, hours: number) {
  return new Date(nowMs - hours * 60 * 60 * 1000).toISOString();
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function safeNickname(value: string | null | undefined) {
  const trimmed = String(value ?? "").trim();
  return trimmed || "상대";
}

export async function GET(request: Request) {
  const authResponse = ensureCronAuthorized(request);
  if (authResponse) return authResponse;

  const admin = createAdminClient();
  const nowMs = Date.now();
  const results: Record<ReminderKind, { candidates: number; sent: number; skipped: number; failed: number }> = {
    pending_24h: { candidates: 0, sent: 0, skipped: 0, failed: 0 },
  };

  for (const window of REMINDER_WINDOWS) {
    const newerThan = isoHoursAgo(nowMs, window.maxAgeHours);
    const olderThan = isoHoursAgo(nowMs, window.minAgeHours);
    const appsRes = await admin
      .from("dating_card_applications")
      .select("id,card_id,applicant_user_id,applicant_display_nickname,created_at,status")
      .eq("status", "submitted")
      .gte("created_at", newerThan)
      .lt("created_at", olderThan)
      .order("created_at", { ascending: true })
      .limit(1000);

    if (appsRes.error) {
      console.error("[cron dating-application-reminders] applications query failed", {
        kind: window.kind,
        error: appsRes.error,
      });
      return NextResponse.json({ error: appsRes.error.message, kind: window.kind }, { status: 500 });
    }

    const applications = ((appsRes.data ?? []) as ApplicationRow[]).filter((app) => isUuid(app.card_id));
    results[window.kind].candidates = applications.length;
    if (applications.length === 0) continue;

    const cardIds = [...new Set(applications.map((app) => app.card_id))];
    const cardsRes = await admin.from("dating_cards").select("id,owner_user_id").in("id", cardIds);
    if (cardsRes.error) {
      console.error("[cron dating-application-reminders] cards query failed", {
        kind: window.kind,
        error: cardsRes.error,
      });
      return NextResponse.json({ error: cardsRes.error.message, kind: window.kind }, { status: 500 });
    }

    const cardMap = new Map((cardsRes.data ?? []).map((card) => [card.id, card as CardRow]));

    for (const app of applications) {
      const card = cardMap.get(app.card_id);
      if (!card?.owner_user_id || card.owner_user_id === app.applicant_user_id) {
        results[window.kind].skipped += 1;
        continue;
      }

      const existingRes = await admin
        .from("notifications")
        .select("id")
        .eq("user_id", card.owner_user_id)
        .eq("type", "dating_application_received")
        .contains("meta_json", { application_id: app.id, reminder_kind: window.kind })
        .limit(1);

      if (existingRes.error) {
        console.error("[cron dating-application-reminders] dedupe query failed", {
          kind: window.kind,
          applicationId: app.id,
          error: existingRes.error,
        });
        results[window.kind].failed += 1;
        continue;
      }

      if ((existingRes.data ?? []).length > 0) {
        results[window.kind].skipped += 1;
        continue;
      }

      const insertRes = await admin.from("notifications").insert({
        user_id: card.owner_user_id,
        actor_id: app.applicant_user_id,
        type: "dating_application_received",
        post_id: null,
        comment_id: null,
        meta_json: {
          card_id: app.card_id,
          application_id: app.id,
          reminder_kind: window.kind,
        },
      });

      if (insertRes.error) {
        console.error("[cron dating-application-reminders] notification insert failed", {
          kind: window.kind,
          applicationId: app.id,
          error: insertRes.error,
        });
        results[window.kind].failed += 1;
        continue;
      }

      const nickname = safeNickname(app.applicant_display_nickname);
      await sendExpoPushToUser(admin, card.owner_user_id, {
        title: window.title,
        body: `${nickname}님 지원이 아직 대기 중이에요. ${window.body}`,
        data: {
          type: "dating_application_received",
          cardId: app.card_id,
          applicationId: app.id,
          reminderKind: window.kind,
        },
      }).catch((error) => {
        console.error("[cron dating-application-reminders] expo push failed", {
          kind: window.kind,
          applicationId: app.id,
          error,
        });
      });

      results[window.kind].sent += 1;
    }
  }

  return NextResponse.json({ ok: true, results });
}
