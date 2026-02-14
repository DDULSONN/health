import { NextResponse } from "next/server";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/admin";

type Body = {
  admin_note?: string;
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as Body;
  const { id } = await params;
  const admin = createAdminClient();

  const { error } = await admin
    .from("cert_requests")
    .update({
      status: "needs_info",
      reviewed_at: new Date().toISOString(),
      admin_note: body.admin_note?.trim() || "추가 자료를 제출해 주세요.",
    })
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

