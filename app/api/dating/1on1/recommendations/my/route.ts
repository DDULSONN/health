import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { loadOneOnOneRecommendations } from "@/lib/dating-1on1-recommendation-service";

export async function GET(req: Request) {
  const { user } = await getRequestAuthContext(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return loadOneOnOneRecommendations(createAdminClient(), user);
}
