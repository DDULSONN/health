"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import {
  POST_TYPE_LABELS,
  POST_TYPE_COLORS,
  renderPayloadSummary,
  timeAgo,
  type Post,
  type Comment,
} from "@/lib/community";

export default function PostDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [post, setPost] = useState<Post | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentText, setCommentText] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState("");
  const [reportTarget, setReportTarget] = useState<{ type: "post" | "comment"; id: string } | null>(null);
  const [reportReason, setReportReason] = useState("");

  useEffect(() => {
    createClient().auth.getUser().then(({ data: { user } }) => {
      setUserId(user?.id ?? null);
    });
  }, []);

  const loadPost = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/posts/${id}`);
    if (res.ok) {
      const data = await res.json();
      setPost(data.post);
      setComments(data.comments);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    loadPost();
  }, [loadPost]);

  const handleComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentText.trim()) return;

    if (!userId) {
      router.push(`/login?redirect=/community/${id}`);
      return;
    }

    setPosting(true);
    setError("");
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
    setPosting(false);
  };

  const handleReport = async () => {
    if (!reportTarget || !reportReason.trim()) return;
    if (!userId) {
      router.push(`/login?redirect=/community/${id}`);
      return;
    }

    await fetch("/api/reports", {
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
    alert("신고가 접수되었습니다.");
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

  return (
    <main className="max-w-2xl mx-auto px-4 py-8">
      <Link href="/community" className="text-sm text-neutral-500 hover:text-neutral-700 mb-4 inline-block">
        ← 목록으로
      </Link>

      {/* 게시글 */}
      <article className="rounded-2xl bg-white border border-neutral-200 p-5 mb-6">
        <div className="flex items-center gap-2 mb-3">
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${POST_TYPE_COLORS[post.type]}`}>
            {POST_TYPE_LABELS[post.type]}
          </span>
          <span className="text-xs text-neutral-400">{timeAgo(post.created_at)}</span>
          <button
            type="button"
            onClick={() => setReportTarget({ type: "post", id: post.id })}
            className="ml-auto text-xs text-neutral-400 hover:text-red-500"
          >
            신고
          </button>
        </div>

        <h1 className="text-lg font-bold text-neutral-900 mb-2">{post.title}</h1>

        {post.payload_json && (
          <div className="rounded-xl bg-neutral-50 p-3 mb-3">
            <p className="text-sm text-neutral-700">
              {renderPayloadSummary(post.type, post.payload_json)}
            </p>
          </div>
        )}

        {post.content && (
          <p className="text-sm text-neutral-700 whitespace-pre-wrap">{post.content}</p>
        )}

        <p className="text-xs text-neutral-400 mt-4">
          작성자: {post.profiles?.nickname ?? "알 수 없음"}
        </p>
      </article>

      {/* 댓글 */}
      <section>
        <h2 className="text-sm font-semibold text-neutral-700 mb-3">
          댓글 {comments.length}개
        </h2>

        {comments.length > 0 && (
          <div className="space-y-2 mb-4">
            {comments.map((c) => (
              <div key={c.id} className="rounded-xl bg-white border border-neutral-100 p-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-medium text-neutral-700">
                    {c.profiles?.nickname ?? "?"}
                  </span>
                  <span className="text-xs text-neutral-400">{timeAgo(c.created_at)}</span>
                  <button
                    type="button"
                    onClick={() => setReportTarget({ type: "comment", id: c.id })}
                    className="ml-auto text-xs text-neutral-400 hover:text-red-500"
                  >
                    신고
                  </button>
                </div>
                <p className="text-sm text-neutral-800">{c.content}</p>
              </div>
            ))}
          </div>
        )}

        {/* 댓글 입력 */}
        <form onSubmit={handleComment} className="flex gap-2">
          <input
            type="text"
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            placeholder={userId ? "댓글을 입력하세요..." : "로그인 후 댓글을 작성할 수 있습니다"}
            className="flex-1 h-10 rounded-xl border border-neutral-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
          <button
            type="submit"
            disabled={posting || !commentText.trim()}
            className="px-4 h-10 rounded-xl bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 shrink-0"
          >
            작성
          </button>
        </form>
        {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
      </section>

      {/* 신고 모달 */}
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
                onClick={() => { setReportTarget(null); setReportReason(""); }}
                className="flex-1 h-10 rounded-xl bg-neutral-100 text-neutral-700 text-sm font-medium"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleReport}
                disabled={!reportReason.trim()}
                className="flex-1 h-10 rounded-xl bg-red-600 text-white text-sm font-medium disabled:opacity-50"
              >
                신고
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
