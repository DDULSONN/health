"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import {
  BODYCHECK_RATINGS,
  POST_TYPE_LABELS,
  POST_TYPE_COLORS,
  POST_TYPE_ICONS,
  renderPayloadSummary,
  getBadgeFromPayload,
  timeAgo,
  type Post,
  type Comment,
  type BodycheckRating,
} from "@/lib/community";

export default function PostDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [post, setPost] = useState<Post | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentText, setCommentText] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [voteLoading, setVoteLoading] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [reportTarget, setReportTarget] = useState<{
    type: "post" | "comment";
    id: string;
  } | null>(null);
  const [reportReason, setReportReason] = useState("");
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      setUserId(user?.id ?? null);
      if (user) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("role")
          .eq("user_id", user.id)
          .single();
        setIsAdmin(profile?.role === "admin");
      }
    });
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [menuOpen]);

  const loadPost = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/posts/${id}`);
      if (res.ok) {
        const data = await res.json();
        setPost(data.post);
        setComments(data.comments);
      }
    } catch (e) {
      console.error("Post load error:", e);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    loadPost();
  }, [loadPost]);

  const isOwner = userId && post && userId === post.user_id;
  const canVote =
    post?.type === "photo_bodycheck" && !!userId && !isOwner;
  const canEdit = isOwner && post && ["free", "photo_bodycheck"].includes(post.type);

  const summary = useMemo(() => {
    if (post?.type !== "photo_bodycheck") return null;
    const voteCount = Number(post.bodycheck_summary?.vote_count ?? post.vote_count ?? 0);
    const scoreSum = Number(post.bodycheck_summary?.score_sum ?? post.score_sum ?? 0);
    const average = voteCount > 0 ? Number((scoreSum / voteCount).toFixed(2)) : 0;
    return {
      voteCount,
      average,
      greatCount: Number(post.bodycheck_summary?.great_count ?? post.great_count ?? 0),
      goodCount: Number(post.bodycheck_summary?.good_count ?? post.good_count ?? 0),
      normalCount: Number(post.bodycheck_summary?.normal_count ?? post.normal_count ?? 0),
      rookieCount: Number(post.bodycheck_summary?.rookie_count ?? post.rookie_count ?? 0),
    };
  }, [post]);

  const handleVote = async (rating: BodycheckRating) => {
    if (!post) return;
    if (!userId) {
      router.push(`/login?redirect=/community/${id}`);
      return;
    }

    setVoteLoading(true);
    try {
      const res = await fetch(`/api/posts/${id}/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating }),
      });
      const data = await res.json();

      if (!res.ok) {
        setToast(data.error ?? "평가 반영에 실패했습니다.");
        return;
      }

      setPost((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          my_vote: {
            rating,
            score: BODYCHECK_RATINGS.find((r) => r.rating === rating)?.score ?? 0,
          },
          bodycheck_summary: data.summary ?? prev.bodycheck_summary,
          score_sum: data.summary?.score_sum ?? prev.score_sum,
          vote_count: data.summary?.vote_count ?? prev.vote_count,
          great_count: data.summary?.great_count ?? prev.great_count,
          good_count: data.summary?.good_count ?? prev.good_count,
          normal_count: data.summary?.normal_count ?? prev.normal_count,
          rookie_count: data.summary?.rookie_count ?? prev.rookie_count,
        };
      });
      setToast("평가가 반영되었습니다.");
    } catch {
      setToast("평가 중 오류가 발생했습니다.");
    } finally {
      setVoteLoading(false);
    }
  };

  const handleComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentText.trim()) return;

    if (!userId) {
      router.push(`/login?redirect=/community/${id}`);
      return;
    }

    setPosting(true);
    setError("");
    try {
      const res = await fetch("/api/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ post_id: id, content: commentText.trim() }),
      });

      if (res.ok) {
        setCommentText("");
        loadPost();
      } else {
        const data = await res.json();
        setError(data.error ?? "오류가 발생했습니다.");
      }
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    }
    setPosting(false);
  };

  const handleReport = async () => {
    if (!reportTarget || !reportReason.trim()) return;
    if (!userId) {
      router.push(`/login?redirect=/community/${id}`);
      return;
    }

    const res = await fetch("/api/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        target_type: reportTarget.type,
        target_id: reportTarget.id,
        reason: reportReason.trim(),
      }),
    });

    setReportTarget(null);
    setReportReason("");
    showToast(
      res.ok
        ? "신고가 접수되었습니다."
        : ((await res.json()).error ?? "신고 접수에 실패했습니다.")
    );
  };

  const handleToggleHidden = async () => {
    if (!post) return;
    const res = await fetch(`/api/admin/posts/${post.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_hidden: !post.is_hidden }),
    });
    if (res.ok) {
      showToast(post.is_hidden ? "게시글을 공개했습니다." : "게시글을 숨겼습니다.");
      loadPost();
    }
  };

  const handleDelete = () => {
    setMenuOpen(false);
    setDeleteConfirm(true);
  };

  const confirmDelete = async () => {
    const res = await fetch(`/api/posts/${id}`, { method: "DELETE" });
    if (res.ok) {
      showToast("게시글을 삭제했습니다.");
      setTimeout(() => router.push("/community"), 800);
    } else {
      const data = await res.json();
      showToast(data.error ?? "삭제에 실패했습니다.");
    }
    setDeleteConfirm(false);
  };

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  };

  if (loading) {
    return (
      <main className="max-w-2xl mx-auto px-4 py-10">
        <p className="text-neutral-400 text-center">로딩 중...</p>
      </main>
    );
  }

  if (!post) {
    return (
      <main className="max-w-2xl mx-auto px-4 py-10 text-center">
        <p className="text-neutral-500 mb-4">게시글을 찾을 수 없습니다.</p>
        <Link
          href="/community"
          className="text-emerald-600 hover:underline text-sm"
        >
          목록으로
        </Link>
      </main>
    );
  }

  const badge = getBadgeFromPayload(post.type, post.payload_json);
  const icon = POST_TYPE_ICONS[post.type];
  const postImages = post.images ?? [];

  return (
    <main className="max-w-2xl mx-auto px-4 py-8">
      <Link
        href={post.type === "photo_bodycheck" ? "/community/bodycheck" : "/community"}
        className="text-sm text-neutral-500 hover:text-neutral-700 mb-4 inline-flex items-center min-h-[44px]"
      >
        ← 목록으로
      </Link>

      <article className="rounded-2xl bg-white border border-neutral-200 p-5 mb-6">
        <div className="flex items-center gap-2 mb-3">
          <span
            className={`px-2 py-0.5 rounded-full text-xs font-medium ${POST_TYPE_COLORS[post.type]}`}
          >
            {icon} {POST_TYPE_LABELS[post.type]}
          </span>
          {post.type === "photo_bodycheck" && (
            <span className="text-xs text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-full">
              {post.gender === "female" ? "여성" : "남성"}
            </span>
          )}
          <span className="text-xs text-neutral-400">
            {timeAgo(post.created_at)}
          </span>

          <div className="ml-auto flex items-center gap-1">
            {(isOwner || isAdmin) && (
              <div className="relative">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpen(!menuOpen);
                  }}
                  className="w-10 h-10 flex items-center justify-center text-neutral-400 hover:text-neutral-600 rounded-lg hover:bg-neutral-50"
                >
                  ⋯
                </button>
                {menuOpen && (
                  <div
                    className="absolute right-0 top-full mt-1 bg-white rounded-xl shadow-lg border border-neutral-200 py-1 z-10 min-w-[120px]"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => router.push(`/community/${post.id}/edit`)}
                        className="w-full px-4 py-2.5 text-sm text-left text-neutral-700 hover:bg-neutral-50"
                      >
                        수정
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleDelete}
                      className="w-full px-4 py-2.5 text-sm text-left text-red-600 hover:bg-red-50"
                    >
                      삭제
                    </button>
                  </div>
                )}
              </div>
            )}
            <button
              type="button"
              onClick={() => setReportTarget({ type: "post", id: post.id })}
              className="text-xs text-neutral-400 hover:text-red-500 min-h-[44px] flex items-center px-2"
            >
              신고
            </button>
          </div>
        </div>

        <h1 className="text-lg font-bold text-neutral-900 mb-2">{post.title}</h1>

        {post.payload_json && post.type !== "photo_bodycheck" && (
          <div className="rounded-xl bg-neutral-50 p-3 mb-3">
            <p className="text-sm text-neutral-700">
              {renderPayloadSummary(post.type, post.payload_json)}
            </p>
          </div>
        )}

        {post.content && (
          <p className="text-sm text-neutral-700 whitespace-pre-wrap">{post.content}</p>
        )}

        {postImages.length > 0 && (
          <div
            className={`mt-4 grid gap-2 ${
              postImages.length === 1
                ? "grid-cols-1"
                : postImages.length === 2
                ? "grid-cols-2"
                : "grid-cols-3"
            }`}
          >
            {postImages.map((url, i) => (
              <button
                key={url}
                type="button"
                onClick={() => setLightboxIdx(i)}
                className="rounded-xl overflow-hidden border border-neutral-100 aspect-square"
              >
                <img
                  src={url}
                  alt={`이미지 ${i + 1}`}
                  className="w-full h-full object-cover"
                />
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 mt-4">
          <span title={badge.label}>{badge.emoji}</span>
          <span className="text-xs text-neutral-500">
            {post.profiles?.nickname ?? "알 수 없음"}
          </span>
        </div>

        {post.type === "photo_bodycheck" && summary && (
          <section className="mt-5 pt-4 border-t border-neutral-100">
            <h2 className="text-sm font-semibold text-neutral-800 mb-2">사진 몸평 평가</h2>
            {isOwner && (
              <p className="text-xs text-neutral-500 mb-2">
                본인 글은 평가할 수 없습니다.
              </p>
            )}
            {!userId && (
              <p className="text-xs text-neutral-500 mb-2">
                로그인 후 평가할 수 있습니다.
              </p>
            )}
            <div className="grid grid-cols-2 gap-2">
              {BODYCHECK_RATINGS.map((option) => {
                const active = post.my_vote?.rating === option.rating;
                return (
                  <button
                    key={option.rating}
                    type="button"
                    disabled={!canVote || voteLoading}
                    onClick={() => handleVote(option.rating)}
                    className={`min-h-[44px] rounded-xl border text-sm font-medium transition ${
                      active
                        ? "border-indigo-500 bg-indigo-600 text-white"
                        : "border-neutral-300 bg-white text-neutral-700"
                    } disabled:opacity-50`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
            <div className="mt-3 text-xs text-neutral-600 grid grid-cols-2 gap-y-1">
              <p>매우 좋다: {summary.greatCount}</p>
              <p>좋다: {summary.goodCount}</p>
              <p>평범: {summary.normalCount}</p>
              <p>헬린이: {summary.rookieCount}</p>
            </div>
            <p className="mt-2 text-sm font-medium text-indigo-700">
              평균 {summary.average.toFixed(2)} / 투표 {summary.voteCount}
            </p>
          </section>
        )}

        {isAdmin && (
          <div className="mt-4 pt-3 border-t border-neutral-100 flex gap-2">
            <button
              type="button"
              onClick={handleToggleHidden}
              className="px-3 min-h-[40px] rounded-lg text-xs font-medium bg-amber-100 text-amber-700 hover:bg-amber-200"
            >
              {post.is_hidden ? "공개하기" : "숨기기"}
            </button>
          </div>
        )}
      </article>

      <section>
        <h2 className="text-sm font-semibold text-neutral-700 mb-3">
          댓글 {comments.length}개
        </h2>

        {comments.length > 0 && (
          <div className="space-y-2 mb-4">
            {comments.map((c) => (
              <div
                key={c.id}
                className="rounded-xl bg-white border border-neutral-100 p-3"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-medium text-neutral-700">
                    {c.profiles?.nickname ?? "?"}
                  </span>
                  <span className="text-xs text-neutral-400">
                    {timeAgo(c.created_at)}
                  </span>
                  <button
                    type="button"
                    onClick={() => setReportTarget({ type: "comment", id: c.id })}
                    className="ml-auto text-xs text-neutral-400 hover:text-red-500 min-h-[44px] flex items-center px-2"
                  >
                    신고
                  </button>
                </div>
                <p className="text-sm text-neutral-800">{c.content}</p>
              </div>
            ))}
          </div>
        )}

        <form onSubmit={handleComment} className="flex gap-2">
          <input
            type="text"
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            placeholder={
              userId
                ? "댓글을 입력해주세요..."
                : "로그인 후 댓글을 작성할 수 있습니다"
            }
            className="flex-1 min-h-[44px] rounded-xl border border-neutral-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
          <button
            type="submit"
            disabled={posting || !commentText.trim()}
            className="px-4 min-h-[44px] rounded-xl bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 shrink-0"
          >
            작성
          </button>
        </form>
        {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
      </section>

      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-5 max-w-sm w-full">
            <h3 className="font-bold text-neutral-900 mb-2">
              게시글을 삭제할까요?
            </h3>
            <p className="text-sm text-neutral-500 mb-4">
              삭제한 글은 목록에서 보이지 않지만 마이페이지에서 삭제 기록은 확인할 수 있습니다.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setDeleteConfirm(false)}
                className="flex-1 min-h-[44px] rounded-xl bg-neutral-100 text-neutral-700 text-sm font-medium"
              >
                취소
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                className="flex-1 min-h-[44px] rounded-xl bg-red-600 text-white text-sm font-medium"
              >
                삭제
              </button>
            </div>
          </div>
        </div>
      )}

      {lightboxIdx !== null && (
        <div
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
          onClick={() => setLightboxIdx(null)}
        >
          <div className="relative max-w-full max-h-full">
            <img
              src={postImages[lightboxIdx]}
              alt={`이미지 ${lightboxIdx + 1}`}
              className="max-w-full max-h-[85vh] object-contain rounded-lg"
              onClick={(e) => e.stopPropagation()}
            />
            <button
              type="button"
              onClick={() => setLightboxIdx(null)}
              className="absolute -top-3 -right-3 w-8 h-8 rounded-full bg-white text-neutral-900 text-lg flex items-center justify-center shadow-md"
            >
              X
            </button>
          </div>
        </div>
      )}

      {reportTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-5 max-w-sm w-full">
            <h3 className="font-bold text-neutral-900 mb-3">신고하기</h3>
            <textarea
              value={reportReason}
              onChange={(e) => setReportReason(e.target.value)}
              placeholder="신고 사유를 입력해주세요"
              rows={3}
              className="w-full rounded-xl border border-neutral-300 p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-emerald-500 mb-3"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setReportTarget(null);
                  setReportReason("");
                }}
                className="flex-1 min-h-[44px] rounded-xl bg-neutral-100 text-neutral-700 text-sm font-medium"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleReport}
                disabled={!reportReason.trim()}
                className="flex-1 min-h-[44px] rounded-xl bg-red-600 text-white text-sm font-medium disabled:opacity-50"
              >
                신고
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-neutral-900 text-white px-5 py-3 rounded-xl text-sm font-medium shadow-lg z-50">
          {toast}
        </div>
      )}
    </main>
  );
}
