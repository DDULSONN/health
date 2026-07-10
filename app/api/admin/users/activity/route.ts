import { NextResponse } from "next/server";
import { hashEmail } from "@/lib/account-deletion";
import { requireAdminRoute } from "@/lib/admin-route";
import { createAdminClient } from "@/lib/supabase/server";

type AdminClient = ReturnType<typeof createAdminClient>;
type ActivityItem = {
  id: string;
  kind: string;
  label: string;
  at: string | null;
  meta?: Record<string, unknown>;
};

function json(status: number, payload: Record<string, unknown>) {
  return NextResponse.json(payload, { status });
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function normalizePhone(value: string): string {
  return value.replace(/[^\d+]/g, "");
}

function toDigits(value: string): string {
  return value.replace(/\D/g, "");
}

function maskPhoneNumber(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const digits = toDigits(value);
  if (digits.length < 7) return value;
  return `${digits.slice(0, 3)}****${digits.slice(-4)}`;
}

function maskSensitivePhoneFields<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => maskSensitivePhoneFields(item)) as T;
  }
  if (!value || typeof value !== "object") return value;

  const sensitiveKeys = new Set(["phone", "phone_e164", "contact_phone", "counterparty_phone"]);
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    output[key] = sensitiveKeys.has(key) ? maskPhoneNumber(item) : maskSensitivePhoneFields(item);
  }
  return output as T;
}

function safeSearchTerm(value: string): string {
  return value.trim().replace(/[,%]/g, " ");
}

function escapeIlikeTerm(value: string): string {
  return safeSearchTerm(value).replace(/\\/g, "\\\\").replace(/_/g, "\\_");
}

function ilikePattern(value: string): string {
  return `%${escapeIlikeTerm(value)}%`;
}

function isMissingSchemaError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = String((error as { code?: unknown }).code ?? "");
  const message = String((error as { message?: unknown }).message ?? "").toLowerCase();
  return code === "42P01" || code === "42703" || code === "PGRST204" || code === "PGRST205" || message.includes("does not exist");
}

async function countSafe(query: PromiseLike<{ count: number | null; error: unknown }>) {
  const res = await query;
  if (res.error) {
    if (isMissingSchemaError(res.error)) return 0;
    throw res.error;
  }
  return res.count ?? 0;
}

async function listSafe<T>(query: PromiseLike<{ data: T[] | null; error: unknown }>) {
  const res = await query;
  if (res.error) {
    if (isMissingSchemaError(res.error)) return [] as T[];
    throw res.error;
  }
  return res.data ?? [];
}

async function findAuthUserByEmail(admin: AdminClient, email: string) {
  const normalized = email.trim().toLowerCase();
  if (!normalized.includes("@")) return null;

  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const found = data.users.find((user) => (user.email ?? "").toLowerCase() === normalized);
    if (found) return found;
    if (data.users.length < 1000) break;
  }
  return null;
}

async function findAuthUserByPhone(admin: AdminClient, phone: string) {
  const digits = toDigits(phone);
  if (digits.length < 8) return null;

  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const found = data.users.find((user) => toDigits(user.phone ?? "").endsWith(digits.slice(-8)));
    if (found) return found;
    if (data.users.length < 1000) break;
  }
  return null;
}

async function fetchProfile(admin: AdminClient, userId: string) {
  const res = await admin
    .from("profiles")
    .select("user_id,nickname,role,phone_verified,phone_e164,phone_verified_at,swipe_profile_visible,is_banned,banned_reason,banned_at,created_at")
    .eq("user_id", userId)
    .maybeSingle();
  return res.data ?? null;
}

type UserCandidate = {
  userId: string;
  profile?: Record<string, unknown> | null;
  source: string;
  label?: string | null;
  priority: number;
};

function pushCandidate(
  candidates: UserCandidate[],
  seen: Set<string>,
  candidate: UserCandidate | null | undefined
) {
  if (!candidate?.userId || seen.has(candidate.userId)) return;
  seen.add(candidate.userId);
  candidates.push(candidate);
}

function isExactTextMatch(left: unknown, right: string): boolean {
  return typeof left === "string" && left.trim().toLowerCase() === right.trim().toLowerCase();
}

