import type { User } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { recordAdminAuditEvent } from "@/lib/admin-audit";
import { requireAdminRoute } from "@/lib/admin-route";
import { createAdminClient } from "@/lib/supabase/server";

const METADATA_KEY = "employment_verification";
const PERSONAL_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "naver.com",
  "daum.net",
  "hanmail.net",
  "kakao.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "icloud.com",
  "me.com",
  "yahoo.com",
  "yahoo.co.kr",
  "proton.me",
  "protonmail.com",
]);

type AdminClient = ReturnType<typeof createAdminClient>;
type StoredVerification = {
  id: string;
  user_id: string;
  company_name: string;
  email_domain: string;
  status: "verified" | "revoked";
  verification_method: "admin_manual";
  verified_at: string;
  expires_at: string;
  verified_by_user_id: string | null;
  revoked_at: string | null;
  revoked_by_user_id: string | null;
  revoke_reason: string | null;
  created_at: string;
  updated_at: string;
};

type ProfileRow = {
  user_id: string;
  nickname: string | null;
  role: string | null;
  is_banned: boolean | null;
};

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function normalizeDomain(value: unknown) {
  if (typeof value !== "string") return "";
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#]/)[0]
    .replace(/^@+/, "");
  return (normalized.split("@").pop() ?? "").replace(/\.+$/, "");
}

