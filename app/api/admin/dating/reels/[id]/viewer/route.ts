import { isAllowedAdminUser } from "@/lib/admin";
import { notifyDatingUser } from "@/lib/dating-notifications";
import { ensureAllowedMutationOrigin } from "@/lib/request-origin";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const ACCESS_DURATION_MS = 72 * 60 * 60 * 1000;

function isMissingColumnError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = String((error as { code?: unknown }).code ?? "");
  return code === "42703" || code === "PGRST204";
}

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return isAllowedAdminUser(user?.id, user?.email);
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = ensureAllowedMutationOrigin(req);
  if (originError) return originError;
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  }

  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { user_id?: unknown } | null;
  const userId = typeof body?.user_id === "string" ? body.user_id.trim() : "";
  if (!userId) {
    return NextResponse.json({ error: "열람할 회원을 선택해 주세요." }, { status: 400 });
  }

  const admin = createAdminClient();
  const [listingRes, profileRes] = await Promise.all([
    admin.from("reels_dating_listings").select("id").eq("id", id).maybeSingle(),
    admin.from("profiles").select("user_id,nickname").eq("user_id", userId).maybeSingle(),
  ]);
  if (listingRes.error || !listingRes.data) {
    return NextResponse.json({ error: "릴스 매물을 찾지 못했습니다." }, { status: 404 });
  }
  if (profileRes.error || !profileRes.data) {
    return NextResponse.json({ error: "회원을 찾지 못했습니다." }, { status: 404 });
  }

  const expiresAt = new Date(Date.now() + ACCESS_DURATION_MS).toISOString();
  const updateRes = await admin
    .from("reels_dating_listings")
    .update({
      viewer_user_id: userId,
      viewer_access_expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("id,viewer_user_id,viewer_access_expires_at")
    .single();

  if (updateRes.error) {
    console.error("[POST /api/admin/dating/reels/[id]/viewer] failed", updateRes.error);
    const message = isMissingColumnError(updateRes.error)
      ? "릴스 매물 열람 기능 SQL을 먼저 적용해 주세요."
      : "릴스 매물 열람 권한을 열지 못했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  await notifyDatingUser(admin, {
    userId,
    type: "dating_reels_access",
    title: "릴스 매물 신청을 확인해 보세요",
    body: "마이페이지에서 내 매물에 들어온 신청을 72시간 동안 볼 수 있어요.",
    route: "/mypage?section=reels_dating",
    meta: {
      listing_id: id,
      access_expires_at: expiresAt,
    },
  });

  return NextResponse.json({
    item: {
      ...updateRes.data,
      viewer_nickname: profileRes.data.nickname ?? null,
    },
  });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = ensureAllowedMutationOrigin(req);
  if (originError) return originError;
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  }

  const { id } = await params;
  const updateRes = await createAdminClient()
    .from("reels_dating_listings")
    .update({
      viewer_user_id: null,
      viewer_access_expires_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (updateRes.error) {
    console.error("[DELETE /api/admin/dating/reels/[id]/viewer] failed", updateRes.error);
    const message = isMissingColumnError(updateRes.error)
      ? "릴스 매물 열람 기능 SQL을 먼저 적용해 주세요."
      : "릴스 매물 열람 권한을 회수하지 못했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
