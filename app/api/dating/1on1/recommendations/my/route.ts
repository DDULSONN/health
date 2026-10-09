import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { loadOneOnOneRecommendations } from "@/lib/dating-1on1-recommendation-service";
import { isExpansionEnabled } from "@/lib/dating-1on1-expansion";

export async function GET(req: Request) {
  const { user } = await getRequestAuthContext(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const response = await loadOneOnOneRecommendations(createAdminClient(), user);
  if (!response.ok || !isExpansionEnabled(user.id)) return response;
  const body = await response.json();
  return NextResponse.json({ ...body, items: body.items.map((item: Record<string, unknown>) => ({ ...item, expansion_enabled: true })) },
    { headers: { "Cache-Control": "private, no-store" } });
}
