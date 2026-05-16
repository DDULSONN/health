import { NextResponse } from "next/server";
import { requireAdminRoute } from "@/lib/admin-route";
import { buildSignedImageUrl } from "@/lib/images";
import { ensureAllowedMutationOrigin } from "@/lib/request-origin";
import { checkRouteRateLimit, extractClientIp } from "@/lib/request-rate-limit";

const BUCKET = "community-fit-room";
const MAX_FILE_SIZE = 6 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const ENTRY_LIMIT = 80;
const COMMENTS_PER_ENTRY = 8;

type AdminClient = Extract<Awaited<ReturnType<typeof requireAdminRoute>>, { ok: true }>["admin"];
type FitRoomKind = "workout" | "diet" | "body";

type EntryRow = {
  id: string;
  user_id: string;
  kind: FitRoomKind;
  caption: string;
  image_path: string;
  expires_at: string;
  created_at: string;
};

type CommentRow = {
  id: string;
  entry_id: string;
  user_id: string;
  content: string;
  created_at: string;
};

type ReactionRow = {
  entry_id: string;
  user_id: string;
  reaction: "up" | "down";
};

type ProfileRow = {
  user_id: string;
  nickname: string | null;
  is_banned?: boolean | null;
};

function cleanText(value: unknown, maxLength: number) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function parseKind(value: unknown): FitRoomKind {
  return value === "diet" || value === "body" || value === "workout" ? value : "workout";
}

function isMissingFitRoomTable(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = String((error as { code?: unknown }).code ?? "");
  const message = String((error as { message?: unknown }).message ?? "").toLowerCase();
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    message.includes("community_fit_room") ||
    message.includes("could not find the table") ||
    message.includes("does not exist") ||
    message.includes("schema cache")
  );
}

async function ensureBucket(admin: AdminClient) {
  const { error } = await admin.storage.createBucket(BUCKET, {
    public: false,
    fileSizeLimit: MAX_FILE_SIZE,
    allowedMimeTypes: [...ALLOWED_TYPES],
  });
  if (error && !/already exists|already owned/i.test(error.message)) {
    console.warn("[fit-room] bucket ensure failed", error.message);
  }
}

function profileLabel(profile?: ProfileRow | null, fallbackUserId?: string) {
  return profile?.nickname?.trim() || (fallbackUserId ? `회원 ${fallbackUserId.slice(0, 8)}` : "익명");
}

