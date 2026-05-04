import { normalizePhoneToE164 } from "@/lib/phone-verification";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

type AuthUserLike = {
  phone?: string | null;
  phone_confirmed_at?: string | null;
};

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const candidate = user as unknown as AuthUserLike;
  const phoneE164 = normalizePhoneToE164(candidate.phone ?? "");
  const phoneConfirmedAt = candidate.phone_confirmed_at ?? null;

  if (!phoneE164 || !phoneConfirmedAt) {
    return NextResponse.json({ error: "Phone is not verified yet." }, { status: 400 });
  }

  const { error } = await supabase
    .from("profiles")
    .update({
      phone_verified: true,
      phone_e164: phoneE164,
      phone_verified_at: phoneConfirmedAt,
    })
    .eq("user_id", user.id);

  if (error) {
    console.error("[POST /api/mypage/phone-verification/sync] failed", error);
    return NextResponse.json({ error: "Failed to sync phone verification." }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    phone_verified: true,
    phone_e164: phoneE164,
    phone_verified_at: phoneConfirmedAt,
  });
}
