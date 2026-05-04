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
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
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

async function resolveUser(admin: AdminClient, query: string) {
  if (isUuid(query)) {
    const [{ data: userData }, profileRes] = await Promise.all([
      admin.auth.admin.getUserById(query).catch(() => ({ data: { user: null } })),
      admin.from("profiles").select("user_id,nickname,role,phone_verified,phone_e164,phone_verified_at,swipe_profile_visible").eq("user_id", query).maybeSingle(),
    ]);
    return {
      userId: query,
      authUser: userData.user,
      profile: profileRes.data ?? null,
    };
  }

  const [profileRes, emailUser] = await Promise.all([
    admin
      .from("profiles")
      .select("user_id,nickname,role,phone_verified,phone_e164,phone_verified_at,swipe_profile_visible")
      .ilike("nickname", `%${query.replace(/[,%]/g, " ")}%`)
      .limit(5),
    findAuthUserByEmail(admin, query),
  ]);

  if (emailUser) {
    const profile = await admin
      .from("profiles")
      .select("user_id,nickname,role,phone_verified,phone_e164,phone_verified_at,swipe_profile_visible")
      .eq("user_id", emailUser.id)
      .maybeSingle();
    return { userId: emailUser.id, authUser: emailUser, profile: profile.data ?? null };
  }

  const profile = profileRes.data?.[0] ?? null;
  if (!profile) return null;
  const { data } = await admin.auth.admin.getUserById(String(profile.user_id)).catch(() => ({ data: { user: null } }));
  return { userId: String(profile.user_id), authUser: data.user, profile };
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
    base = base.ilike("nickname", `%${query.replace(/[,%]/g, " ")}%`);
  }

  return listSafe<{
    id: string;
    auth_user_id: string;
    nickname: string | null;
    email_masked: string | null;
    deletion_mode: string;
    initiated_by_role: string;
    deleted_at: string;
    retention_until: string;
  }>(base);
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

