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
type PhoneVerifiedFilter = "all" | "verified" | "unverified";
type SortMode = "priority" | "expired_oldest" | "recent_login" | "nickname";

type AuthUserLite = {
  id: string;
  email: string | null;
  last_sign_in_at: string | null;
};

type ProfileLite = {
  user_id: string;
  nickname: string | null;
  role?: string | null;
  phone_verified?: boolean | null;
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
  phone_verified: boolean;
  last_sign_in_at: string | null;
};

type OutreachPreviewResponse = {
  scope: OutreachScope;
  stale_days: number;
  phone_verified_filter: PhoneVerifiedFilter;
  recent_login_days: number | null;
  sort: SortMode;
  recipient_count: number;
  no_card_count: number;
  expired_stale_count: number;
  subject: string;
  body: string;
  sample_recipients: OutreachRecipientPreview[];
};

type OutreachPostPayload = {
  scope?: OutreachScope;
  staleDays?: number | string | null;
  phoneVerified?: PhoneVerifiedFilter;
  recentLoginDays?: number | string | null;
  sort?: SortMode;
  subject?: string;
  body?: string;
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

function parsePhoneVerifiedFilter(value: string | null | undefined): PhoneVerifiedFilter {
  if (value === "verified" || value === "unverified" || value === "all") return value;
  return "all";
}

function parseRecentLoginDays(value: string | null | undefined): number | null {
  const raw = String(value ?? "").trim();
  if (!raw || raw === "all" || raw === "0") return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return null;
  return Math.min(180, Math.max(1, Math.round(parsed)));
}

function parseSort(value: string | null | undefined): SortMode {
  if (value === "expired_oldest" || value === "recent_login" || value === "nickname" || value === "priority") {
    return value;
  }
  return "priority";
}

function buildDefaultSubject(scope: OutreachScope) {
  if (scope === "no_card") return "[GymTools] 오픈카드 등록하고 연결을 시작해보세요";
  if (scope === "expired_stale") return "[GymTools] 오픈카드를 다시 열어볼까요?";
  return "[GymTools] 오픈카드로 연결을 다시 시작해보세요";
}

function buildDefaultBody(scope: OutreachScope, staleDays: number) {
  const lines = ["안녕하세요, GymTools입니다.", ""];

  if (scope === "no_card") {
    lines.push("아직 오픈카드를 등록하지 않으신 회원님께 안내드려요.");
  } else if (scope === "expired_stale") {
    lines.push(`오픈카드가 만료된 지 ${staleDays}일 이상 지나 다시 시작해보시라고 안내드려요.`);
  } else {
    lines.push(
      `현재 오픈카드가 없거나 마지막 카드가 만료된 지 ${staleDays}일 이상 지난 회원님께 다시 시작해보시라고 안내드려요.`
    );
  }

  lines.push(
    "",
    "오픈카드를 등록해두면",
    "- 내 카드를 보고 먼저 지원이 들어올 수 있고",
    "- 직접 빠른매칭, 1:1 소개팅, 이상형 더보기로 연결을 이어갈 수 있어요.",
    "",
    "등록은 가볍게 시작하고, 필요할 때 수정하거나 다시 숨길 수도 있습니다.",
    "부담 없이 다시 시작해보세요.",
    "",
    "감사합니다."
  );

  return lines.join("\n");
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error && typeof error === "object") {
    const maybeMessage = "message" in error ? String(error.message ?? "").trim() : "";
    if (maybeMessage) return maybeMessage;
  }
  return fallback;
}

async function fetchAllAuthUsers(admin: AdminClient) {
  const users: AuthUserLite[] = [];
  let page = 1;

  while (true) {
    const res = await admin.auth.admin.listUsers({ page, perPage: USER_PAGE_SIZE });
    if (res.error) {
      throw new Error(`회원 목록을 불러오지 못했습니다: ${res.error.message}`);
    }

    const batch = res.data?.users ?? [];
    for (const user of batch) {
      const id = String(user.id ?? "").trim();
      const email = String(user.email ?? "").trim() || null;
      if (!id || !email) continue;

      users.push({
        id,
        email,
        last_sign_in_at: user.last_sign_in_at ?? null,
      });
    }

    if (batch.length < USER_PAGE_SIZE) break;
    page += 1;
  }

  return users;
}

