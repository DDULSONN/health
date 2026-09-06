import { NextResponse } from "next/server";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";
import { ensureAllowedMutationOrigin } from "@/lib/request-origin";
import { createSignupEmailConsentToken, recordSignupEmailConsent } from "@/lib/signup-email-consent-server";

export async function POST(request: Request) {
  const denied = ensureAllowedMutationOrigin(request);
  if (denied) return denied;
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ ok: false }, { status: 400 });
  try {
    if (body.action === "prepare") {
      if (typeof body.consented !== "boolean" || !["email", "google", "apple"].includes(body.provider) ||
        (body.provider === "email" && (typeof body.email !== "string" || body.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)))) {
        return NextResponse.json({ ok: false }, { status: 400 });
      }
      const token = createSignupEmailConsentToken({ consented: body.consented, provider: body.provider, email: body.provider === "email" ? body.email : "" });
      return NextResponse.json({ ok: true, token }, { headers: { "Cache-Control": "no-store" } });
    }
    if (body.action !== "record") return NextResponse.json({ ok: false }, { status: 400 });
    const { user } = await getRequestAuthContext(request);
    if (!user) return NextResponse.json({ ok: false }, { status: 401 });
    await recordSignupEmailConsent(createAdminClient(), user, body.token);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
