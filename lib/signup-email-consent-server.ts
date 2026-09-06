import { createHmac, timingSafeEqual } from "node:crypto";
import type { User, SupabaseClient } from "@supabase/supabase-js";
import { EMAIL_CONSENT_VERSION, EMAIL_CONSENT_LABEL, EMAIL_CONSENT_DESCRIPTION } from "@/lib/signup-email-consent";

type Choice = { consented: boolean; provider: "email" | "google" | "apple"; email: string; issuedAt: number; version: string };
function signature(value: string) {
  const secret = process.env.EMAIL_UNSUBSCRIBE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("Consent signing is not configured");
  return createHmac("sha256", secret).update(`signup-email-consent:${value}`).digest("hex");
}
export function createSignupEmailConsentToken(input: Pick<Choice, "consented" | "provider" | "email">, now = Date.now()) {
  const value = Buffer.from(JSON.stringify({ ...input, email: input.email.trim().toLowerCase(), issuedAt: now, version: EMAIL_CONSENT_VERSION })).toString("base64url");
  return `${value}.${signature(value)}`;
}
export function readSignupEmailConsentToken(token: unknown, user: User): Choice | null {
  try {
    if (typeof token !== "string" || token.length > 2048) return null;
    const [value, sig, extra] = token.split(".");
    if (!value || !sig || extra || !timingSafeEqual(Buffer.from(sig), Buffer.from(signature(value)))) return null;
    const choice = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Choice;
    const createdAt = Date.parse(user.created_at);
    if (choice.version !== EMAIL_CONSENT_VERSION || typeof choice.consented !== "boolean" || !Number.isFinite(choice.issuedAt) ||
      !Number.isFinite(createdAt) || createdAt < choice.issuedAt || createdAt - choice.issuedAt > 30 * 60 * 1000) return null;
    if (choice.provider !== user.app_metadata?.provider) return null;
    if (choice.provider === "email" && choice.email !== user.email?.trim().toLowerCase()) return null;
    if (!["email", "google", "apple"].includes(choice.provider)) return null;
    return choice;
  } catch { return null; }
}
export async function recordSignupEmailConsent(admin: SupabaseClient, user: User, token?: unknown) {
  const choice = readSignupEmailConsentToken(token ?? user.user_metadata?.signup_email_consent_token, user);
  if (!choice || !user.email_confirmed_at) return;
  const result = await admin.from("email_marketing_consents").upsert({
    user_id: user.id,
    consented: choice.consented,
    selected_at: new Date(choice.issuedAt).toISOString(),
    consented_at: choice.consented ? new Date(choice.issuedAt).toISOString() : null,
    wording_version: choice.version,
    wording: `${EMAIL_CONSENT_LABEL}\n${EMAIL_CONSENT_DESCRIPTION}`,
    source: `signup_${choice.provider}`,
  }, { onConflict: "user_id", ignoreDuplicates: true });
  if (result.error) throw new Error(`Consent record failed: ${result.error.code}`);
}
