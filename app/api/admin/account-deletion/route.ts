import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAccountDeletionConfigError, getRequestIp, performAccountDeletion } from "@/lib/account-deletion";
import { requireAdminRoute } from "@/lib/admin-route";

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

type TargetUser = {
  id: string;
  email: string | null;
  nickname: string | null;
};

async function resolveTargetUser(
  admin: SupabaseClient,
  identifier: string
): Promise<TargetUser | null> {
  const trimmed = identifier.trim();
  if (!trimmed) return null;

  if (isUuid(trimmed)) {
    const [userRes, profileRes] = await Promise.all([
      admin.auth.admin.getUserById(trimmed).catch(() => null),
      admin.from("profiles").select("user_id,nickname").eq("user_id", trimmed).maybeSingle(),
    ]);

    if (!userRes?.data?.user) return null;
    return {
      id: userRes.data.user.id,
      email: userRes.data.user.email ?? null,
      nickname: typeof profileRes.data?.nickname === "string" ? profileRes.data.nickname : null,
    };
  }

  if (trimmed.includes("@")) {
    const authUserRes = await admin.schema("auth").from("users").select("id,email").ilike("email", trimmed).maybeSingle();
    if (authUserRes.error || !authUserRes.data) return null;

    const profileRes = await admin
      .from("profiles")
      .select("user_id,nickname")
      .eq("user_id", String(authUserRes.data.id))
      .maybeSingle();

    return {
      id: String(authUserRes.data.id),
      email: String(authUserRes.data.email ?? trimmed),
      nickname: typeof profileRes.data?.nickname === "string" ? profileRes.data.nickname : null,
    };
  }

  const profileRes = await admin.from("profiles").select("user_id,nickname").ilike("nickname", trimmed).maybeSingle();
  if (profileRes.error || !profileRes.data) return null;

  const userRes = await admin.auth.admin.getUserById(profileRes.data.user_id).catch(() => null);
  if (!userRes?.data?.user) return null;

  return {
    id: userRes.data.user.id,
    email: userRes.data.user.email ?? null,
    nickname: typeof profileRes.data.nickname === "string" ? profileRes.data.nickname : null,
  };
}

export async function POST(request: Request) {
  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;

  const configError = getAccountDeletionConfigError();
  if (configError) {
    console.error("[POST /api/admin/account-deletion] missing config", configError.debugMessage);
    return NextResponse.json({ error: configError.userMessage }, { status: 500 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    identifier?: string;
  };

  const identifier = body.identifier?.trim() ?? "";
  if (!identifier) {
    return NextResponse.json({ error: "이메일, 닉네임 또는 사용자 ID를 입력해 주세요." }, { status: 400 });
  }

  const target = await resolveTargetUser(auth.admin, identifier);
  if (!target) {
    return NextResponse.json({ error: "해당 사용자를 찾지 못했습니다." }, { status: 404 });
  }

  if (target.id === auth.user.id) {
    return NextResponse.json({ error: "관리자 본인 계정은 여기서 탈퇴 처리할 수 없습니다." }, { status: 400 });
  }

  const result = await performAccountDeletion({
    admin: auth.admin,
    userId: target.id,
    email: target.email,
    nickname: target.nickname,
    ipAddress: getRequestIp(request),
    userAgent: request.headers.get("user-agent"),
    initiatedByUserId: auth.user.id,
    initiatedByRole: "admin",
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error, debug: result.debug }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    mode: result.mode,
    user_id: target.id,
    nickname: target.nickname,
    email: target.email,
  });
}
