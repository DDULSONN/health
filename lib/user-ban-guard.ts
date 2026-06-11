import { NextResponse } from "next/server";
import type { createAdminClient } from "@/lib/supabase/server";

type AdminClient = ReturnType<typeof createAdminClient>;

export async function getUserBanResponse(admin: AdminClient, userId: string) {
  const { data, error } = await admin
    .from("profiles")
    .select("is_banned,banned_reason")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("[user-ban-guard] profile lookup failed", error);
    return NextResponse.json({ error: "회원 상태를 확인하지 못했습니다." }, { status: 500 });
  }

  if (data?.is_banned) {
    return NextResponse.json(
      {
        error: data.banned_reason?.trim() || "이 계정은 관리자에 의해 이용이 제한되었습니다.",
        error_code: "user_banned",
      },
      { status: 403 }
    );
  }

  return null;
}
