export type PostType =
  | "1rm"
  | "lifts"
  | "helltest"
  | "photo_bodycheck"
  | "free";

export type BodycheckGender = "male" | "female";
export type BodycheckRating = "great" | "good" | "normal" | "rookie";

export interface Profile {
  id: string;
  user_id: string;
  nickname: string;
  role: "user" | "admin";
  created_at: string;
}

export interface BodycheckSummary {
  score_sum: number;
  vote_count: number;
  great_count: number;
  good_count: number;
  normal_count: number;
  rookie_count: number;
  average_score: number;
}

export interface Post {
  id: string;
  user_id: string;
  type: PostType;
  title: string;
  content: string | null;
  payload_json: Record<string, unknown> | null;
  images?: string[];
  gender?: BodycheckGender | null;
  score_sum?: number;
  vote_count?: number;
  great_count?: number;
  good_count?: number;
  normal_count?: number;
  rookie_count?: number;
  is_hidden: boolean;
  created_at: string;
  profiles?: { nickname: string; role?: string } | null;
  comment_count?: number;
  bodycheck_summary?: BodycheckSummary;
  my_vote?: { rating: BodycheckRating; score: number } | null;
}

export interface Comment {
  id: string;
  post_id: string;
  user_id: string;
  content: string;
  is_hidden: boolean;
  created_at: string;
  profiles?: { nickname: string } | null;
}

export interface Report {
  id: string;
  target_type: "post" | "comment";
  target_id: string;
  reporter_id: string;
  reason: string;
  resolved: boolean;
  created_at: string;
}

export const POST_TYPE_LABELS: Record<PostType, string> = {
  "1rm": "1RM",
  lifts: "3대 합계",
  helltest: "헬창 판독기",
  photo_bodycheck: "사진 몸평",
  free: "자유",
};

export const POST_TYPE_ICONS: Record<PostType, string> = {
  lifts: "🏆",
  "1rm": "🏋️",
  helltest: "🧪",
  photo_bodycheck: "📸",
  free: "💬",
};

export const POST_TYPE_COLORS: Record<PostType, string> = {
  "1rm": "bg-emerald-100 text-emerald-700",
  lifts: "bg-rose-100 text-rose-700",
  helltest: "bg-amber-100 text-amber-700",
  photo_bodycheck: "bg-indigo-100 text-indigo-700",
  free: "bg-neutral-100 text-neutral-700",
};

export const BODYCHECK_RATINGS: {
  rating: BodycheckRating;
  label: string;
  score: number;
}[] = [
  { rating: "great", label: "매우 좋아요", score: 3 },
  { rating: "good", label: "좋아요", score: 2 },
  { rating: "normal", label: "보통", score: 1 },
  { rating: "rookie", label: "헬린이", score: 0 },
];

export const BODYCHECK_SCORE_MAP: Record<BodycheckRating, number> = {
  great: 3,
  good: 2,
  normal: 1,
  rookie: 0,
};

export function getUserBadge(posts: Post[]): { emoji: string; label: string } {
  const liftsPosts = posts.filter((p) => p.type === "lifts" && p.payload_json);
  if (liftsPosts.length === 0) return { emoji: "🥚", label: "입문자" };

  const maxTotal = Math.max(
    ...liftsPosts.map((p) => Number((p.payload_json as Record<string, number>)?.totalKg ?? 0)),
  );

  if (maxTotal >= 500) return { emoji: "🦍", label: "괴수" };
  if (maxTotal >= 300) return { emoji: "💪", label: "상급자" };
  return { emoji: "🥚", label: "입문자" };
}

export function getBadgeFromPayload(
  type: PostType,
  payload: Record<string, unknown> | null,
): { emoji: string; label: string } {
  if (!payload) return { emoji: "🥚", label: "입문자" };

  if (type === "lifts") {
    const total = Number(payload.totalKg ?? 0);
    if (total >= 500) return { emoji: "🦍", label: "괴수" };
    if (total >= 300) return { emoji: "💪", label: "상급자" };
  }

  if (type === "1rm") {
    const oneRm = Number(payload.oneRmKg ?? 0);
    if (oneRm >= 200) return { emoji: "🦍", label: "괴수" };
    if (oneRm >= 100) return { emoji: "💪", label: "상급자" };
  }

  if (type === "photo_bodycheck") {
    return { emoji: "📸", label: "사진 몸평" };
  }

  return { emoji: "🥚", label: "입문자" };
}

export function renderPayloadSummary(
  type: PostType,
  payload: Record<string, unknown> | null,
): string {
  if (!payload) return "";
  switch (type) {
    case "1rm":
      return `${payload.lift ?? ""} 1RM: ${payload.oneRmKg ?? "?"}kg (${payload.formula ?? ""})`;
    case "lifts":
      return `S${payload.squat ?? 0}/B${payload.bench ?? 0}/D${payload.deadlift ?? 0} = ${payload.totalKg ?? "?"}kg`;
    case "helltest":
      return `결과: ${payload.title ?? payload.resultTitle ?? "?"}`;
    case "photo_bodycheck":
      return `성별: ${payload.gender === "female" ? "여성" : "남성"}`;
    default:
      return "";
  }
}

export function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "방금 전";
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}일 전`;
  return `${Math.floor(d / 30)}개월 전`;
}

export function getBodycheckAverage(post: Pick<Post, "score_sum" | "vote_count">): number {
  const voteCount = Number(post.vote_count ?? 0);
  if (!voteCount) return 0;
  return Number((Number(post.score_sum ?? 0) / voteCount).toFixed(2));
}