async function fetchProfilesByUserIds(admin: AdminClient, userIds: string[]) {
  const profileByUserId = new Map<string, ProfileLite>();
  if (!userIds.length) return profileByUserId;

  for (let start = 0; start < userIds.length; start += PROFILE_BATCH_SIZE) {
    const chunk = userIds.slice(start, start + PROFILE_BATCH_SIZE);
    const res = await admin
      .from("profiles")
      .select("user_id,nickname,role,phone_verified")
      .in("user_id", chunk);

    if (res.error) {
      throw new Error(`프로필 정보를 불러오지 못했습니다: ${res.error.message}`);
    }

    for (const row of (res.data ?? []) as ProfileLite[]) {
      const userId = String(row.user_id ?? "").trim();
      if (!userId) continue;
      profileByUserId.set(userId, {
        user_id: userId,
        nickname: row.nickname ?? null,
        role: row.role ?? null,
        phone_verified: row.phone_verified ?? false,
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

    if (res.error) {
      throw new Error(`오픈카드 목록을 불러오지 못했습니다: ${res.error.message}`);
    }

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

function isRecentLogin(lastSignInAt: string | null, recentLoginDays: number | null) {
  if (recentLoginDays == null) return true;
  if (!lastSignInAt) return false;
  const time = new Date(lastSignInAt).getTime();
  if (!Number.isFinite(time)) return false;
  return Date.now() - time <= recentLoginDays * 24 * 60 * 60 * 1000;
}

function matchesPhoneFilter(phoneVerified: boolean, filter: PhoneVerifiedFilter) {
  if (filter === "all") return true;
  return filter === "verified" ? phoneVerified : !phoneVerified;
}

function sortRecipients(recipients: OutreachRecipientPreview[], sort: SortMode) {
  recipients.sort((a, b) => {
    if (sort === "expired_oldest") {
      if ((b.expired_days ?? 0) !== (a.expired_days ?? 0)) return (b.expired_days ?? 0) - (a.expired_days ?? 0);
    }

    if (sort === "recent_login") {
      const aTime = new Date(a.last_sign_in_at ?? "").getTime();
      const bTime = new Date(b.last_sign_in_at ?? "").getTime();
      return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
    }

    if (sort === "nickname") {
      return (a.nickname ?? a.email ?? "").localeCompare(b.nickname ?? b.email ?? "", "ko");
    }

    if (a.reason !== b.reason) return a.reason === "expired_stale" ? -1 : 1;
    if ((b.expired_days ?? 0) !== (a.expired_days ?? 0)) return (b.expired_days ?? 0) - (a.expired_days ?? 0);

    const aTime = new Date(a.last_sign_in_at ?? "").getTime();
    const bTime = new Date(b.last_sign_in_at ?? "").getTime();
    if ((Number.isFinite(bTime) ? bTime : 0) !== (Number.isFinite(aTime) ? aTime : 0)) {
      return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
    }

    return (a.nickname ?? a.email ?? "").localeCompare(b.nickname ?? b.email ?? "", "ko");
  });
}

function buildRecipients(input: {
  users: AuthUserLite[];
  profileByUserId: Map<string, ProfileLite>;
  cards: DatingCardLite[];
  scope: OutreachScope;
  staleDays: number;
  phoneVerifiedFilter: PhoneVerifiedFilter;
  recentLoginDays: number | null;
  sort: SortMode;
}) {
  const { users, profileByUserId, cards, scope, staleDays, phoneVerifiedFilter, recentLoginDays, sort } = input;
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

    const phoneVerified = profile?.phone_verified === true;
    if (!matchesPhoneFilter(phoneVerified, phoneVerifiedFilter)) continue;
    if (!isRecentLogin(user.last_sign_in_at, recentLoginDays)) continue;

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
          phone_verified: phoneVerified,
          last_sign_in_at: user.last_sign_in_at,
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
        phone_verified: phoneVerified,
        last_sign_in_at: user.last_sign_in_at,
      });
    }
  }

  sortRecipients(recipients, sort);

  return { recipients, noCardCount, expiredStaleCount };
}

async function buildPreview(
  admin: AdminClient,
  scope: OutreachScope,
  staleDays: number,
  phoneVerifiedFilter: PhoneVerifiedFilter,
  recentLoginDays: number | null,
  sort: SortMode
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
    phoneVerifiedFilter,
    recentLoginDays,
    sort,
  });

  return {
    scope,
    stale_days: staleDays,
    phone_verified_filter: phoneVerifiedFilter,
    recent_login_days: recentLoginDays,
    sort,
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
    const phoneVerifiedFilter = parsePhoneVerifiedFilter(params.get("phoneVerified"));
    const recentLoginDays = parseRecentLoginDays(params.get("recentLoginDays"));
    const sort = parseSort(params.get("sort"));

    const preview = await buildPreview(
      auth.admin,
      scope,
      staleDays,
      phoneVerifiedFilter,
      recentLoginDays,
      sort
    );

    return NextResponse.json(preview);
  } catch (error) {
    console.error("[GET /api/admin/dating/cards/outreach] failed", error);
    return NextResponse.json(
      { error: getErrorMessage(error, "오픈카드 안내 메일 미리보기를 불러오지 못했습니다.") },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;

  try {
    let payload: OutreachPostPayload | null = null;

    try {
      payload = (await request.json()) as OutreachPostPayload;
    } catch {
      payload = null;
    }

    const scope = parseScope(payload?.scope);
    const staleDays = parseStaleDays(String(payload?.staleDays ?? ""));
    const phoneVerifiedFilter = parsePhoneVerifiedFilter(payload?.phoneVerified);
    const recentLoginDays = parseRecentLoginDays(String(payload?.recentLoginDays ?? ""));
    const sort = parseSort(payload?.sort);
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
      phoneVerifiedFilter,
      recentLoginDays,
      sort,
    });

    const { sent, failed } = await sendInBatches(auth.admin, recipients, subject, body);

    return NextResponse.json({
      ok: true,
      scope,
      stale_days: staleDays,
      phone_verified_filter: phoneVerifiedFilter,
      recent_login_days: recentLoginDays,
      sort,
      requested: recipients.length,
      sent,
      failed,
    });
  } catch (error) {
    console.error("[POST /api/admin/dating/cards/outreach] failed", error);
    return NextResponse.json(
      { error: getErrorMessage(error, "오픈카드 안내 메일 발송에 실패했습니다.") },
      { status: 500 }
    );
  }
}
