import { getActiveApprovedCities } from "@/lib/dating-city-view";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ ok: true, loggedIn: false, activeCities: [], pendingCities: [] });
  }

  const admin = createAdminClient();
  const [activeCities, pendingRes] = await Promise.all([
    getActiveApprovedCities(admin, user.id),
    admin
      .from("dating_city_view_requests")
      .select("city")
      .eq("user_id", user.id)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const pendingCities = Array.isArray(pendingRes.data)
    ? [...new Set(pendingRes.data.map((row: { city?: string }) => String(row.city ?? "").trim()).filter(Boolean))]
    : [];

  return NextResponse.json({
    ok: true,
    loggedIn: true,
    activeCities,
    pendingCities,
  });
}
