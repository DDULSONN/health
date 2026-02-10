/** 커뮤니티 타입 정의 + 헬퍼 */

export type PostType = "1rm" | "lifts" | "helltest" | "bodycheck" | "free";

export interface Profile {
  id: string;
  user_id: string;
  nickname: string;
  role: "user" | "admin";
  created_at: string;
}

export interface Post {
  id: string;
  user_id: string;
  type: PostType;
  title: string;
  content: string | null;
  payload_json: Record<string, unknown> | null;
  is_hidden: boolean;
  created_at: string;
  profiles?: { nickname: string } | null;
  comment_count?: number;
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

/** 게시글 타입 → 한국어 라벨 */
export const POST_TYPE_LABELS: Record<PostType, string> = {
  "1rm": "1RM",
  lifts: "3대 합계",
  helltest: "판독기",
  bodycheck: "몸평가",
  free: "자유",
};

/** 게시글 타입 → 배경색 */
export const POST_TYPE_COLORS: Record<PostType, string> = {
  "1rm": "bg-emerald-100 text-emerald-700",
  lifts: "bg-rose-100 text-rose-700",
  helltest: "bg-amber-100 text-amber-700",
  bodycheck: "bg-purple-100 text-purple-700",
  free: "bg-neutral-100 text-neutral-700",
};

/** payload 요약 텍스트 생성 */
export function renderPayloadSummary(
  type: PostType,
  payload: Record<string, unknown> | null
): string {
  if (!payload) return "";
  switch (type) {
    case "1rm":
      return `${payload.lift ?? ""} 1RM: ${payload.oneRmKg ?? "?"}kg (${payload.formula ?? ""})`;
    case "lifts":
      return `3대 합계: ${payload.totalKg ?? "?"}kg${payload.ratio ? ` / ${payload.ratio}x` : ""}`;
    case "helltest":
      return `유형: ${payload.resultTitle ?? "?"}`;
    case "bodycheck":
      return `결과: ${payload.resultTitle ?? "?"}`;
    default:
      return "";
  }
}

/** 시간 경과 텍스트 */
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
