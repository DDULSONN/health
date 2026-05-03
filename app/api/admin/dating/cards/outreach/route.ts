import { NextResponse } from "next/server";
import { requireAdminRoute } from "@/lib/admin-route";
import { sendDatingEmailNotification } from "@/lib/dating-swipe";
import { createAdminClient } from "@/lib/supabase/server";

const USER_PAGE_SIZE = 200;
const CARD_BATCH_SIZE = 1000;
const PROFILE_BATCH_SIZE = 500;
const SEND_CONCURRENCY = 8;
const DEFAULT_STALE_DAYS = 30;

type OutreachScope = "no_card" | "expired_stale" | "combined";
type RecipientReason = "no_card" | "expired_stale";

type AuthUserLite = {
  id: string;
  email: string | null;
};

type ProfileLite = {
  user_id: string;
  nickname: string | null;
  role?: string | null;
};

type DatingCardLite = {
  owner_user_id: string | null;
  status: string | null;
  expires_at: string | null;
  updated_at?: string | null;
  created_at: string | null;
};

type OutreachRecipientPreview = {
  user_id: string;
  nickname: string | null;
  email: string | null;
  reason: RecipientReason;
  expired_days: number | null;
};

type OutreachPreviewResponse = {
  scope: OutreachScope;
  stale_days: number;
  recipient_count: number;
  no_card_count: number;
  expired_stale_count: number;
  subject: string;
  body: string;
  sample_recipients: OutreachRecipientPreview[];
};

type AdminClient = ReturnType<typeof createAdminClient>;

function parseScope(value: string | null | undefined): OutreachScope {
  if (value === "no_card" || value === "expired_stale" || value === "combined") return value;
  return "combined";
}

function parseStaleDays(value: string | null | undefined): number {
  const parsed = Number(String(value ?? "").trim());
  if (!Number.isFinite(parsed)) return DEFAULT_STALE_DAYS;
  return Math.min(180, Math.max(7, Math.round(parsed)));
}

function buildDefaultSubject(scope: OutreachScope) {
  if (scope === "no_card") return "[GymTools] 오픈카드 등록하고 연결을 시작해보세요";
  if (scope === "expired_stale") return "[GymTools] 오픈카드를 다시 열어볼까요?";
  return "[GymTools] 오픈카드로 연결을 다시 시작해보세요";
}

function buildDefaultBody(scope: OutreachScope, staleDays: number) {
  const lines = [
    "안녕하세요, GymTools입니다.",
    "",
  ];

  if (scope === "no_card") {
    lines.push("아직 오픈카드를 등록하지 않은 회원분들께 가볍게 안내드립니다.");
  } else if (scope === "expired_stale") {
    lines.push(`오픈카드가 만료된 뒤 ${staleDays}일 이상 지나 다시 시작해보시라고 안내드립니다.`);
  } else {
    lines.push(
      `현재 오픈카드가 없거나, 만료된 지 ${staleDays}일 이상 지난 회원분들께 다시 시작해보시라고 안내드립니다.`
    );
  }

  lines.push(
    "",
    "오픈카드를 등록해두면",
    "- 지원을 받거나 직접 둘러보며 연결을 시작할 수 있고",
    "- 빠른매칭, 1:1 소개팅, 이상형 더보기 같은 기능도 더 자연스럽게 이어볼 수 있습니다.",
    "",
    "등록은 짧게 끝나고, 원할 때 수정하거나 숨길 수도 있습니다.",
    "부담 없이 다시 시작해보세요.",
    "",
    "감사합니다."
  );

  return lines.join("\n");
}

async function fetchAllAuthUsers(admin: AdminClient) {
  const users: AuthUserLite[] = [];
  let page = 1;

  while (true) {
    const res = await admin.auth.admin.listUsers({ page, perPage: USER_PAGE_SIZE });
    const batch = res.data?.users ?? [];
    for (const user of batch) {
      users.push({
        id: String(user.id ?? "").trim(),
        email: String(user.email ?? "").trim() || null,
      });
    }
    if (batch.length < USER_PAGE_SIZE) break;
    page += 1;
  }

  return users.filter((user) => user.id && user.email);
}