async function findUserCandidatesByNickname(admin: AdminClient, query: string) {
  const candidates: UserCandidate[] = [];
  const seen = new Set<string>();
  const pattern = ilikePattern(query);

  const profileRows = await listSafe<Record<string, unknown>>(
    admin
      .from("profiles")
      .select("user_id,nickname,role,phone_verified,phone_e164,phone_verified_at,swipe_profile_visible,is_banned,banned_reason,banned_at,created_at")
      .ilike("nickname", pattern)
      .limit(10)
  );

  for (const row of profileRows) {
    const exact = isExactTextMatch(row.nickname, query);
    pushCandidate(candidates, seen, {
      userId: String(row.user_id),
      profile: row,
      source: "profile_nickname",
      label: typeof row.nickname === "string" ? row.nickname : null,
      priority: exact ? 0 : 10,
    });
  }

  const openCards = await listSafe<Record<string, unknown>>(
    admin
      .from("dating_cards")
      .select("owner_user_id,display_nickname,created_at")
      .ilike("display_nickname", pattern)
      .order("created_at", { ascending: false })
      .limit(10)
  );
  for (const row of openCards) {
    const exact = isExactTextMatch(row.display_nickname, query);
    pushCandidate(candidates, seen, {
      userId: String(row.owner_user_id),
      source: "open_card_display_nickname",
      label: typeof row.display_nickname === "string" ? row.display_nickname : null,
      priority: exact ? 1 : 20,
    });
  }

  const openApplications = await listSafe<Record<string, unknown>>(
    admin
      .from("dating_card_applications")
      .select("applicant_user_id,applicant_display_nickname,created_at")
      .ilike("applicant_display_nickname", pattern)
      .order("created_at", { ascending: false })
      .limit(10)
  );
  for (const row of openApplications) {
    const exact = isExactTextMatch(row.applicant_display_nickname, query);
    pushCandidate(candidates, seen, {
      userId: String(row.applicant_user_id),
      source: "open_card_application_nickname",
      label: typeof row.applicant_display_nickname === "string" ? row.applicant_display_nickname : null,
      priority: exact ? 2 : 30,
    });
  }

  const paidCards = await listSafe<Record<string, unknown>>(
    admin
      .from("dating_paid_cards")
      .select("user_id,nickname,created_at")
      .ilike("nickname", pattern)
      .order("created_at", { ascending: false })
      .limit(10)
  );
  for (const row of paidCards) {
    const exact = isExactTextMatch(row.nickname, query);
    pushCandidate(candidates, seen, {
      userId: String(row.user_id),
      source: "paid_card_nickname",
      label: typeof row.nickname === "string" ? row.nickname : null,
      priority: exact ? 3 : 40,
    });
  }

  const paidApplications = await listSafe<Record<string, unknown>>(
    admin
      .from("dating_paid_card_applications")
      .select("applicant_user_id,applicant_display_nickname,created_at")
      .ilike("applicant_display_nickname", pattern)
      .order("created_at", { ascending: false })
      .limit(10)
  );
  for (const row of paidApplications) {
    const exact = isExactTextMatch(row.applicant_display_nickname, query);
    pushCandidate(candidates, seen, {
      userId: String(row.applicant_user_id),
      source: "paid_card_application_nickname",
      label: typeof row.applicant_display_nickname === "string" ? row.applicant_display_nickname : null,
      priority: exact ? 4 : 50,
    });
  }

  const oneOnOneCards = await listSafe<Record<string, unknown>>(
    admin
      .from("dating_1on1_cards")
      .select("user_id,name,created_at")
      .ilike("name", pattern)
      .order("created_at", { ascending: false })
      .limit(10)
  );
  for (const row of oneOnOneCards) {
    const exact = isExactTextMatch(row.name, query);
    pushCandidate(candidates, seen, {
      userId: String(row.user_id),
      source: "one_on_one_name",
      label: typeof row.name === "string" ? row.name : null,
      priority: exact ? 5 : 60,
    });
  }

  candidates.sort((a, b) => a.priority - b.priority);
  return candidates;
}

