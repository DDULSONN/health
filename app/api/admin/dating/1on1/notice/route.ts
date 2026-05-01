import { NextResponse } from "next/server";
import {
  DATING_ONE_ON_ONE_ACTIVE_STATUSES,
  isDatingOneOnOneLegacyPhoneShareMatch,
  type DatingOneOnOneMatchRow,
} from "@/lib/dating-1on1";
import { sendDatingEmailNotification } from "@/lib/dating-swipe";
import { DEFAULT_OPENKAKAO_URL } from "@/lib/ad-inquiry";
import { requireAdminRoute } from "@/lib/admin-route";
import { createAdminClient } from "@/lib/supabase/server";

const APPLICANT_BATCH_SIZE = 1000;
const MATCH_BATCH_SIZE = 1000;
const SEND_CONCURRENCY = 8;

type NoticeScope = "all_applicants" | "mutual_only" | "legacy_mutual" | "new_mutual";

type NoticePreviewResponse = {
  scope: NoticeScope;
  recipient_count: number;
  legacy_mutual_user_count: number;
  new_mutual_user_count: number;
  subject: string;
  body: string;
  preview_lines: string[];
};

const DEFAULT_NOTICE_SCOPE: NoticeScope = "mutual_only";

function getDefaultNoticeSubject() {
  return "[GymTools] 1:1 소개팅 진행 방식 안내";
}

function buildDefaultNoticeBody() {
  const openKakaoUrl = process.env.NEXT_PUBLIC_OPENKAKAO_URL?.trim() || DEFAULT_OPENKAKAO_URL;

  return [
    "안녕하세요. GymTools 1:1 소개팅 이용 안내입니다.",
    "",
    "1:1 소개팅 번호 교환 진행 방식이 아래처럼 정리되었습니다.",
    "",
    "1. 새로 쌍방 수락된 매칭",
    "- 서로 수락되면 마이페이지에서 번호 교환 요청을 진행할 수 있습니다.",
    "- 요청 후 안내에 따라 확인이 완료되면 번호 교환이 진행됩니다.",
    "",
    "2. 기존에 이미 쌍방 수락된 매칭",
    "- 현재도 마이페이지에서 번호 교환 요청을 진행할 수 있습니다.",
    "- 요청 후 안내에 따라 확인이 완료되면 번호 교환이 진행됩니다.",
    "",
    "현재 진행 상태는 마이페이지 > 1:1 소개팅 내역에서 확인하실 수 있습니다.",
    `문의가 필요하시면 오픈카톡으로 닉네임과 내용을 보내주세요. ${openKakaoUrl}`,
    "",
    "감사합니다.",
  ].join("\n");
}

async function fetchApplicantUserIds(admin: ReturnType<typeof createAdminClient>) {
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

async function fetchMutualAcceptedMatches(admin: ReturnType<typeof createAdminClient>) {
  const rows: DatingOneOnOneMatchRow[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await admin
      .from("dating_1on1_match_proposals")
      .select(
        "id,source_card_id,source_user_id,candidate_card_id,candidate_user_id,state,contact_exchange_status,contact_exchange_requested_at,contact_exchange_paid_at,contact_exchange_paid_by_user_id,contact_exchange_approved_at,contact_exchange_approved_by_user_id,contact_exchange_note,source_phone_share_consented_at,candidate_phone_share_consented_at,admin_sent_by_user_id,source_selected_at,candidate_responded_at,source_final_responded_at,created_at,updated_at"
      )
      .eq("state", "mutual_accepted")
      .order("created_at", { ascending: false })
      .range(from, from + MATCH_BATCH_SIZE - 1);

    if (error) throw error;

    const batch = (data ?? []) as DatingOneOnOneMatchRow[];
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

async function buildNoticePreview(
  admin: ReturnType<typeof createAdminClient>,
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
  const body = buildDefaultNoticeBody();

  return {
    scope,
    recipient_count: scopedUserIds.length,
    legacy_mutual_user_count: legacyUsers.size,
    new_mutual_user_count: newUsers.size,
    subject: getDefaultNoticeSubject(),
    body,
    preview_lines: body.split("\n"),
  };
}

async function sendInBatches(
  userIds: string[],
  admin: ReturnType<typeof createAdminClient>,
  subject: string,
  text: string
) {
  let sent = 0;
  let failed = 0;

  for (let start = 0; start < userIds.length; start += SEND_CONCURRENCY) {
    const batch = userIds.slice(start, start + SEND_CONCURRENCY);
    const results = await Promise.all(
      batch.map((userId) => sendDatingEmailNotification(admin, userId, subject, text).catch(() => false))
    );

    for (const ok of results) {
      if (ok) sent += 1;
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
    const subject = String(body?.subject ?? "").trim();
    const text = String(body?.body ?? "").trim();

    if (!subject) {
      return NextResponse.json({ error: "메일 제목을 입력해주세요." }, { status: 400 });
    }
    if (!text) {
      return NextResponse.json({ error: "메일 본문을 입력해주세요." }, { status: 400 });
    }

    const [applicantUserIds, matches] = await Promise.all([
      fetchApplicantUserIds(auth.admin),
      fetchMutualAcceptedMatches(auth.admin),
    ]);
    const userIds = getScopedRecipientUserIds(requestScope, applicantUserIds, matches);
    const { sent, failed } = await sendInBatches(userIds, auth.admin, subject, text);

    return NextResponse.json({
      ok: true,
      scope: requestScope,
      requested: userIds.length,
      sent,
      failed,
    });
  } catch (error) {
    console.error("[POST /api/admin/dating/1on1/notice] failed", error);
    return NextResponse.json({ error: "안내 메일 발송에 실패했습니다." }, { status: 500 });
  }
}
