import { isAllowedAdminUser } from "@/lib/admin";
import {
  buildAdminCardPreviewImageUrl,
  extractStorageObjectPathFromBuckets,
} from "@/lib/images";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

const DEFAULT_PAGE_SIZE = 24;
const MAX_PAGE_SIZE = 50;
const ACTIVE_STATUSES = ["public", "pending"] as const;

type ActiveCardStatus = (typeof ACTIVE_STATUSES)[number];
type CardSexFilter = "all" | "male" | "female";
type CardSort = "public_first" | "pending_first" | "newest" | "oldest";

type DatingCardRow = {
  id: string;
  owner_user_id: string;
  sex: "male" | "female";
  display_nickname: string | null;
  age: number | null;
  region: string | null;
  height_cm: number | null;
  job: string | null;
  training_years: number | null;
  strengths_text: string | null;
  ideal_type: string | null;
  instagram_id: string | null;
  total_3lift: number | null;
  percent_all: number | null;
  is_3lift_verified: boolean;
  photo_paths: string[] | null;
  blur_thumb_path: string | null;
  status: ActiveCardStatus;
  published_at: string | null;
  expires_at: string | null;
  created_at: string;
};

type DatingCardFallbackRow = Pick<
  DatingCardRow,
  | "id"
  | "owner_user_id"
  | "sex"
  | "age"
  | "region"
  | "height_cm"
  | "job"
  | "training_years"
  | "ideal_type"
  | "total_3lift"
  | "percent_all"
  | "is_3lift_verified"
  | "status"
  | "created_at"
>;

type ProfileRow = {
  user_id: string;
  nickname: string | null;
  is_banned: boolean | null;
};

const FULL_CARD_SELECT =
  "id, owner_user_id, sex, display_nickname, age, region, height_cm, job, training_years, strengths_text, ideal_type, instagram_id, total_3lift, percent_all, is_3lift_verified, photo_paths, blur_thumb_path, status, published_at, expires_at, created_at";
const FALLBACK_CARD_SELECT =
  "id, owner_user_id, sex, age, region, height_cm, job, training_years, ideal_type, total_3lift, percent_all, is_3lift_verified, status, created_at";

function getErrorCode(error: unknown) {
  if (!error || typeof error !== "object") return "";
  return String((error as { code?: unknown }).code ?? "");
}

function parsePositiveInteger(value: string | null, fallback: number, maximum?: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return maximum ? Math.min(parsed, maximum) : parsed;
}

function parseSex(value: string | null): CardSexFilter {
  return value === "male" || value === "female" ? value : "all";
}

function parseSort(value: string | null): CardSort {
  return value === "pending_first" || value === "newest" || value === "oldest" ? value : "public_first";
}

function toAdminCardPhotoPath(raw: unknown): string | null {
  const path = extractStorageObjectPathFromBuckets(raw, ["dating-card-photos", "dating-photos"]);
  return path || null;
}

function buildAdminCardPreviewUrls(photoPaths: string[] | null): string[] {
  if (!Array.isArray(photoPaths)) return [];

  return [
    ...new Set(
      photoPaths
        .map((path) => toAdminCardPhotoPath(path))
        .filter((path): path is string => Boolean(path))
        .map((path) => buildAdminCardPreviewImageUrl(path, { width: 720, quality: 68 }))
        .filter((url): url is string => Boolean(url))
    ),
  ].slice(0, 2);
}

function normalizeFallbackRows(rows: DatingCardFallbackRow[]): DatingCardRow[] {
  return rows.map((card) => ({
    ...card,
    display_nickname: null,
    strengths_text: null,
    instagram_id: null,
    photo_paths: [],
    blur_thumb_path: null,
    published_at: null,
    expires_at: null,
  }));
}