async function findUserCandidateByProfilePhone(admin: AdminClient, phone: string) {
  const normalizedPhone = normalizePhone(phone);
  if (toDigits(normalizedPhone).length < 8) return null;

  const rows = await listSafe<Record<string, unknown>>(
    admin
      .from("profiles")
      .select("user_id,nickname,role,phone_verified,phone_e164,phone_verified_at,swipe_profile_visible,is_banned,banned_reason,banned_at,created_at")
      .ilike("phone_e164", ilikePattern(normalizedPhone))
      .limit(1)
  );
  const profile = rows[0] ?? null;
  if (!profile) return null;
  return {
    userId: String(profile.user_id),
    profile,
  };
}

async function resolveUser(admin: AdminClient, query: string) {
  if (isUuid(query)) {
    const [{ data: userData }, profile] = await Promise.all([
      admin.auth.admin.getUserById(query).catch(() => ({ data: { user: null } })),
      fetchProfile(admin, query),
    ]);
    return {
      userId: query,
      authUser: userData.user,
      profile,
    };
  }

  const isEmailQuery = query.includes("@");
  const isPhoneQuery = toDigits(query).length >= 8;
  const [nicknameCandidates, profilePhoneCandidate, emailUser, phoneUser] = await Promise.all([
    isEmailQuery || isPhoneQuery ? Promise.resolve([]) : findUserCandidatesByNickname(admin, query),
    isPhoneQuery ? findUserCandidateByProfilePhone(admin, query) : Promise.resolve(null),
    isEmailQuery ? findAuthUserByEmail(admin, query) : Promise.resolve(null),
    isPhoneQuery ? findAuthUserByPhone(admin, query) : Promise.resolve(null),
  ]);

  const authUser = emailUser ?? phoneUser;
  if (authUser) {
    return { userId: authUser.id, authUser, profile: await fetchProfile(admin, authUser.id) };
  }

  const resolvedCandidate = profilePhoneCandidate ?? nicknameCandidates[0] ?? null;
  if (!resolvedCandidate) return null;

  const profile = resolvedCandidate.profile ?? (await fetchProfile(admin, resolvedCandidate.userId));
  const { data } = await admin.auth.admin.getUserById(String(resolvedCandidate.userId)).catch(() => ({ data: { user: null } }));
  return { userId: String(resolvedCandidate.userId), authUser: data.user, profile };
}

async function findDeletedAudit(admin: AdminClient, query: string) {
  const emailHash = query.includes("@") ? hashEmail(query) : null;
  let base = admin
    .from("account_deletion_audits")
    .select("id,auth_user_id,nickname,email_masked,deletion_mode,initiated_by_role,deleted_at,retention_until")
    .gte("retention_until", new Date().toISOString())
    .order("deleted_at", { ascending: false })
    .limit(10);

  if (isUuid(query)) {
    base = base.eq("auth_user_id", query);
  } else if (emailHash) {
    base = base.eq("email_hash", emailHash);
  } else {
    base = base.ilike("nickname", `%${safeSearchTerm(query)}%`);
  }

  return listSafe<Record<string, unknown>>(base);
}

function addRows(
  target: ActivityItem[],
  kind: string,
  label: string,
  rows: Array<Record<string, unknown>>,
  atKey = "created_at"
) {
  for (const row of rows) {
    target.push({
      id: String(row.id ?? `${kind}:${target.length}`),
      kind,
      label,
      at: typeof row[atKey] === "string" ? String(row[atKey]) : null,
      meta: row,
    });
  }
}

async function addOpenCardQueuePositions(
  admin: AdminClient,
  cards: Array<Record<string, unknown>>
): Promise<Array<Record<string, unknown>>> {
  const pending = cards.filter((card) => card.status === "pending" && (card.sex === "male" || card.sex === "female"));
  if (pending.length === 0) return cards;

  const sexes = [...new Set(pending.map((card) => String(card.sex)))];
  const positionMap = new Map<string, number>();

  for (const sex of sexes) {
    let rows = await listSafe<Record<string, unknown>>(
      admin
        .from("dating_cards")
        .select("id,queue_priority_at,created_at")
        .eq("sex", sex)
        .eq("status", "pending")
        .order("queue_priority_at", { ascending: true })
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .limit(2000)
    );

    if (rows.length === 0) {
      rows = await listSafe<Record<string, unknown>>(
        admin
          .from("dating_cards")
          .select("id,created_at")
          .eq("sex", sex)
          .eq("status", "pending")
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .limit(2000)
      );
    }

    rows.forEach((row, index) => positionMap.set(String(row.id), index + 1));
  }

  return cards.map((card) => ({
    ...card,
    queue_position: positionMap.get(String(card.id)) ?? null,
  }));
}

