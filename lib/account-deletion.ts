import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

type DeletionMode = "hard" | "soft";
type InitiatedByRole = "self" | "admin";

export function maskEmail(email: string | null | undefined) {
  const value = (email ?? "").trim();
  if (!value.includes("@")) return null;

  const [localPart, domain] = value.split("@");
  if (!localPart || !domain) return null;
  if (localPart.length <= 2) return `${localPart[0] ?? "*"}*@${domain}`;

  return `${localPart.slice(0, 2)}***@${domain}`;
}

export function hashEmail(email: string | null | undefined) {
  const value = (email ?? "").trim().toLowerCase();
  if (!value) return null;
  return createHash("sha256").update(value).digest("hex");
}

export function getRequestIp(req: Request) {
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const firstIp = forwardedFor
      .split(",")
      .map((part) => part.trim())
      .find(Boolean);
    if (firstIp) return firstIp;
  }

  return (
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-real-ip") ??
    req.headers.get("x-vercel-forwarded-for") ??
    null
  );
}

export function getAccountDeletionConfigError() {
  const missing: string[] = [];

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    missing.push("NEXT_PUBLIC_SUPABASE_URL");
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    missing.push("SUPABASE_SERVICE_ROLE_KEY");
  }

  if (missing.length === 0) return null;

  return {
    userMessage: "서버 설정이 아직 완료되지 않았습니다. 관리자에게 문의해 주세요.",
    debugMessage: `Missing environment variable(s): ${missing.join(", ")}`,
  };
}

async function insertDeletionAudit(
  admin: SupabaseClient,
  payload: {
    auth_user_id: string;
    nickname: string | null;
    email: string | null | undefined;
    ip_address?: string | null;
    user_agent?: string | null;
    deletion_mode: DeletionMode;
    initiated_by_user_id?: string | null;
    initiated_by_role?: InitiatedByRole;
  }
) {
  const auditRes = await admin.from("account_deletion_audits").insert({
    auth_user_id: payload.auth_user_id,
    nickname: payload.nickname,
    email_masked: maskEmail(payload.email),
    email_hash: hashEmail(payload.email),
    ip_address: payload.ip_address ?? null,
    user_agent: payload.user_agent ?? null,
    deletion_mode: payload.deletion_mode,
    initiated_by_user_id: payload.initiated_by_user_id ?? null,
    initiated_by_role: payload.initiated_by_role ?? "self",
  });

  if (auditRes.error) {
    console.warn("[account deletion] audit insert failed", auditRes.error);
  }
}

export async function performAccountDeletion(params: {
  admin: SupabaseClient;
  userId: string;
  email: string | null | undefined;
  nickname?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  initiatedByUserId?: string | null;
  initiatedByRole?: InitiatedByRole;
}) {
  const {
    admin,
    userId,
    email,
    nickname: nicknameInput,
    ipAddress,
    userAgent,
    initiatedByUserId,
    initiatedByRole = "self",
  } = params;

  let nickname = nicknameInput ?? null;

  if (nickname === null) {
    const profileRes = await admin.from("profiles").select("nickname").eq("user_id", userId).maybeSingle();
    nickname = typeof profileRes.data?.nickname === "string" ? profileRes.data.nickname : null;
  }

  const pushTokenReset = await admin.from("profiles").update({ push_token: null }).eq("user_id", userId);
  if (pushTokenReset.error) {
    console.warn("[account deletion] push token cleanup failed", pushTokenReset.error);
  }

  const hardDelete = await admin.auth.admin.deleteUser(userId);
  if (!hardDelete.error) {
    await insertDeletionAudit(admin, {
      auth_user_id: userId,
      nickname,
      email,
      ip_address: ipAddress,
      user_agent: userAgent,
      deletion_mode: "hard",
      initiated_by_user_id: initiatedByUserId,
      initiated_by_role: initiatedByRole,
    });

    return { ok: true as const, mode: "hard" as const };
  }

  console.error("[account deletion] hard delete failed", hardDelete.error);

  const softDelete = await admin.auth.admin.deleteUser(userId, true);
  if (softDelete.error) {
    console.error("[account deletion] soft delete failed", softDelete.error);
    return {
      ok: false as const,
      error: "회원 탈퇴 처리에 실패했습니다. 잠시 후 다시 시도해 주세요. 문제가 계속되면 문의 부탁드립니다.",
      debug:
        hardDelete.error.message === softDelete.error.message
          ? hardDelete.error.message
          : `${hardDelete.error.message} / ${softDelete.error.message}`,
    };
  }

  // Remove the public profile only after the auth account has been safely disabled.
  const profileDelete = await admin.from("profiles").delete().eq("user_id", userId);
  if (profileDelete.error) {
    console.warn("[account deletion] profile cleanup failed after soft delete", profileDelete.error);
  }

  await insertDeletionAudit(admin, {
    auth_user_id: userId,
    nickname,
    email,
    ip_address: ipAddress,
    user_agent: userAgent,
    deletion_mode: "soft",
    initiated_by_user_id: initiatedByUserId,
    initiated_by_role: initiatedByRole,
  });

  return { ok: true as const, mode: "soft" as const };
}
