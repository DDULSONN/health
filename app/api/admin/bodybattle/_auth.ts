import { isAllowedAdminUser } from "@/lib/admin";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false as const, response: NextResponse.json({ ok: false, message: "Login required." }, { status: 401 }) };
  }
  if (!isAllowedAdminUser(user.id, user.email)) {
    return { ok: false as const, response: NextResponse.json({ ok: false, message: "Forbidden." }, { status: 403 }) };
  }
  return { ok: true as const, user };
}