export async function GET(req: Request) {
  const { user } = await getRequestAuthContext(req);

  if (!user || !isAllowedAdminUser(user.id, user.email)) {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  }

  const url = new URL(req.url);
  const requestedPage = parsePositiveInteger(url.searchParams.get("page"), 1);
  const pageSize = parsePositiveInteger(url.searchParams.get("pageSize"), DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const sex = parseSex(url.searchParams.get("sex"));
  const sort = parseSort(url.searchParams.get("sort"));
  const adminClient = createAdminClient();

  const countStatus = async (status: ActiveCardStatus) => {
    let query = adminClient.from("dating_cards").select("id", { count: "exact", head: true }).eq("status", status);
    if (sex !== "all") query = query.eq("sex", sex);
    const result = await query;
    if (result.error) throw result.error;
    return result.count ?? 0;
  };

  const fetchSlice = async (
    statuses: readonly ActiveCardStatus[],
    from: number,
    to: number,
    ascending: boolean
  ): Promise<DatingCardRow[]> => {
    if (to < from) return [];

    const runQuery = async (select: string) => {
      let query = adminClient.from("dating_cards").select(select).in("status", [...statuses]);
      if (sex !== "all") query = query.eq("sex", sex);
      return query.order("created_at", { ascending }).range(from, to);
    };

    const result = await runQuery(FULL_CARD_SELECT);
    if (!result.error) return (result.data ?? []) as unknown as DatingCardRow[];
    if (getErrorCode(result.error) !== "42703") throw result.error;

    const fallback = await runQuery(FALLBACK_CARD_SELECT);
    if (fallback.error) throw fallback.error;
    return normalizeFallbackRows((fallback.data ?? []) as unknown as DatingCardFallbackRow[]);
  };

  try {
    const [publicCount, pendingCount] = await Promise.all([countStatus("public"), countStatus("pending")]);
    const total = publicCount + pendingCount;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(requestedPage, totalPages);
    const offset = (page - 1) * pageSize;
    let rows: DatingCardRow[] = [];

    if (sort === "newest" || sort === "oldest") {
      rows = await fetchSlice(ACTIVE_STATUSES, offset, offset + pageSize - 1, sort === "oldest");
    } else {
      const primaryStatus: ActiveCardStatus = sort === "pending_first" ? "pending" : "public";
      const secondaryStatus: ActiveCardStatus = primaryStatus === "public" ? "pending" : "public";
      const primaryCount = primaryStatus === "public" ? publicCount : pendingCount;
      const ascending = sort === "pending_first";
      let remaining = pageSize;

      if (offset < primaryCount) {
        const primaryRows = await fetchSlice(
          [primaryStatus],
          offset,
          Math.min(primaryCount - 1, offset + remaining - 1),
          ascending
        );
        rows.push(...primaryRows);
        remaining -= primaryRows.length;
      }

      if (remaining > 0) {
        const secondaryOffset = Math.max(0, offset - primaryCount);
        rows.push(...(await fetchSlice([secondaryStatus], secondaryOffset, secondaryOffset + remaining - 1, ascending)));
      }
    }

    const userIds = [...new Set(rows.map((card) => card.owner_user_id))];
    let profileRows: ProfileRow[] = [];
    if (userIds.length > 0) {
      const profiles = await adminClient.from("profiles").select("user_id, nickname, is_banned").in("user_id", userIds);
      if (!profiles.error) {
        profileRows = (profiles.data ?? []) as ProfileRow[];
      } else if (getErrorCode(profiles.error) === "42703") {
        const fallbackProfiles = await adminClient.from("profiles").select("user_id, nickname").in("user_id", userIds);
        if (!fallbackProfiles.error) {
          profileRows = (fallbackProfiles.data ?? []).map((profile) => ({ ...profile, is_banned: false })) as ProfileRow[];
        }
      }
    }

    const nickMap = Object.fromEntries(profileRows.map((profile) => [profile.user_id, profile.nickname]));
    const bannedMap = Object.fromEntries(profileRows.map((profile) => [profile.user_id, profile.is_banned === true]));
    const cards = rows.map((card) => ({
      ...card,
      owner_nickname: nickMap[card.owner_user_id] ?? null,
      owner_is_banned: bannedMap[card.owner_user_id] === true,
      admin_preview_urls: card.status === "public" ? buildAdminCardPreviewUrls(card.photo_paths) : [],
    }));

    return NextResponse.json(
      {
        cards,
        pagination: {
          page,
          pageSize,
          total,
          totalPages,
          publicCount,
          pendingCount,
          hasPrevious: page > 1,
          hasNext: page < totalPages,
        },
      },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    console.error("[GET /api/dating/cards/admin/overview] failed", error);
    return NextResponse.json({ error: "공개·대기 오픈카드를 불러오지 못했습니다." }, { status: 500 });
  }
}
