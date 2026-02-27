import { createAdminClient, createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const applicationId = id?.trim();
  if (!applicationId) {
    return NextResponse.json({ error: "Application id is required." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: target, error: targetError } = await admin
    .from("dating_card_applications")
    .select("id, status")
    .eq("id", applicationId)
    .eq("applicant_user_id", user.id)
    .maybeSingle();

  if (targetError) {
    console.error("[DELETE /api/dating/cards/my/applied/[id]] fetch failed", targetError);
    return NextResponse.json({ error: "Failed to fetch application." }, { status: 500 });
  }

  if (!target) {
    return NextResponse.json({ error: "Application not found." }, { status: 404 });
  }

  if (target.status === "accepted") {
    return NextResponse.json({ error: "Accepted applications cannot be deleted." }, { status: 400 });
  }

  const { error: deleteError } = await admin
    .from("dating_card_applications")
    .delete()
    .eq("id", applicationId)
    .eq("applicant_user_id", user.id);

  if (deleteError) {
    console.error("[DELETE /api/dating/cards/my/applied/[id]] delete failed", deleteError);
    return NextResponse.json({ error: "Failed to delete application." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