async function fetchProfilesByUserIds(admin: AdminClient, userIds: string[]) {
  const profileByUserId = new Map<string, ProfileLite>();

  for (let start = 0; start < userIds.length; start += PROFILE_BATCH_SIZE) {
    const chunk = userIds.slice(start, start + PROFILE_BATCH_SIZE);
    const res = await admin
      .from("profiles")
      .select("user_id,nickname,role")
      .in("user_id", chunk);

    if (res.error) throw res.error;

    for (const row of (res.data ?? []) as ProfileLite[]) {
      const userId = String(row.user_id ?? "").trim();
      if (!userId) continue;
      profileByUserId.set(userId, {
        user_id: userId,
        nickname: row.nickname ?? null,
        role: row.role ?? null,
      });
    }
  }

  return profileByUserId;
}

async function fetchAllDatingCards(admin: AdminClient) {
  const rows: DatingCardLite[] = [];
  let from = 0;

  while (true) {
    const res = await admin
      .from("dating_cards")
      .select("owner_user_id,status,expires_at,updated_at,created_at")
      .order("created_at", { ascending: false })
      .range(from, from + CARD_BATCH_SIZE - 1);

    if (res.error) throw res.error;

    const batch = (res.data ?? []) as DatingCardLite[];
    rows.push(...batch);
    if (batch.length < CARD_BATCH_SIZE) break;
    from += CARD_BATCH_SIZE;
  }

  return rows;
}

function getRowSortTime(row: DatingCardLite) {
  const source = row.updated_at ?? row.created_at ?? row.expires_at ?? "";
  const time = new Date(source).getTime();
  return Number.isFinite(time) ? time : 0;
}

function buildRecipients(input: {
  users: AuthUserLite[];
  profileByUserId: Map<string, ProfileLite>;
  cards: DatingCardLite[];
  scope: OutreachScope;
  staleDays: number;
}) {
  const { users, profileByUserId, cards, scope, staleDays } = input;
  const now = Date.now();
  const staleCutoffMs = now - staleDays * 24 * 60 * 60 * 1000;
  const cardsByUserId = new Map<string, DatingCardLite[]>();

  for (const row of cards) {
    const userId = String(row.owner_user_id ?? "").trim();
    if (!userId) continue;
    const bucket = cardsByUserId.get(userId) ?? [];
    bucket.push(row);
    cardsByUserId.set(userId, bucket);
  }

  const recipients: OutreachRecipientPreview[] = [];
  let noCardCount = 0;
  let expiredStaleCount = 0;

  for (const user of users) {
    const profile = profileByUserId.get(user.id);
    if (profile?.role === "admin") continue;

    const userCards = cardsByUserId.get(user.id) ?? [];
    if (userCards.length === 0) {
      if (scope === "no_card" || scope === "combined") {
        noCardCount += 1;
        recipients.push({
          user_id: user.id,
          nickname: profile?.nickname ?? null,
          email: user.email,
          reason: "no_card",
          expired_days: null,
        });
      }
      continue;
    }

    const hasActiveLikeCard = userCards.some((row) => {
      const status = String(row.status ?? "").trim();
      return status === "pending" || status === "public" || status === "hidden";
    });
    if (hasActiveLikeCard) continue;

    const latestRow = [...userCards].sort((a, b) => getRowSortTime(b) - getRowSortTime(a))[0];
    const latestStatus = String(latestRow?.status ?? "").trim();
    const expiresMs = new Date(String(latestRow?.expires_at ?? "")).getTime();
    if (latestStatus !== "expired" || !Number.isFinite(expiresMs) || expiresMs > staleCutoffMs) continue;

    if (scope === "expired_stale" || scope === "combined") {
      const expiredDays = Math.max(1, Math.floor((now - expiresMs) / (24 * 60 * 60 * 1000)));
      expiredStaleCount += 1;
      recipients.push({
        user_id: user.id,
        nickname: profile?.nickname ?? null,
        email: user.email,
        reason: "expired_stale",
        expired_days: expiredDays,
      });
    }
  }

  recipients.sort((a, b) => {
    if (a.reason !== b.reason) return a.reason === "expired_stale" ? -1 : 1;
    if ((b.expired_days ?? 0) !== (a.expired_days ?? 0)) return (b.expired_days ?? 0) - (a.expired_days ?? 0);
    return (a.nickname ?? a.email ?? "").localeCompare(b.nickname ?? b.email ?? "", "ko");
  });

  return {
    recipients,
    noCardCount,
    expiredStaleCount,
  };
}

