import { isAllowedAdminUser } from "@/lib/admin";
import { ensureAllowedMutationOrigin } from "@/lib/request-origin";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function sanitizeText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function sanitizeInstagramUrl(value: unknown) {
  const raw = sanitizeText(value, 300);
  if (!raw) return "";
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withScheme);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host !== "instagram.com") return "";
    return url.toString().slice(0, 300);
  } catch {
    return "";
  }
}

function isMissingColumnError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = String((error as { code?: unknown }).code ?? "");
  const message = String((error as { message?: unknown }).message ?? "").toLowerCase();
  return code === "42703" || code === "PGRST204" || message.includes("column") || message.includes("instagram_url");
}

function toSortOrder(value: unknown) {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : 0;
  return Number.isFinite(n) ? Math.round(n) : 0;
}

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return isAllowedAdminUser(user?.id, user?.email);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = ensureAllowedMutationOrigin(req);
  if (originError) return originError;
  if (!(await requireAdmin())) return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });

  const { id } = await params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const title = sanitizeText(body?.title, 80);
  const description = sanitizeText(body?.description, 300);
  const instagramUrl = sanitizeInstagramUrl(body?.instagram_url);
  const status = body?.status === "hidden" ? "hidden" : "active";
  const sortOrder = toSortOrder(body?.sort_order);

  if (!title) return NextResponse.json({ error: "제목을 입력해 주세요." }, { status: 400 });

  const admin = createAdminClient();
  let res = await admin
    .from("reels_dating_listings")
    .update({
      title,
      description,
      instagram_url: instagramUrl,
      status,
      sort_order: sortOrder,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("id,title,description,instagram_url,status,sort_order,created_at,updated_at")
    .single();

  if (res.error && isMissingColumnError(res.error)) {
    res = await admin
      .from("reels_dating_listings")
      .update({
        title,
        description,
        status,
        sort_order: sortOrder,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("id,title,description,status,sort_order,created_at,updated_at")
      .single();
    if (res.data) res.data = { ...res.data, instagram_url: "" };
  }

  if (res.error) {
    console.error("[PATCH /api/admin/dating/reels/[id]] failed", res.error);
    return NextResponse.json({ error: "릴스 매물 수정에 실패했습니다." }, { status: 500 });
  }

  return NextResponse.json({ item: res.data });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = ensureAllowedMutationOrigin(req);
  if (originError) return originError;
  if (!(await requireAdmin())) return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });

  const { id } = await params;
  const res = await createAdminClient().from("reels_dating_listings").delete().eq("id", id);

  if (res.error) {
    console.error("[DELETE /api/admin/dating/reels/[id]] failed", res.error);
    return NextResponse.json({ error: "릴스 매물 삭제에 실패했습니다." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
