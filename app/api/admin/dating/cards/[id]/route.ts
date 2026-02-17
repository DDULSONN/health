import { isAdminEmail } from "@/lib/admin";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const status = (body as { status?: string } | null)?.status;
  if (status !== "pending" && status !== "public" && status !== "hidden") {
    return NextResponse.json({ error: "허용되지 않은 상태값입니다." }, { status: 400 });
  }

  const adminClient = createAdminClient();
  const { error } = await adminClient.from("dating_cards").update({ status }).eq("id", id);
  if (error) {
    console.error("[PATCH /api/admin/dating/cards/[id]] failed", error);
    return NextResponse.json({ error: "상태 변경에 실패했습니다." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, status });
}
