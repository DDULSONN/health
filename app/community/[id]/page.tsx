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
import VerifiedBadge from "@/components/VerifiedBadge";

type ReportTarget = { type: "post" | "comment"; id: string } | null;

export default function PostDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [post, setPost] = useState<Post | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentText, setCommentText] = useState("");
  const [replyFor, setReplyFor] = useState<string | null>(null);
  const [replyTextByParent, setReplyTextByParent] = useState<Record<string, string>>({});

  const [userId, setUserId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(null);
  const [voteLoading, setVoteLoading] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [reportTarget, setReportTarget] = useState<ReportTarget>(null);
  const [reportReason, setReportReason] = useState("");
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [weeklyWinCount, setWeeklyWinCount] = useState(0);
  const [viewTracked, setViewTracked] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    (async () => {
      const [{ data: auth }, adminRes] = await Promise.all([
        supabase.auth.getUser(),
        fetch("/api/admin/me", { cache: "no-store" }).catch(() => null),
      ]);
      setUserId(auth.user?.id ?? null);
      if (adminRes?.ok) {
        const adminBody = (await adminRes.json()) as { isAdmin?: boolean };
        setIsAdmin(Boolean(adminBody.isAdmin));
      }
    })();
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
      const res = await fetch(`/api/posts/${id}`, { cache: "no-store" });
      if (!res.ok) {
        setPost(null);
        setComments([]);
        return;
      }
      const data = (await res.json()) as { post: Post; comments: Comment[] };
      setPost(data.post);
      setComments(data.comments ?? []);
    } catch {
      setPost(null);
      setComments([]);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadPost();
  }, [loadPost]);

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const res = await fetch(`/api/weekly-winners/post/${id}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { total_wins?: number };
        setWeeklyWinCount(Number(data.total_wins ?? 0));
      } catch {
        setWeeklyWinCount(0);
      }
    })();
  }, [id]);

  useEffect(() => {
    if (!post || post.type !== "photo_bodycheck" || viewTracked) return;
    (async () => {
      try {
        await fetch("/api/daily-missions/track", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "view_bodycheck" }),
        });
      } finally {
        setViewTracked(true);
      }
    })();
  }, [post, viewTracked]);

  const isOwner = userId && post && userId === post.user_id;
  const canVote = post?.type === "photo_bodycheck" && !!userId && !isOwner;
  const canEdit = isOwner && post && ["free", "photo_bodycheck"].includes(post.type);

  const commentTree = useMemo(() => {
    const roots: Comment[] = [];
    const children = new Map<string, Comment[]>();

    for (const c of comments) {
      if (!c.parent_id) {
        roots.push(c);
      } else {
        const list = children.get(c.parent_id) ?? [];
        list.push(c);
        children.set(c.parent_id, list);
      }
    }

    roots.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    for (const list of children.values()) {
      list.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    }

    return { roots, children };
  }, [comments]);

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

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  };

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
        showToast(data.error ?? "평가 반영에 실패했습니다.");
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
      showToast("평가가 반영되었습니다.");
    } catch {
      showToast("평가 중 오류가 발생했습니다.");
    } finally {
      setVoteLoading(false);
    }
  };

  const submitComment = async (content: string, parentId?: string) => {
    const trimmed = content.trim();
    if (!trimmed) return;

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
        body: JSON.stringify({ post_id: id, content: trimmed, parent_id: parentId ?? null }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "댓글 작성에 실패했습니다.");
        return;
      }

      if (parentId) {
        setReplyTextByParent((prev) => ({ ...prev, [parentId]: "" }));
        setReplyFor(null);
      } else {
        setCommentText("");
      }
      await loadPost();
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setPosting(false);
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    if (!userId) {
      router.push(`/login?redirect=/community/${id}`);
      return;
    }

    setDeletingCommentId(commentId);
    try {
      const res = await fetch(`/api/comments/${commentId}`, { method: "DELETE" });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        showToast(data.error ?? "댓글 삭제에 실패했습니다.");
        return;
      }
      await loadPost();
      showToast("댓글이 삭제되었습니다.");
    } catch {
      showToast("댓글 삭제 중 오류가 발생했습니다.");
    } finally {
      setDeletingCommentId(null);
    }
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
    showToast(res.ok ? "신고가 접수되었습니다." : "신고 접수에 실패했습니다.");
  };

  const handleToggleHidden = async () => {
    if (!post) return;
    const res = await fetch(`/api/admin/posts/${post.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_hidden: !post.is_hidden }),
    });
    if (res.ok) {
      showToast(post.is_hidden ? "게시글이 공개되었습니다." : "게시글이 숨김 처리되었습니다.");
      loadPost();
    }
  };

  const confirmDeletePost = async () => {
    const res = await fetch(`/api/posts/${id}`, { method: "DELETE" });
    if (res.ok) {
      showToast("게시글이 삭제되었습니다.");
      setTimeout(() => router.push("/community"), 700);
    } else {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      showToast(data.error ?? "게시글 삭제에 실패했습니다.");
    }
    setDeleteConfirm(false);
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
        <Link href="/community" className="text-emerald-600 hover:underline text-sm">
          목록으로
        </Link>
      </main>
    );
  }

  const badge = getBadgeFromPayload(post.type, post.payload_json);
  const icon = POST_TYPE_ICONS[post.type];
  const postImages = post.images ?? [];

  return (
    <main className="max-w-2xl mx-auto px-4 py-6">
      <Link
        href={post.type === "photo_bodycheck" ? "/community/bodycheck" : "/community"}
        className="text-sm text-neutral-500 hover:text-neutral-700 mb-4 inline-flex items-center min-h-[44px]"
      >
        ← 목록으로
      </Link>

      <article className="rounded-2xl bg-white border border-neutral-200 p-4 mb-5">
        <div className="flex items-center gap-2 mb-3">
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${POST_TYPE_COLORS[post.type]}`}>
            {icon} {POST_TYPE_LABELS[post.type]}
          </span>
          {post.type === "photo_bodycheck" && (
            <span className="text-xs text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-full">
              {post.gender === "female" ? "여성" : "남성"}
            </span>
          )}
          <span className="text-xs text-neutral-400">{timeAgo(post.created_at)}</span>

          <div className="ml-auto flex items-center gap-1">
            {(isOwner || isAdmin) && (
              <div className="relative">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpen((prev) => !prev);
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
                      onClick={() => {
                        setMenuOpen(false);
                        setDeleteConfirm(true);
                      }}
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
            <p className="text-sm text-neutral-700">{renderPayloadSummary(post.type, post.payload_json)}</p>
          </div>
        )}

        {post.content && <p className="text-sm text-neutral-700 whitespace-pre-wrap">{post.content}</p>}

        {postImages.length > 0 && (
          <div className={`mt-4 grid gap-2 ${postImages.length === 1 ? "grid-cols-1" : postImages.length === 2 ? "grid-cols-2" : "grid-cols-3"}`}>
            {postImages.map((url, i) => (
              <button
                key={url}
                type="button"
                onClick={() => setLightboxIdx(i)}
                className="rounded-xl overflow-hidden border border-neutral-100 aspect-square"
              >
                <img src={url} alt={`이미지 ${i + 1}`} className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 mt-4">
          <span title={badge.label}>{badge.emoji}</span>
          {weeklyWinCount > 0 && (
            <span className="text-xs font-semibold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
              이번 주 몸짱
            </span>
          )}
          <span className="text-xs text-neutral-500">{post.profiles?.nickname ?? "닉네임 없음"}</span>
          <VerifiedBadge total={post.cert_summary?.total} />
        </div>

        {post.type === "photo_bodycheck" && summary && (
          <section className="mt-5 pt-4 border-t border-neutral-100">
            <h2 className="text-sm font-semibold text-neutral-800 mb-2">사진 몸평 평가</h2>
            {isOwner && <p className="text-xs text-neutral-500 mb-2">본인 게시글은 평가할 수 없습니다.</p>}
            {!userId && <p className="text-xs text-neutral-500 mb-2">로그인하면 평가할 수 있습니다.</p>}
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
              <p>매우 좋아요: {summary.greatCount}</p>
              <p>좋아요: {summary.goodCount}</p>
              <p>보통: {summary.normalCount}</p>
              <p>노력중: {summary.rookieCount}</p>
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
        <h2 className="text-sm font-semibold text-neutral-700 mb-3">댓글 {comments.length}개</h2>

        {commentTree.roots.length > 0 && (
          <div className="space-y-3 mb-4">
            {commentTree.roots.map((root) => {
              const replies = commentTree.children.get(root.id) ?? [];
              return (
                <div key={root.id} className="space-y-2">
                  <CommentCard
                    comment={root}
                    userId={userId}
                    isAdmin={isAdmin}
                    deleting={deletingCommentId === root.id}
                    onDelete={() => handleDeleteComment(root.id)}
                    onReport={() => setReportTarget({ type: "comment", id: root.id })}
                    onReply={() => setReplyFor((prev) => (prev === root.id ? null : root.id))}
                    showReplyButton
                  />

                  {replyFor === root.id && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void submitComment(replyTextByParent[root.id] ?? "", root.id);
                      }}
                      className="ml-6 flex gap-2"
                    >
                      <input
                        type="text"
                        value={replyTextByParent[root.id] ?? ""}
                        onChange={(e) =>
                          setReplyTextByParent((prev) => ({ ...prev, [root.id]: e.target.value }))
                        }
                        placeholder="답글을 입력하세요"
                        className="flex-1 min-h-[42px] rounded-xl border border-neutral-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                      <button
                        type="submit"
                        disabled={posting || !(replyTextByParent[root.id] ?? "").trim()}
                        className="px-3 min-h-[42px] rounded-xl bg-emerald-600 text-white text-sm font-medium disabled:opacity-50"
                      >
                        등록
                      </button>
                    </form>
                  )}

                  {replies.map((reply) => (
                    <div key={reply.id} className="ml-6 border-l border-neutral-200 pl-3">
                      <CommentCard
                        comment={reply}
                        userId={userId}
                        isAdmin={isAdmin}
                        deleting={deletingCommentId === reply.id}
                        onDelete={() => handleDeleteComment(reply.id)}
                        onReport={() => setReportTarget({ type: "comment", id: reply.id })}
                      />
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submitComment(commentText);
          }}
          className="flex gap-2"
        >
          <input
            type="text"
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            placeholder={userId ? "댓글을 입력해 주세요" : "로그인 후 댓글을 작성할 수 있습니다"}
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
            <h3 className="font-bold text-neutral-900 mb-2">게시글을 삭제할까요?</h3>
            <p className="text-sm text-neutral-500 mb-4">삭제 후에는 목록에서 보이지 않습니다.</p>
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
                onClick={confirmDeletePost}
                className="flex-1 min-h-[44px] rounded-xl bg-red-600 text-white text-sm font-medium"
              >
                삭제
              </button>
            </div>
          </div>
        </div>
      )}

      {lightboxIdx !== null && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={() => setLightboxIdx(null)}>
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
              ×
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
              placeholder="신고 사유를 입력해 주세요"
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

function CommentCard({
  comment,
  userId,
  isAdmin,
  deleting,
  onDelete,
  onReport,
  onReply,
  showReplyButton = false,
}: {
  comment: Comment;
  userId: string | null;
  isAdmin: boolean;
  deleting: boolean;
  onDelete: () => void;
  onReport: () => void;
  onReply?: () => void;
  showReplyButton?: boolean;
}) {
  const isOwner = !!userId && comment.user_id === userId;
  const canDelete = isOwner || isAdmin;
  const isDeleted = !!comment.deleted_at;

  return (
    <div className="rounded-xl bg-white border border-neutral-100 p-3">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-medium text-neutral-700">{comment.profiles?.nickname ?? "익명"}</span>
        <VerifiedBadge total={comment.cert_summary?.total} className="inline-flex items-center rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700" />
        <span className="text-xs text-neutral-400">{timeAgo(comment.created_at)}</span>
        <div className="ml-auto flex items-center gap-2">
          {showReplyButton && !isDeleted && onReply && (
            <button
              type="button"
              onClick={onReply}
              className="text-xs text-neutral-500 hover:text-neutral-700 min-h-[32px] px-1"
            >
              답글 달기
            </button>
          )}
          <button
            type="button"
            onClick={onReport}
            className="text-xs text-neutral-400 hover:text-red-500 min-h-[32px] px-1"
          >
            신고
          </button>
          {canDelete && (
            <button
              type="button"
              onClick={onDelete}
              disabled={deleting}
              className="text-xs text-red-500 hover:text-red-600 min-h-[32px] px-1 disabled:opacity-50"
            >
              삭제
            </button>
          )}
        </div>
      </div>

      {isDeleted ? (
        <p className="text-sm text-neutral-400 italic">삭제된 댓글입니다.</p>
      ) : (
        <p className="text-sm text-neutral-800 whitespace-pre-wrap">{comment.content}</p>
      )}
    </div>
  );
}
