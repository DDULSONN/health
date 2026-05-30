import { isAllowedAdminUser } from "@/lib/admin";
import { containsProfanity } from "@/lib/moderation";
import { ensureAllowedMutationOrigin } from "@/lib/request-origin";
import { checkRouteRateLimit, extractClientIp } from "@/lib/request-rate-limit";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

const TABLE = "flirting_line_ideas";
const MAX_CONTENT_LENGTH = 120;

type IdeaRow = {
  id: string;
  user_id: string;
  content: string;
  created_at: string;
};

function cleanContent(value: unknown) {
  return String(value ?? "")
    .trim()
    .replace(/\s{3,}/g, " ")
    .slice(0, MAX_CONTENT_LENGTH);
}

async function getViewer() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return {
    supabase,
    user,
    isAdmin: isAllowedAdminUser(user?.id, user?.email),
  };
}

async function attachProfiles(rows: IdeaRow[], viewerId: string | null, isAdmin: boolean) {
  const admin = createAdminClient();
  const userIds = [...new Set(rows.map((row) => row.user_id).filter(Boolean))];
  const profileMap = new Map<string, { nickname: string | null }>();

  if (userIds.length > 0) {
    const { data: profiles, error } = await admin.from("profiles").select("user_id,nickname").in("user_id", userIds);
    if (error) {
      console.error("[flirting-ideas] profile load failed", error);
    }
    for (const profile of profiles ?? []) {
      profileMap.set(profile.user_id, { nickname: profile.nickname ?? null });
    }
  }

  return rows.map((row) => ({
    id: row.id,
    content: row.content,
    created_at: row.created_at,
    nickname: profileMap.get(row.user_id)?.nickname?.trim() || "익명",
    canDelete: Boolean(viewerId && (isAdmin || row.user_id === viewerId)),
  }));
}

export async function GET() {
  const { user, isAdmin } = await getViewer();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from(TABLE)
    .select("id,user_id,content,created_at")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    console.error("[GET /api/flirting-generator/ideas] failed", error);
    return NextResponse.json({ ideas: [], setupRequired: error.code === "42P01" }, { status: error.code === "42P01" ? 200 : 500 });
  }

  const ideas = await attachProfiles((data ?? []) as IdeaRow[], user?.id ?? null, isAdmin);
  return NextResponse.json({ ideas });
}

export async function POST(request: Request) {
  const originError = ensureAllowedMutationOrigin(request);
  if (originError) return originError;

  const { user, isAdmin } = await getViewer();
  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const rateLimit = await checkRouteRateLimit({
    requestId: crypto.randomUUID(),
    scope: "flirting-line-idea",
    userId: user.id,
    ip: extractClientIp(request),
    userLimitPerMin: 6,
    ipLimitPerMin: 30,
    path: "/api/flirting-generator/ideas",
  });
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: "잠시 후 다시 시도해주세요." }, { status: 429 });
  }

  const body = (await request.json().catch(() => ({}))) as { content?: unknown };
  const content = cleanContent(body.content);
  if (!content) {
    return NextResponse.json({ error: "대사 아이디어를 적어주세요." }, { status: 400 });
  }
  if (containsProfanity(content)) {
    return NextResponse.json({ error: "표현을 조금 순화해주세요." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from(TABLE)
    .insert({ user_id: user.id, content })
    .select("id,user_id,content,created_at")
    .single();

  if (error) {
    console.error("[POST /api/flirting-generator/ideas] failed", error);
    const message = error.code === "42P01" ? "아이디어 기능 준비가 필요합니다." : "저장에 실패했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const [idea] = await attachProfiles([data as IdeaRow], user.id, isAdmin);
  return NextResponse.json({ idea }, { status: 201 });
}
