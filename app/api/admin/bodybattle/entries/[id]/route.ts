import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { requireAdmin } from "../../_auth";

type PatchBody = {
  moderation_status?: "pending" | "approved" | "rejected";
  status?: "active" | "inactive" | "hidden";
};

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as PatchBody;
  const patch: Record<string, unknown> = {};

  if (body.moderation_status && ["pending", "approved", "rejected"].includes(body.moderation_status)) {
    patch.moderation_status = body.moderation_status;
  }
  if (body.status && ["active", "inactive", "hidden"].includes(body.status)) {
    patch.status = body.status;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: false, message: "No valid fields." }, { status: 400 });
  }

  if (patch.moderation_status === "approved" && patch.status === undefined) {
    patch.status = "active";
  }
  if (patch.moderation_status === "rejected") {
    patch.status = "hidden";
  }

  const admin = createAdminClient();
  const updateRes = await admin.from("bodybattle_entries").update(patch).eq("id", id).select("id,moderation_status,status").maybeSingle();
  if (updateRes.error) {
    return NextResponse.json({ ok: false, message: updateRes.error.message }, { status: 500 });
  }
  if (!updateRes.data) {
    return NextResponse.json({ ok: false, message: "Entry not found." }, { status: 404 });
  }

  return NextResponse.json({ ok: true, item: updateRes.data });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const admin = createAdminClient();
  const deleteRes = await admin.from("bodybattle_entries").delete().eq("id", id);
  if (deleteRes.error) {
    return NextResponse.json({ ok: false, message: deleteRes.error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