async function buildPreview(
  admin: AdminClient,
  scope: OutreachScope,
  staleDays: number
): Promise<OutreachPreviewResponse> {
  const users = await fetchAllAuthUsers(admin);
  const [profileByUserId, cards] = await Promise.all([
    fetchProfilesByUserIds(admin, users.map((user) => user.id)),
    fetchAllDatingCards(admin),
  ]);
  const { recipients, noCardCount, expiredStaleCount } = buildRecipients({
    users,
    profileByUserId,
    cards,
    scope,
    staleDays,
  });

  return {
    scope,
    stale_days: staleDays,
    recipient_count: recipients.length,
    no_card_count: noCardCount,
    expired_stale_count: expiredStaleCount,
    subject: buildDefaultSubject(scope),
    body: buildDefaultBody(scope, staleDays),
    sample_recipients: recipients.slice(0, 20),
  };
}

async function sendInBatches(
  admin: AdminClient,
  recipients: OutreachRecipientPreview[],
  subject: string,
  body: string
) {
  let sent = 0;
  let failed = 0;

  for (let start = 0; start < recipients.length; start += SEND_CONCURRENCY) {
    const batch = recipients.slice(start, start + SEND_CONCURRENCY);
    const results = await Promise.all(
      batch.map((item) => sendDatingEmailNotification(admin, item.user_id, subject, body).catch(() => false))
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
    const params = new URL(request.url).searchParams;
    const scope = parseScope(params.get("scope"));
    const staleDays = parseStaleDays(params.get("staleDays"));
    const preview = await buildPreview(auth.admin, scope, staleDays);
    return NextResponse.json(preview);
  } catch (error) {
    console.error("[GET /api/admin/dating/cards/outreach] failed", error);
    return NextResponse.json({ error: "오픈카드 안내 메일 미리보기를 불러오지 못했습니다." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;

  try {
    let payload: { scope?: OutreachScope; staleDays?: number; subject?: string; body?: string } | null = null;
    try {
      payload = (await request.json()) as { scope?: OutreachScope; staleDays?: number; subject?: string; body?: string };
    } catch {
      payload = null;
    }

    const scope = parseScope(payload?.scope);
    const staleDays = parseStaleDays(String(payload?.staleDays ?? ""));
    const subject = String(payload?.subject ?? "").trim();
    const body = String(payload?.body ?? "").trim();

    if (!subject) {
      return NextResponse.json({ error: "메일 제목을 입력해주세요." }, { status: 400 });
    }
    if (!body) {
      return NextResponse.json({ error: "메일 본문을 입력해주세요." }, { status: 400 });
    }

    const users = await fetchAllAuthUsers(auth.admin);
    const [profileByUserId, cards] = await Promise.all([
      fetchProfilesByUserIds(auth.admin, users.map((user) => user.id)),
      fetchAllDatingCards(auth.admin),
    ]);
    const { recipients } = buildRecipients({
      users,
      profileByUserId,
      cards,
      scope,
      staleDays,
    });

    const { sent, failed } = await sendInBatches(auth.admin, recipients, subject, body);

    return NextResponse.json({
      ok: true,
      scope,
      stale_days: staleDays,
      requested: recipients.length,
      sent,
      failed,
    });
  } catch (error) {
    console.error("[POST /api/admin/dating/cards/outreach] failed", error);
    return NextResponse.json({ error: "오픈카드 안내 메일 발송에 실패했습니다." }, { status: 500 });
  }
}
