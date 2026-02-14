import { NextResponse } from "next/server";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/admin";

const ALLOWED = new Set(["pending", "needs_info", "approved", "rejected"]);

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const statusParam = (searchParams.get("status") ?? "pending").toLowerCase();
  const status = ALLOWED.has(statusParam) ? statusParam : "pending";

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("cert_requests")
    .select("*")
    .eq("status", status)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ requests: data ?? [] });
}

