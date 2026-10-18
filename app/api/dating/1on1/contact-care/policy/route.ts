import { createAdminClient } from "@/lib/supabase/server";
import { contactCarePublicPolicy } from "@/lib/contact-care-notice";

// Public launch metadata only. No cookies, profile, order, claim or phone data.
export async function GET() {
  try {
    const result = await createAdminClient().from("contact_care_policy").select("enabled,starts_at")
      .eq("id", true).abortSignal(AbortSignal.timeout(5000)).maybeSingle();
    if (result.error) throw result.error;
    return Response.json(contactCarePublicPolicy(result.data?.enabled, result.data?.starts_at), {
      headers: { "Cache-Control": "public, max-age=0, s-maxage=60" },
    });
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (!["42P01", "PGRST205"].includes(code || "")) console.error("[contact-care-policy] unavailable", code || "unknown");
    // Installing SQL later must not break the site or announce an unavailable feature.
    return Response.json(contactCarePublicPolicy(false, null), { headers: { "Cache-Control": "no-store" } });
  }
}