export async function GET() {
  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;

  const admin = auth.admin;
  const nowIso = new Date().toISOString();

  const { data: entries, error: entryError } = await admin
    .from("community_fit_room_entries")
    .select("id,user_id,kind,caption,image_path,expires_at,created_at")
    .is("deleted_at", null)
    .gt("expires_at", nowIso)
    .order("created_at", { ascending: false })
    .limit(ENTRY_LIMIT);

  if (entryError) {
    if (isMissingFitRoomTable(entryError)) {
      return NextResponse.json({
        ok: true,
        setupRequired: true,
        viewer: {
          loggedIn: true,
          userId: auth.user.id,
          isAdmin: true,
        },
        featured: null,
        items: [],
        liveComments: [],
        serverTime: nowIso,
      });
    }
    console.error("[GET /api/community/fit-room] entries failed", entryError);
    return NextResponse.json({ error: "인증방을 불러오지 못했습니다." }, { status: 500 });
  }

  const visibleEntries = (entries ?? []) as EntryRow[];
  const entryIds = visibleEntries.map((entry) => entry.id);

  const [reactionRes, commentRes, myReactionRes] = await Promise.all([
    entryIds.length
      ? admin.from("community_fit_room_reactions").select("entry_id,user_id,reaction").in("entry_id", entryIds)
      : Promise.resolve({ data: [] as ReactionRow[], error: null }),
    entryIds.length
      ? admin
          .from("community_fit_room_comments")
          .select("id,entry_id,user_id,content,created_at")
          .in("entry_id", entryIds)
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .limit(ENTRY_LIMIT * COMMENTS_PER_ENTRY)
      : Promise.resolve({ data: [] as CommentRow[], error: null }),
    entryIds.length
      ? admin.from("community_fit_room_reactions").select("entry_id,user_id,reaction").eq("user_id", auth.user.id).in("entry_id", entryIds)
      : Promise.resolve({ data: [] as ReactionRow[], error: null }),
  ]);

  if (reactionRes.error || commentRes.error || myReactionRes.error) {
    console.error("[GET /api/community/fit-room] child fetch failed", reactionRes.error ?? commentRes.error ?? myReactionRes.error);
    return NextResponse.json({ error: "인증방 반응을 불러오지 못했습니다." }, { status: 500 });
  }

  const comments = (commentRes.data ?? []) as CommentRow[];
  const reactions = (reactionRes.data ?? []) as ReactionRow[];
  const myReactions = (myReactionRes.data ?? []) as ReactionRow[];
  const userIds = [
    ...new Set([
      ...visibleEntries.map((entry) => entry.user_id),
      ...comments.map((comment) => comment.user_id),
    ]),
  ];
  const { data: profiles } = userIds.length
    ? await admin.from("profiles").select("user_id,nickname,is_banned").in("user_id", userIds)
    : { data: [] as ProfileRow[] };
  const profileMap = new Map((profiles ?? []).map((profile) => [profile.user_id, profile as ProfileRow]));

  const reactionSummary = new Map<string, { up: number; down: number; score: number }>();
  for (const row of reactions) {
    const current = reactionSummary.get(row.entry_id) ?? { up: 0, down: 0, score: 0 };
    if (row.reaction === "up") current.up += 1;
    if (row.reaction === "down") current.down += 1;
    current.score = current.up - current.down;
    reactionSummary.set(row.entry_id, current);
  }
  const myReactionMap = new Map(myReactions.map((row) => [row.entry_id, row.reaction]));
  const commentMap = new Map<string, CommentRow[]>();
  for (const comment of comments) {
    const bucket = commentMap.get(comment.entry_id) ?? [];
    if (bucket.length < COMMENTS_PER_ENTRY) bucket.push(comment);
    commentMap.set(comment.entry_id, bucket);
  }

  const items = visibleEntries.map((entry) => {
    const author = profileMap.get(entry.user_id);
    const summary = reactionSummary.get(entry.id) ?? { up: 0, down: 0, score: 0 };
    return {
      id: entry.id,
      kind: entry.kind,
      caption: entry.caption,
      imageUrl: buildSignedImageUrl(BUCKET, entry.image_path),
      createdAt: entry.created_at,
      expiresAt: entry.expires_at,
      canDelete: entry.user_id === auth.user.id,
      author: {
        userId: entry.user_id,
        nickname: profileLabel(author, entry.user_id),
        isBanned: Boolean(author?.is_banned),
      },
      reactions: {
        ...summary,
        mine: myReactionMap.get(entry.id) ?? null,
      },
      comments: (commentMap.get(entry.id) ?? [])
        .slice()
        .reverse()
        .map((comment) => {
          const commentAuthor = profileMap.get(comment.user_id);
          return {
            id: comment.id,
            content: comment.content,
            createdAt: comment.created_at,
            canDelete: comment.user_id === auth.user.id,
            author: {
              userId: comment.user_id,
              nickname: profileLabel(commentAuthor, comment.user_id),
              isBanned: Boolean(commentAuthor?.is_banned),
            },
          };
        }),
    };
  });

  const featured = [...items].sort((a, b) => {
    const scoreDiff = b.reactions.score - a.reactions.score;
    if (scoreDiff !== 0) return scoreDiff;
    return Date.parse(b.createdAt) - Date.parse(a.createdAt);
  })[0] ?? null;

  const liveComments = comments
    .slice(0, 20)
    .map((comment) => {
      const author = profileMap.get(comment.user_id);
      const entry = visibleEntries.find((item) => item.id === comment.entry_id);
      return {
        id: comment.id,
        entryId: comment.entry_id,
        content: comment.content,
        createdAt: comment.created_at,
        entryKind: entry?.kind ?? "workout",
        author: {
          userId: comment.user_id,
          nickname: profileLabel(author, comment.user_id),
          isBanned: Boolean(author?.is_banned),
        },
      };
    })
    .reverse();

  return NextResponse.json({
    ok: true,
    viewer: {
      loggedIn: true,
      userId: auth.user.id,
      isAdmin: true,
    },
    featured,
    items,
    liveComments,
    serverTime: nowIso,
  });
}

export async function POST(request: Request) {
  const originError = ensureAllowedMutationOrigin(request);
  if (originError) return originError;

  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;

  const requestId = crypto.randomUUID();
  const ip = extractClientIp(request);
  const rateLimit = await checkRouteRateLimit({
    requestId,
    scope: "community-fit-room-entry",
    userId: auth.user.id,
    ip,
    userLimitPerMin: 6,
    ipLimitPerMin: 30,
    path: "/api/community/fit-room",
  });
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: "업로드 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." }, { status: 429 });
  }

  const form = await request.formData();
  const file = form.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "사진을 선택해 주세요." }, { status: 400 });
  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json({ error: "JPG, PNG, WebP 사진만 올릴 수 있습니다." }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "사진은 6MB 이하로 올려 주세요." }, { status: 400 });
  }

  const kind = parseKind(form.get("kind"));
  const caption = cleanText(form.get("caption"), 180);
  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const imagePath = `${auth.user.id}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${ext}`;
  const admin = auth.admin;

  await ensureBucket(admin);
  const buffer = Buffer.from(await file.arrayBuffer());
  const uploadRes = await admin.storage.from(BUCKET).upload(imagePath, buffer, {
    contentType: file.type,
    upsert: false,
  });
  if (uploadRes.error) {
    console.error("[POST /api/community/fit-room] upload failed", uploadRes.error);
    return NextResponse.json({ error: "사진 업로드에 실패했습니다." }, { status: 500 });
  }

  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const insertRes = await admin
    .from("community_fit_room_entries")
    .insert({
      user_id: auth.user.id,
      kind,
      caption,
      image_path: imagePath,
      expires_at: expiresAt,
    })
    .select("id")
    .single();

  if (insertRes.error) {
    await admin.storage.from(BUCKET).remove([imagePath]);
    if (isMissingFitRoomTable(insertRes.error)) {
      return NextResponse.json(
        { error: "인증방 DB가 아직 적용되지 않았습니다. supabase/sql/community_fit_room.sql을 먼저 실행해 주세요." },
        { status: 503 }
      );
    }
    console.error("[POST /api/community/fit-room] insert failed", insertRes.error);
    return NextResponse.json({ error: "인증 등록에 실패했습니다." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id: insertRes.data.id });
}
