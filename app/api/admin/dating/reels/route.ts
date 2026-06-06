import { isAllowedAdminUser } from "@/lib/admin";
import { buildSignedImageUrl } from "@/lib/images";
import { ensureAllowedMutationOrigin } from "@/lib/request-origin";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function sanitizeText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function toSortOrder(value: unknown) {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : 0;
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function isMissingColumnError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = String((error as { code?: unknown }).code ?? "");
  const message = String((error as { message?: unknown }).message ?? "").toLowerCase();
  return code === "42703" || code === "PGRST204" || message.includes("could not find") || message.includes("column");
}

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { user, ok: isAllowedAdminUser(user?.id, user?.email) };
}

export async function GET() {
  const { ok } = await requireAdmin();
  if (!ok) return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });

  const admin = createAdminClient();
  const [listingsRes, initialAppsRes] = await Promise.all([
    admin
      .from("reels_dating_listings")
      .select("id,title,description,status,sort_order,created_at,updated_at")
      .order("sort_order", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(100),
    admin
      .from("reels_dating_applications")
      .select(
        "id,listing_id,applicant_user_id,applicant_display_nickname,age,height_cm,region,job,training_years,instagram_id,intro_text,photo_path,status,created_at"
      )
      .order("created_at", { ascending: false })
      .limit(300),
  ]);
  let appsRes: {
    data: Array<Record<string, unknown>> | null;
    error: { code?: string | null; message?: string | null } | null;
  } = initialAppsRes;

  if (appsRes.error && isMissingColumnError(appsRes.error)) {
    appsRes = await admin
      .from("reels_dating_applications")
      .select(
        "id,listing_id,applicant_user_id,applicant_display_nickname,age,height_cm,region,job,training_years,instagram_id,intro_text,status,created_at"
      )
      .order("created_at", { ascending: false })
      .limit(300);
  }

  if (listingsRes.error) {
    if (listingsRes.error.code === "42P01") return NextResponse.json({ items: [], applications: [] });
    console.error("[GET /api/admin/dating/reels] listings failed", listingsRes.error);
    return NextResponse.json({ error: "릴스 매물 목록을 불러오지 못했습니다." }, { status: 500 });
  }
  if (appsRes.error) {
    if (appsRes.error.code === "42P01") return NextResponse.json({ items: listingsRes.data ?? [], applications: [] });
    console.error("[GET /api/admin/dating/reels] applications failed", appsRes.error);
    return NextResponse.json({ error: "릴스 지원서를 불러오지 못했습니다." }, { status: 500 });
  }

  const applications = (appsRes.data ?? []).map((app) => ({
    ...app,
    photo_signed_url:
      typeof app.photo_path === "string" && app.photo_path
        ? buildSignedImageUrl("reels-dating-application-photos", app.photo_path)
        : null,
  }));

  return NextResponse.json({ items: listingsRes.data ?? [], applications });
}

export async function POST(req: Request) {
  const originError = ensureAllowedMutationOrigin(req);
  if (originError) return originError;

  const { user, ok } = await requireAdmin();
  if (!ok) return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const title = sanitizeText(body?.title, 80);
  const description = sanitizeText(body?.description, 300);
  const status = body?.status === "hidden" ? "hidden" : "active";
  const sortOrder = toSortOrder(body?.sort_order);

  if (!title) return NextResponse.json({ error: "제목을 입력해 주세요." }, { status: 400 });

  const admin = createAdminClient();
  const res = await admin
    .from("reels_dating_listings")
    .insert({
      title,
      description,
      status,
      sort_order: sortOrder,
      created_by_user_id: user?.id ?? null,
    })
    .select("id,title,description,status,sort_order,created_at,updated_at")
    .single();

  if (res.error) {
    console.error("[POST /api/admin/dating/reels] failed", res.error);
    return NextResponse.json({ error: "릴스 매물 생성에 실패했습니다." }, { status: 500 });
  }

  return NextResponse.json({ item: res.data }, { status: 201 });
}