function isValidCompanyDomain(domain: string) {
  const isPersonalDomain = [...PERSONAL_EMAIL_DOMAINS].some(
    (personalDomain) => domain === personalDomain || domain.endsWith(`.${personalDomain}`)
  );
  if (domain.length < 3 || domain.length > 253 || isPersonalDomain) return false;
  return /^(?=.{3,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(domain);
}

function normalizeSearch(value: string) {
  return value.trim().replace(/[,%]/g, " ").slice(0, 100);
}

function addMonthsIso(months: number) {
  const date = new Date();
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString();
}

function readVerification(user: User): StoredVerification | null {
  const raw = user.app_metadata?.[METADATA_KEY];
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Partial<StoredVerification>;
  if (
    typeof item.id !== "string" ||
    typeof item.user_id !== "string" ||
    typeof item.company_name !== "string" ||
    typeof item.email_domain !== "string" ||
    (item.status !== "verified" && item.status !== "revoked") ||
    typeof item.verified_at !== "string" ||
    typeof item.expires_at !== "string" ||
    typeof item.created_at !== "string" ||
    typeof item.updated_at !== "string"
  ) {
    return null;
  }
  return {
    id: item.id,
    user_id: item.user_id,
    company_name: item.company_name,
    email_domain: item.email_domain,
    status: item.status,
    verification_method: "admin_manual",
    verified_at: item.verified_at,
    expires_at: item.expires_at,
    verified_by_user_id: item.verified_by_user_id ?? null,
    revoked_at: item.revoked_at ?? null,
    revoked_by_user_id: item.revoked_by_user_id ?? null,
    revoke_reason: item.revoke_reason ?? null,
    created_at: item.created_at,
    updated_at: item.updated_at,
  };
}

function withEffectiveStatus(verification: StoredVerification | null) {
  if (!verification) return null;
  const effectiveStatus =
    verification.status === "revoked"
      ? "revoked"
      : new Date(verification.expires_at).getTime() > Date.now()
        ? "verified"
        : "expired";
  return { ...verification, effective_status: effectiveStatus };
}

async function findAuthUserByEmail(admin: AdminClient, email: string) {
  const normalized = email.trim().toLowerCase();
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const user = data.users.find((candidate) => (candidate.email ?? "").toLowerCase() === normalized);
    if (user) return user;
    if (data.users.length < 1000) break;
  }
  return null;
}

async function listUsersWithEmploymentMetadata(admin: AdminClient) {
  const users: User[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    users.push(...data.users.filter((user) => readVerification(user) !== null));
    if (data.users.length < 1000) break;
  }
  return users
    .sort((left, right) => {
      const leftAt = readVerification(left)?.updated_at ?? "";
      const rightAt = readVerification(right)?.updated_at ?? "";
      return rightAt.localeCompare(leftAt);
    })
    .slice(0, 100);
}

async function loadProfiles(admin: AdminClient, userIds: string[]) {
  if (userIds.length === 0) return new Map<string, ProfileRow>();
  const { data, error } = await admin
    .from("profiles")
    .select("user_id,nickname,role,is_banned")
    .in("user_id", userIds);
  if (error) throw error;
  return new Map(((data ?? []) as ProfileRow[]).map((profile) => [profile.user_id, profile]));
}

function serializeUser(user: User, profiles: Map<string, ProfileRow>, exposeEmail = false) {
  const profile = profiles.get(user.id);
  return {
    userId: user.id,
    nickname: profile?.nickname ?? null,
    role: profile?.role ?? null,
    isBanned: profile?.is_banned === true,
    accountEmail: exposeEmail ? user.email ?? null : null,
    verification: withEffectiveStatus(readVerification(user)),
  };
}

export async function GET(request: Request) {
  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;

  const query = normalizeSearch(new URL(request.url).searchParams.get("query") ?? "");
  try {
    let users: User[] = [];
    let exposeEmail = false;
    if (!query) {
      users = await listUsersWithEmploymentMetadata(auth.admin);
    } else if (isUuid(query)) {
      const { data, error } = await auth.admin.auth.admin.getUserById(query);
      if (error && !error.message.toLowerCase().includes("not found")) throw error;
      if (data?.user) users = [data.user];
    } else if (query.includes("@")) {
      const user = await findAuthUserByEmail(auth.admin, query);
      if (user) users = [user];
      exposeEmail = true;
    } else {
      const escaped = query.replace(/\\/g, "\\\\").replace(/_/g, "\\_");
      const { data, error } = await auth.admin
        .from("profiles")
        .select("user_id")
        .ilike("nickname", `%${escaped}%`)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      const authResults = await Promise.all(
        (data ?? []).map((profile) => auth.admin.auth.admin.getUserById(String(profile.user_id)))
      );
      users = authResults.flatMap((result) => (result.data?.user ? [result.data.user] : []));
    }

    const profiles = await loadProfiles(auth.admin, users.map((user) => user.id));
    return NextResponse.json({
      ok: true,
      storage: "auth_app_metadata",
      items: users.map((user) => serializeUser(user, profiles, exposeEmail)),
    });
  } catch (error) {
    console.error("[GET /api/admin/employment-verifications] failed", error);
    return NextResponse.json({ ok: false, error: "직장 인증 정보를 불러오지 못했습니다." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = body.action === "revoke" ? "revoke" : "verify";
  const userId = typeof body.userId === "string" ? body.userId.trim() : "";
  if (!isUuid(userId)) {
    return NextResponse.json({ ok: false, error: "올바른 회원 ID가 필요합니다." }, { status: 400 });
  }

  try {
    const [{ data: authUserData, error: authUserError }, { data: profile, error: profileError }] = await Promise.all([
      auth.admin.auth.admin.getUserById(userId),
      auth.admin.from("profiles").select("user_id,nickname").eq("user_id", userId).maybeSingle(),
    ]);
    if (authUserError || !authUserData?.user) {
      return NextResponse.json({ ok: false, error: "회원을 찾을 수 없습니다." }, { status: 404 });
    }
    if (profileError) throw profileError;

    const authUser = authUserData.user;
    const current = readVerification(authUser);
    const now = new Date().toISOString();
    let next: StoredVerification;

    if (action === "revoke") {
      const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 300) : "";
      if (!reason) return NextResponse.json({ ok: false, error: "인증 취소 사유를 입력해주세요." }, { status: 400 });
      if (!current) return NextResponse.json({ ok: false, error: "취소할 직장 인증이 없습니다." }, { status: 404 });
      next = {
        ...current,
        status: "revoked",
        revoked_at: now,
        revoked_by_user_id: auth.user.id,
        revoke_reason: reason,
        updated_at: now,
      };
    } else {
      const companyName = typeof body.companyName === "string" ? body.companyName.trim().replace(/\s{2,}/g, " ").slice(0, 80) : "";
      const emailDomain = normalizeDomain(body.emailDomain);
      const rawMonths = Number(body.validityMonths ?? 12);
      const validityMonths = Number.isInteger(rawMonths) ? Math.max(1, Math.min(24, rawMonths)) : 12;
      if (!companyName) return NextResponse.json({ ok: false, error: "회사명을 입력해주세요." }, { status: 400 });
      if (!isValidCompanyDomain(emailDomain)) {
        return NextResponse.json({ ok: false, error: "개인 메일이 아닌 올바른 회사 이메일 도메인을 입력해주세요." }, { status: 400 });
      }
      next = {
        id: current?.id ?? crypto.randomUUID(),
        user_id: userId,
        company_name: companyName,
        email_domain: emailDomain,
        status: "verified",
        verification_method: "admin_manual",
        verified_at: now,
        expires_at: addMonthsIso(validityMonths),
        verified_by_user_id: auth.user.id,
        revoked_at: null,
        revoked_by_user_id: null,
        revoke_reason: null,
        created_at: current?.created_at ?? now,
        updated_at: now,
      };
    }

    const { data: updated, error: updateError } = await auth.admin.auth.admin.updateUserById(userId, {
      app_metadata: { ...(authUser.app_metadata ?? {}), [METADATA_KEY]: next },
    });
    if (updateError || !updated?.user) throw updateError ?? new Error("updated user missing");

    await recordAdminAuditEvent({
      admin: auth.admin,
      adminUser: auth.user,
      request,
      action: action === "revoke" ? "employment_verification_revoke" : "employment_verification_grant",
      targetType: "auth_user_employment_verification",
      targetId: userId,
      requestId,
      metadata: {
        companyName: next.company_name,
        emailDomain: next.email_domain,
        expiresAt: next.expires_at,
        reason: next.revoke_reason,
        nickname: profile?.nickname ?? null,
      },
    });
    return NextResponse.json({ ok: true, storage: "auth_app_metadata", item: withEffectiveStatus(next) });
  } catch (error) {
    console.error("[POST /api/admin/employment-verifications] failed", error);
    await recordAdminAuditEvent({
      admin: auth.admin,
      adminUser: auth.user,
      request,
      action: action === "revoke" ? "employment_verification_revoke" : "employment_verification_grant",
      targetType: "auth_user_employment_verification",
      targetId: userId || null,
      requestId,
      status: "failure",
      metadata: { message: error instanceof Error ? error.message : String(error) },
    });
    return NextResponse.json({ ok: false, error: "직장 인증 상태를 저장하지 못했습니다." }, { status: 500 });
  }
}