function compactOneOnOneCard(row: Record<string, unknown> | undefined) {
  if (!row) return null;
  const birthYear = Number(row.birth_year ?? 0);
  const age = birthYear > 0 ? new Date().getFullYear() - birthYear + 1 : null;
  return {
    id: row.id ?? null,
    user_id: row.user_id ?? null,
    name: row.name ?? null,
    sex: row.sex ?? null,
    age,
    birth_year: row.birth_year ?? null,
    height_cm: row.height_cm ?? null,
    job: row.job ?? null,
    region: row.region ?? null,
    phone: row.phone ?? null,
    intro_text: row.intro_text ?? null,
    strengths_text: row.strengths_text ?? null,
    preferred_partner_text: row.preferred_partner_text ?? null,
    smoking: row.smoking ?? null,
    workout_frequency: row.workout_frequency ?? null,
    status: row.status ?? null,
    admin_note: row.admin_note ?? null,
    admin_tags: row.admin_tags ?? null,
    priority_boost_expires_at: row.priority_boost_expires_at ?? null,
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,
    reviewed_at: row.reviewed_at ?? null,
  };
}

function compactProfile(row: Record<string, unknown> | undefined) {
  if (!row) return null;
  return {
    user_id: row.user_id ?? null,
    nickname: row.nickname ?? null,
    role: row.role ?? null,
    phone_verified: row.phone_verified ?? null,
    phone_e164: row.phone_e164 ?? null,
    phone_verified_at: row.phone_verified_at ?? null,
    is_banned: row.is_banned ?? null,
  };
}

async function enrichOneOnOneMatches(
  admin: AdminClient,
  userId: string,
  matches: Array<Record<string, unknown>>
) {
  if (matches.length === 0) return [];

  const cardIds = [
    ...new Set(
      matches
        .flatMap((match) => [match.source_card_id, match.candidate_card_id])
        .map((id) => String(id ?? ""))
        .filter(Boolean)
    ),
  ];
  const userIds = [
    ...new Set(
      matches
        .flatMap((match) => [match.source_user_id, match.candidate_user_id])
        .map((id) => String(id ?? ""))
        .filter(Boolean)
    ),
  ];

  const [cards, profiles] = await Promise.all([
    cardIds.length
      ? listSafe<Record<string, unknown>>(
          admin
            .from("dating_1on1_cards")
            .select(
              "id,user_id,sex,name,birth_year,height_cm,job,region,phone,intro_text,strengths_text,preferred_partner_text,smoking,workout_frequency,status,admin_note,admin_tags,priority_boost_expires_at,created_at,updated_at,reviewed_at"
            )
            .in("id", cardIds)
        )
      : Promise.resolve([]),
    userIds.length
      ? listSafe<Record<string, unknown>>(
          admin
            .from("profiles")
            .select("user_id,nickname,role,phone_verified,phone_e164,phone_verified_at,is_banned")
            .in("user_id", userIds)
        )
      : Promise.resolve([]),
  ]);

  const cardById = new Map(cards.map((card) => [String(card.id), card]));
  const profileByUserId = new Map(profiles.map((profile) => [String(profile.user_id), profile]));

  return matches.map((match) => {
    const sourceUserId = String(match.source_user_id ?? "");
    const candidateUserId = String(match.candidate_user_id ?? "");
    const role = sourceUserId === userId ? "source" : candidateUserId === userId ? "candidate" : "unknown";
    const counterpartUserId = role === "source" ? candidateUserId : sourceUserId;
    const ownCardId = role === "source" ? String(match.source_card_id ?? "") : String(match.candidate_card_id ?? "");
    const counterpartCardId = role === "source" ? String(match.candidate_card_id ?? "") : String(match.source_card_id ?? "");
    return {
      ...match,
      role,
      counterpart_user_id: counterpartUserId || null,
      own_card: compactOneOnOneCard(cardById.get(ownCardId)),
      counterpart_card: compactOneOnOneCard(cardById.get(counterpartCardId)),
      counterpart_profile: compactProfile(profileByUserId.get(counterpartUserId)),
      source_card: compactOneOnOneCard(cardById.get(String(match.source_card_id ?? ""))),
      candidate_card: compactOneOnOneCard(cardById.get(String(match.candidate_card_id ?? ""))),
      source_profile: compactProfile(profileByUserId.get(sourceUserId)),
      candidate_profile: compactProfile(profileByUserId.get(candidateUserId)),
    };
  });
}

