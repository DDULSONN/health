import { isAllowedAdminUser } from "@/lib/admin";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

type PatchPayload = {
  status?: "submitted" | "reviewing" | "approved" | "rejected";
  admin_note?: string | null;
  admin_tags?: string[] | null;
};

const STATUS_VALUES = new Set(["submitted", "reviewing", "approved", "rejected"]);

const ALLOWED_TRANSITIONS: Record<string, Set<string>> = {
  submitted: new Set(["submitted", "reviewing", "rejected"]),
  reviewing: new Set(["reviewing", "approved", "rejected"]),
  approved: new Set(["approved"]),
  rejected: new Set(["rejected"]),
};

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAllowedAdminUser(user.id, user.email)) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as PatchPayload | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const { id } = await params;
  const cardId = id?.trim();
  if (!cardId) {
    return NextResponse.json({ error: "Card id is required." }, { status: 400 });
  }

  const status = body.status;
  const adminNoteRaw = body.admin_note;
  const adminTagsRaw = body.admin_tags;

  if (status && !STATUS_VALUES.has(status)) {
    return NextResponse.json({ error: "Invalid status value." }, { status: 400 });
  }
  const adminNote =
    typeof adminNoteRaw === "string"
      ? adminNoteRaw.trim().slice(0, 2000)
      : adminNoteRaw === null
      ? null
      : undefined;
  const adminTags =
    Array.isArray(adminTagsRaw)
      ? adminTagsRaw
          .map((v) => String(v).trim())
          .filter((v) => v.length > 0)
          .slice(0, 20)
      : adminTagsRaw === null
      ? null
      : undefined;

  const patch: Record<string, unknown> = {
    reviewed_by_user_id: user.id,
    reviewed_at: new Date().toISOString(),
  };

  const admin = createAdminClient();
  if (status) {
    const currentRes = await admin
      .from("dating_1on1_cards")
      .select("id,status")
      .eq("id", cardId)
      .maybeSingle();
    if (currentRes.error) {
      console.error("[PATCH /api/dating/1on1/cards/[id]] status fetch failed", currentRes.error);
      return NextResponse.json({ error: "Failed to validate status transition." }, { status: 500 });
    }
    if (!currentRes.data) {
      return NextResponse.json({ error: "Card not found." }, { status: 404 });
    }
    const currentStatus = String(currentRes.data.status);
    const allowed = ALLOWED_TRANSITIONS[currentStatus] ?? new Set<string>();
    if (!allowed.has(status)) {
      return NextResponse.json(
        { error: `Invalid status transition: ${currentStatus} -> ${status}` },
        { status: 400 }
      );
    }
    patch.status = status;
  }
  if (adminNote !== undefined) patch.admin_note = adminNote;
  if (adminTags !== undefined) patch.admin_tags = adminTags;
  const { data, error } = await admin
    .from("dating_1on1_cards")
    .update(patch)
    .eq("id", cardId)
    .select("id,status,admin_note,admin_tags,reviewed_by_user_id,reviewed_at")
    .maybeSingle();

  if (error) {
    console.error("[PATCH /api/dating/1on1/cards/[id]] failed", error);
    return NextResponse.json({ error: "Failed to update card." }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Card not found." }, { status: 404 });
  }

  return NextResponse.json({ ok: true, item: data });
}
