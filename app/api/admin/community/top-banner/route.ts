import { NextResponse } from "next/server";
import {
  COMMUNITY_TOP_BANNER_KEY,
  DEFAULT_COMMUNITY_TOP_BANNER,
  normalizeCommunityTopBanner,
} from "@/lib/community-top-banner";
import { requireAdminRoute } from "@/lib/admin-route";

function cleanText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function normalizeUrl(value: unknown) {
  const url = cleanText(value, 500);
  if (!url) return "";
  if (url.startsWith("/") || url.startsWith("https://") || url.startsWith("http://")) return url;
  return "";
}

function normalizeBody(body: Record<string, unknown>) {
  const title = cleanText(body.title, 80);
  const linkUrl = normalizeUrl(body.linkUrl);
  return {
    enabled: body.enabled === true && Boolean(title) && Boolean(linkUrl),
    title,
    description: cleanText(body.description, 160),
    cta: cleanText(body.cta, 30) || "자세히 보기",
    linkUrl,
  };
}

export async function GET() {
  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;

  const { data, error } = await auth.admin
    .from("site_settings")
    .select("value_json")
    .eq("key", COMMUNITY_TOP_BANNER_KEY)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "상단 안내를 불러오지 못했습니다.", detail: error.message }, { status: 500 });
  }

  return NextResponse.json(data ? normalizeCommunityTopBanner(data.value_json) : DEFAULT_COMMUNITY_TOP_BANNER);
}

export async function PATCH(req: Request) {
  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "설정 값이 올바르지 않습니다." }, { status: 400 });
  }

  const setting = normalizeBody(body as Record<string, unknown>);
  const { error } = await auth.admin.from("site_settings").upsert(
    {
      key: COMMUNITY_TOP_BANNER_KEY,
      value_json: setting,
      updated_at: new Date().toISOString(),
      updated_by: auth.user.id,
    },
    { onConflict: "key" },
  );

  if (error) {
    return NextResponse.json({ error: "상단 안내 저장에 실패했습니다.", detail: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, setting });
}
