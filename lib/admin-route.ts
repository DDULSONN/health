import { NextResponse } from "next/server";
import { isAllowedAdminUser } from "@/lib/admin";
import { createAdminClient, createClient } from "@/lib/supabase/server";

export async function requireAdminRoute() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 }),
    };
  }

  if (!isAllowedAdminUser(user.id, user.email)) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "접근 권한이 없습니다." }, { status: 403 }),
    };
  }

  return {
    ok: true as const,
    user,
    supabase,
    admin: createAdminClient(),
  };
}
