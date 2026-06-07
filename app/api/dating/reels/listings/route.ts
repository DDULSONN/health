import { publicCachedJson } from "@/lib/http-cache";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function isMissingColumnError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = String((error as { code?: unknown }).code ?? "");
  const message = String((error as { message?: unknown }).message ?? "").toLowerCase();
  return code === "42703" || code === "PGRST204" || message.includes("column") || message.includes("instagram_url");
}

export async function GET() {
  const admin = createAdminClient();
  let { data, error } = await admin
    .from("reels_dating_listings")
    .select("id,title,description,instagram_url,status,sort_order,created_at")
    .eq("status", "active")
    .order("sort_order", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(10);

  if (error && isMissingColumnError(error)) {
    const fallback = await admin
      .from("reels_dating_listings")
      .select("id,title,description,status,sort_order,created_at")
      .eq("status", "active")
      .order("sort_order", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(10);
    data = (fallback.data ?? []).map((item) => ({ ...item, instagram_url: "" }));
    error = fallback.error;
  }

  if (error) {
    if (error.code === "42P01") {
      return publicCachedJson({ items: [] }, { sMaxAge: 60, staleWhileRevalidate: 300 });
    }
    console.error("[GET /api/dating/reels/listings] failed", error);
    return NextResponse.json({ error: "릴스 매물 목록을 불러오지 못했습니다." }, { status: 500 });
  }

  return publicCachedJson({ items: data ?? [] }, { sMaxAge: 30, staleWhileRevalidate: 120 });
}