export async function GET(request: Request) {
  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;

  try {
    const query = new URL(request.url).searchParams.get("query")?.trim() ?? "";
    if (query.length < 2) {
      return json(400, { ok: false, message: "닉네임, 이메일 또는 사용자 ID를 2글자 이상 입력해주세요." });
    }

    const [resolved, deletedAudits] = await Promise.all([resolveUser(auth.admin, query), findDeletedAudit(auth.admin, query)]);
    if (!resolved) {
      return json(200, {
        ok: true,
        query,
        user: null,
        deleted_audits: deletedAudits,
        counts: {},
        activities: [],
      });
    }

    const userId = resolved.userId;
    const [posts, comments, votes, reactions, openCards, openApplications, paidCards, paidApplications, oneOnOneCards, oneOnOneMatches, payments, support, phoneAttempts] =
      await Promise.all([
        listSafe<Record<string, unknown>>(
          auth.admin
            .from("posts")
            .select("id,type,title,is_hidden,is_deleted,created_at,deleted_at")
            .eq("user_id", userId)
            .order("created_at", { ascending: false })
            .limit(30)
        ),
        listSafe<Record<string, unknown>>(
          auth.admin.from("comments").select("id,post_id,content,deleted_at,created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(30)
        ),
        listSafe<Record<string, unknown>>(
          auth.admin.from("votes").select("id,post_id,rating,value,created_at").eq("voter_id", userId).order("created_at", { ascending: false }).limit(30)
        ),
        listSafe<Record<string, unknown>>(
          auth.admin.from("post_reactions").select("id,post_id,reaction,created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(30)
        ),
        listSafe<Record<string, unknown>>(
          auth.admin
            .from("dating_cards")
            .select("id,display_nickname,sex,status,published_at,expires_at,created_at")
            .eq("owner_user_id", userId)
            .order("created_at", { ascending: false })
            .limit(30)
        ),
        listSafe<Record<string, unknown>>(
          auth.admin
            .from("dating_card_applications")
            .select("id,card_id,status,applicant_display_nickname,created_at")
            .eq("applicant_user_id", userId)
            .order("created_at", { ascending: false })
            .limit(30)
        ),
        listSafe<Record<string, unknown>>(
          auth.admin.from("dating_paid_cards").select("id,nickname,gender,status,paid_at,expires_at,created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(30)
        ),
        listSafe<Record<string, unknown>>(
          auth.admin
            .from("dating_paid_card_applications")
            .select("id,paid_card_id,status,applicant_display_nickname,created_at")
            .eq("applicant_user_id", userId)
            .order("created_at", { ascending: false })
            .limit(30)
        ),
        listSafe<Record<string, unknown>>(
          auth.admin.from("dating_1on1_cards").select("id,sex,name,region,status,reviewed_at,created_at,updated_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(30)
        ),
        listSafe<Record<string, unknown>>(
          auth.admin
            .from("dating_1on1_match_proposals")
            .select("id,state,contact_exchange_status,source_user_id,candidate_user_id,created_at,updated_at")
            .or(`source_user_id.eq.${userId},candidate_user_id.eq.${userId}`)
            .order("updated_at", { ascending: false })
            .limit(30)
        ),
        listSafe<Record<string, unknown>>(
          auth.admin
            .from("toss_test_payment_orders")
            .select("id,product_type,amount,status,order_name,toss_order_id,created_at,approved_at")
            .eq("user_id", userId)
            .order("created_at", { ascending: false })
            .limit(30)
        ),
        listSafe<Record<string, unknown>>(
          auth.admin.from("support_inquiries").select("id,category,subject,status,created_at,answered_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(30)
        ),
        listSafe<Record<string, unknown>>(
          auth.admin
            .from("profile_phone_verification_attempts")
            .select("id,action,status,provider,provider_error,retry_after_sec,created_at")
            .eq("user_id", userId)
            .order("created_at", { ascending: false })
            .limit(30)
        ),
      ]);

    const counts = {
      posts: await countSafe(auth.admin.from("posts").select("id", { count: "exact", head: true }).eq("user_id", userId)),
      bodycheck_posts: await countSafe(auth.admin.from("posts").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("type", "photo_bodycheck")),
      comments: await countSafe(auth.admin.from("comments").select("id", { count: "exact", head: true }).eq("user_id", userId)),
      open_cards: await countSafe(auth.admin.from("dating_cards").select("id", { count: "exact", head: true }).eq("owner_user_id", userId)),
      open_card_applications: await countSafe(auth.admin.from("dating_card_applications").select("id", { count: "exact", head: true }).eq("applicant_user_id", userId)),
      one_on_one_cards: await countSafe(auth.admin.from("dating_1on1_cards").select("id", { count: "exact", head: true }).eq("user_id", userId)),
      payments: await countSafe(auth.admin.from("toss_test_payment_orders").select("id", { count: "exact", head: true }).eq("user_id", userId)),
      support: await countSafe(auth.admin.from("support_inquiries").select("id", { count: "exact", head: true }).eq("user_id", userId)),
    };

    const activities: ActivityItem[] = [];
    addRows(activities, "post", "커뮤니티 글", posts);
    addRows(activities, "comment", "댓글", comments);
    addRows(activities, "vote", "몸평 투표", votes);
    addRows(activities, "reaction", "자유글 반응", reactions);
    addRows(activities, "open_card", "오픈카드", openCards);
    addRows(activities, "open_application", "오픈카드 지원", openApplications);
    addRows(activities, "paid_card", "유료 오픈카드", paidCards);
    addRows(activities, "paid_application", "유료 오픈카드 지원", paidApplications);
    addRows(activities, "one_on_one_card", "1:1 카드", oneOnOneCards);
    addRows(activities, "one_on_one_match", "1:1 매칭", oneOnOneMatches, "updated_at");
    addRows(activities, "payment", "결제", payments);
    addRows(activities, "support", "문의", support);
    addRows(activities, "phone_verification", "휴대폰 인증", phoneAttempts);

    activities.sort((a, b) => new Date(b.at ?? 0).getTime() - new Date(a.at ?? 0).getTime());

    return json(200, {
      ok: true,
      query,
      user: {
        id: userId,
        email: resolved.authUser?.email ?? null,
        created_at: resolved.authUser?.created_at ?? null,
        last_sign_in_at: resolved.authUser?.last_sign_in_at ?? null,
        phone: resolved.authUser?.phone ?? null,
        phone_confirmed_at: resolved.authUser?.phone_confirmed_at ?? null,
        profile: resolved.profile,
      },
      deleted_audits: deletedAudits,
      counts,
      activities: activities.slice(0, 120),
    });
  } catch (error) {
    console.error("[GET /api/admin/users/activity] failed", error);
    return json(500, { ok: false, message: "회원 기록을 불러오지 못했습니다." });
  }
}