export async function GET(request: Request) {
  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;

  try {
    const query = new URL(request.url).searchParams.get("query")?.trim() ?? "";
    if (query.length < 2) {
      return json(400, { ok: false, message: "닉네임, 이메일, 휴대폰 번호 또는 사용자 ID를 2글자 이상 입력해주세요." });
    }

    const [resolved, deletedAudits] = await Promise.all([resolveUser(auth.admin, query), findDeletedAudit(auth.admin, query)]);
    if (!resolved) {
      return json(200, {
        ok: true,
        query,
        user: null,
        deleted_audits: deletedAudits,
        counts: {},
        details: {},
        activities: [],
      });
    }

    const userId = resolved.userId;
    const [
      posts,
      comments,
      votes,
      reactions,
      openCardsRaw,
      sentOpenApplications,
      paidCards,
      paidApplications,
      oneOnOneCards,
      oneOnOneMatches,
      oneOnOneProfileHistory,
      payments,
      support,
      phoneAttempts,
      notifications,
      mailLogs,
      moreViewRequests,
      cityViewRequests,
      swipeLikesSent,
      swipeLikesReceived,
      swipeSubscriptions,
      phoneBlocks,
    ] = await Promise.all([
      listSafe<Record<string, unknown>>(
        auth.admin
          .from("posts")
          .select("id,type,title,content,is_hidden,is_deleted,created_at,deleted_at")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(50)
      ),
      listSafe<Record<string, unknown>>(
        auth.admin.from("comments").select("id,post_id,content,deleted_at,created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(50)
      ),
      listSafe<Record<string, unknown>>(
        auth.admin.from("votes").select("id,post_id,rating,value,created_at").eq("voter_id", userId).order("created_at", { ascending: false }).limit(50)
      ),
      listSafe<Record<string, unknown>>(
        auth.admin.from("post_reactions").select("id,post_id,reaction,created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(50)
      ),
      listSafe<Record<string, unknown>>(
        auth.admin
          .from("dating_cards")
          .select("id,owner_user_id,display_nickname,sex,age,region,status,published_at,expires_at,queue_priority_at,auto_requeue_count,created_at")
          .eq("owner_user_id", userId)
          .order("created_at", { ascending: false })
          .limit(50)
      ),
      listSafe<Record<string, unknown>>(
        auth.admin
          .from("dating_card_applications")
          .select("id,card_id,status,applicant_display_nickname,instagram_id,age,height_cm,region,job,training_years,created_at")
          .eq("applicant_user_id", userId)
          .order("created_at", { ascending: false })
          .limit(50)
      ),
      listSafe<Record<string, unknown>>(
        auth.admin.from("dating_paid_cards").select("id,nickname,gender,status,paid_at,expires_at,created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(50)
      ),
      listSafe<Record<string, unknown>>(
        auth.admin
          .from("dating_paid_card_applications")
          .select("id,paid_card_id,status,applicant_display_nickname,instagram_id,created_at")
          .eq("applicant_user_id", userId)
          .order("created_at", { ascending: false })
          .limit(50)
      ),
      listSafe<Record<string, unknown>>(
        auth.admin
          .from("dating_1on1_cards")
          .select(
            "id,user_id,sex,name,birth_year,height_cm,job,region,phone,intro_text,strengths_text,preferred_partner_text,smoking,workout_frequency,photo_paths,status,admin_note,admin_tags,reviewed_at,priority_boost_expires_at,created_at,updated_at"
          )
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(50)
      ),
      listSafe<Record<string, unknown>>(
        auth.admin
          .from("dating_1on1_match_proposals")
          .select("id,state,contact_exchange_status,source_card_id,source_user_id,candidate_card_id,candidate_user_id,created_at,updated_at,source_selected_at,candidate_responded_at,source_final_responded_at")
          .or(`source_user_id.eq.${userId},candidate_user_id.eq.${userId}`)
          .order("updated_at", { ascending: false })
          .limit(50)
      ),
      listSafe<Record<string, unknown>>(
        auth.admin
          .from("dating_1on1_card_profile_history")
          .select("id,card_id,user_id,event_type,snapshot,created_at")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(100)
      ),
      listSafe<Record<string, unknown>>(
        auth.admin
          .from("toss_test_payment_orders")
          .select("id,product_type,product_meta,amount,status,order_name,toss_order_id,payment_key,raw_response,created_at,approved_at")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(50)
      ),
      listSafe<Record<string, unknown>>(
        auth.admin.from("support_inquiries").select("id,category,subject,status,created_at,answered_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(50)
      ),
      listSafe<Record<string, unknown>>(
        auth.admin
          .from("profile_phone_verification_attempts")
          .select("id,action,status,provider,provider_error,retry_after_sec,created_at")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(50)
      ),
      listSafe<Record<string, unknown>>(
        auth.admin.from("notifications").select("id,type,actor_id,post_id,comment_id,meta_json,created_at,read_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(50)
      ),
      listSafe<Record<string, unknown>>(
        auth.admin
          .from("admin_open_card_outreach_mail_logs")
          .select("id,campaign_key,subject,success,provider_status,provider_error,sent_at,meta")
          .eq("user_id", userId)
          .order("sent_at", { ascending: false })
          .limit(50)
      ),
      listSafe<Record<string, unknown>>(
        auth.admin.from("dating_more_view_requests").select("id,sex,status,created_at,reviewed_at,access_expires_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(50)
      ),
      listSafe<Record<string, unknown>>(
        auth.admin.from("dating_city_view_requests").select("id,city,status,created_at,reviewed_at,access_expires_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(50)
      ),
      listSafe<Record<string, unknown>>(
        auth.admin.from("dating_card_swipes").select("id,actor_card_id,target_user_id,target_card_id,target_sex,action,created_at").eq("actor_user_id", userId).order("created_at", { ascending: false }).limit(50)
      ),
      listSafe<Record<string, unknown>>(
        auth.admin.from("dating_card_swipes").select("id,actor_user_id,actor_card_id,target_card_id,target_sex,action,created_at").eq("target_user_id", userId).order("created_at", { ascending: false }).limit(50)
      ),
      listSafe<Record<string, unknown>>(
        auth.admin.from("dating_swipe_subscription_requests").select("id,status,daily_limit,duration_days,requested_at,approved_at,expires_at").eq("user_id", userId).order("requested_at", { ascending: false }).limit(50)
      ),
      listSafe<Record<string, unknown>>(
        auth.admin.from("dating_1on1_phone_blocks").select("id,phone_last4,created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(50)
      ),
    ]);

    const openCards = await addOpenCardQueuePositions(auth.admin, openCardsRaw);
    const openCardIds = openCards.map((card) => String(card.id)).filter(Boolean);
    const receivedOpenApplications = openCardIds.length
      ? await listSafe<Record<string, unknown>>(
          auth.admin
            .from("dating_card_applications")
            .select("id,card_id,applicant_user_id,applicant_display_nickname,status,instagram_id,age,height_cm,region,job,training_years,created_at")
            .in("card_id", openCardIds)
            .order("created_at", { ascending: false })
            .limit(100)
        )
      : [];
    const enrichedOneOnOneMatches = await enrichOneOnOneMatches(auth.admin, userId, oneOnOneMatches);

    const counts = {
      posts: await countSafe(auth.admin.from("posts").select("id", { count: "exact", head: true }).eq("user_id", userId)),
      bodycheck_posts: await countSafe(auth.admin.from("posts").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("type", "photo_bodycheck")),
      comments: await countSafe(auth.admin.from("comments").select("id", { count: "exact", head: true }).eq("user_id", userId)),
      open_cards: await countSafe(auth.admin.from("dating_cards").select("id", { count: "exact", head: true }).eq("owner_user_id", userId)),
      open_card_received_applications: receivedOpenApplications.length,
      open_card_sent_applications: await countSafe(auth.admin.from("dating_card_applications").select("id", { count: "exact", head: true }).eq("applicant_user_id", userId)),
      one_on_one_cards: await countSafe(auth.admin.from("dating_1on1_cards").select("id", { count: "exact", head: true }).eq("user_id", userId)),
      one_on_one_matches: enrichedOneOnOneMatches.length,
      payments: await countSafe(auth.admin.from("toss_test_payment_orders").select("id", { count: "exact", head: true }).eq("user_id", userId)),
      support: await countSafe(auth.admin.from("support_inquiries").select("id", { count: "exact", head: true }).eq("user_id", userId)),
    };

    const details = {
      open_cards: openCards,
      open_card_received_applications: receivedOpenApplications,
      open_card_sent_applications: sentOpenApplications,
      paid_cards: paidCards,
      paid_card_applications: paidApplications,
      one_on_one_cards: oneOnOneCards,
      one_on_one_matches: enrichedOneOnOneMatches,
      one_on_one_profile_history: oneOnOneProfileHistory,
      community_posts: posts,
      community_comments: comments,
      bodycheck_votes: votes,
      reactions,
      payments,
      support,
      phone_verification_attempts: phoneAttempts,
      notifications,
      marketing_mail_logs: mailLogs,
      more_view_requests: moreViewRequests,
      city_view_requests: cityViewRequests,
      swipe_likes_sent: swipeLikesSent,
      swipe_likes_received: swipeLikesReceived,
      swipe_subscriptions: swipeSubscriptions,
      one_on_one_phone_blocks: phoneBlocks,
    };

    const activities: ActivityItem[] = [];
    addRows(activities, "post", "커뮤니티 글", posts);
    addRows(activities, "comment", "댓글", comments);
    addRows(activities, "vote", "몸평 투표", votes);
    addRows(activities, "reaction", "커뮤니티 반응", reactions);
    addRows(activities, "open_card", "오픈카드 등록", openCards);
    addRows(activities, "open_application_received", "오픈카드 받은 지원", receivedOpenApplications);
    addRows(activities, "open_application_sent", "오픈카드 보낸 지원", sentOpenApplications);
    addRows(activities, "paid_card", "유료 오픈카드", paidCards);
    addRows(activities, "paid_application", "유료카드 지원", paidApplications);
    addRows(activities, "one_on_one_card", "1:1 카드", oneOnOneCards);
    addRows(activities, "one_on_one_match", "1:1 매칭", enrichedOneOnOneMatches, "updated_at");
    addRows(activities, "one_on_one_profile_history", "1:1 프로필 기록", oneOnOneProfileHistory);
    addRows(activities, "payment", "결제", payments);
    addRows(activities, "support", "문의", support);
    addRows(activities, "phone_verification", "휴대폰 인증", phoneAttempts);
    addRows(activities, "notification", "알림", notifications);
    addRows(activities, "mail", "메일 발송", mailLogs, "sent_at");
    addRows(activities, "more_view", "이상형 더보기", moreViewRequests);
    addRows(activities, "city_view", "가까운 이상형", cityViewRequests);
    addRows(activities, "swipe_like_sent", "빠른매칭 보낸 라이크", swipeLikesSent);
    addRows(activities, "swipe_like_received", "빠른매칭 받은 라이크", swipeLikesReceived);
    addRows(activities, "swipe_subscription", "빠른매칭 구독", swipeSubscriptions, "requested_at");

    activities.sort((a, b) => new Date(b.at ?? 0).getTime() - new Date(a.at ?? 0).getTime());

    return json(200, {
      ok: true,
      query,
      user: {
        id: userId,
        email: resolved.authUser?.email ?? null,
        created_at: resolved.authUser?.created_at ?? null,
        last_sign_in_at: resolved.authUser?.last_sign_in_at ?? null,
        phone: maskPhoneNumber(resolved.authUser?.phone ?? null),
        phone_confirmed_at: resolved.authUser?.phone_confirmed_at ?? null,
        profile: maskSensitivePhoneFields(resolved.profile),
      },
      deleted_audits: deletedAudits,
      counts,
      details: maskSensitivePhoneFields(details),
      activities: maskSensitivePhoneFields(activities.slice(0, 180)),
    });
  } catch (error) {
    console.error("[GET /api/admin/users/activity] failed", error);
    return json(500, { ok: false, message: "회원 기록을 불러오지 못했습니다." });
  }
}
