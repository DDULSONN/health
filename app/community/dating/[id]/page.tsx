"use client";

import { useCallback, useEffect, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

type CardDetail = {
  id: string;
  sex: string;
  display_nickname: string;
  age: number;
  thumb_url: string;
  is_blur_fallback?: boolean;
  height_cm: number;
  training_years?: number;
  ideal_type?: string | null;
  total_3lift?: number;
  percent_all?: number;
  has_sbd?: boolean;
};

type Comment = {
  id: string;
  user_id: string;
  content: string | null;
  deleted_at: string | null;
  created_at: string;
  nickname: string;
  is_mine: boolean;
};

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "방금";
  if (mins < 60) return `${mins}분 전`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}일 전`;
  return new Date(dateStr).toLocaleDateString("ko-KR");
}

export default function DatingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [card, setCard] = useState<CardDetail | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);

  const [commentText, setCommentText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    createClient()
      .auth.getUser()
      .then(({ data: { user } }) => setUserId(user?.id ?? null));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/dating/${id}`);
      if (!res.ok) {
        router.replace("/community/dating");
        return;
      }
      const data = await res.json();
      setCard(data.card);
      setComments(data.comments ?? []);
    } catch {
      router.replace("/community/dating");
    }
    setLoading(false);
  }, [id, router]);

  useEffect(() => {
    queueMicrotask(() => {
      void load();
    });
  }, [load]);

  const handleSubmitComment = async () => {
    const trimmed = commentText.trim();
    if (!trimmed) return;
    setSubmitting(true);
    setError("");

    try {
      const res = await fetch("/api/dating/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ application_id: id, content: trimmed }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? "댓글 작성에 실패했습니다.");
        setSubmitting(false);
        return;
      }

      setCommentText("");
      await load();
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    }
    setSubmitting(false);
  };

  const handleDeleteComment = async (commentId: string) => {
    if (!confirm("댓글을 삭제하시겠습니까?")) return;
    try {
      await fetch(`/api/dating/comments/${commentId}`, { method: "DELETE" });
      await load();
    } catch {
      alert("삭제에 실패했습니다.");
    }
  };

  if (loading) {
    return (
      <main className="max-w-2xl mx-auto px-4 py-10">
        <p className="text-neutral-400 text-center py-10">로딩 중...</p>
      </main>
    );
  }

  if (!card) return null;

  return (
    <main className="max-w-2xl mx-auto px-4 py-6">
      {/* 뒤로가기 */}
      <Link
        href="/community/dating"
        className="inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-700 mb-4"
      >
        <svg
          className="w-4 h-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        목록으로
      </Link>

      {/* 카드 상세 */}
      <div className="rounded-2xl border border-neutral-200 bg-white overflow-hidden mb-6">
        {card.thumb_url ? (
          <div className="relative w-full overflow-hidden bg-neutral-100 min-h-[240px] md:min-h-[280px]">
            <img
              src={card.thumb_url}
              alt=""
              className={`w-full h-full absolute inset-0 object-cover ${card.is_blur_fallback ? "scale-110 blur-md" : "blur-sm scale-105"}`}
            />
          </div>
        ) : (
          <div className="w-full min-h-[240px] md:min-h-[280px] bg-neutral-100 flex items-center justify-center text-5xl">
            {card.sex === "male" ? "🏋️" : "💘"}
          </div>
        )}

        <div className="p-5">
          <h2 className="text-xl font-bold text-neutral-900 mb-1">
            {card.display_nickname}
          </h2>
          <div className="flex flex-wrap items-center gap-2 text-sm text-neutral-600">
            <span>{card.age}세</span>
            <span className="text-neutral-300">|</span>
            <span>{card.height_cm}cm</span>
          </div>
          {card.training_years != null && (
            <p className="text-xs text-neutral-500 mt-1">운동경력 {card.training_years}년</p>
          )}

          {/* 성별별 정보 */}
          <div className="flex flex-wrap gap-2 mt-3">
            {card.sex === "male" && (
              <>
                {card.total_3lift != null && (
                  <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-rose-100 text-rose-700">
                    3대 {card.total_3lift}kg
                  </span>
                )}
                {card.percent_all != null && (
                  <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                    상위 {card.percent_all}%
                  </span>
                )}
              </>
            )}
            {card.sex === "female" && card.has_sbd && (
              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-pink-100 text-pink-700">
                SBD 입력
              </span>
            )}
          </div>

          {!!card.ideal_type?.trim() && (
            <div className="mt-4 rounded-xl border border-pink-100 bg-pink-50 p-3">
              <p className="text-sm font-semibold text-pink-700">💘 이상형</p>
              <p className="mt-1 text-sm text-neutral-700 whitespace-pre-wrap break-words">
                {card.ideal_type}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* 댓글 섹션 */}
      <section>
        <h3 className="text-base font-bold text-neutral-800 mb-3">
          댓글 ({comments.length})
        </h3>

        {/* 댓글 입력 */}
        {userId ? (
          <div className="mb-4">
            <textarea
              ref={textareaRef}
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              placeholder="댓글을 입력하세요 (연락처/SNS 정보 입력 불가)"
              maxLength={500}
              rows={2}
              className="w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-pink-300 focus:border-pink-300"
            />
            {error && (
              <p className="text-xs text-red-500 mt-1">{error}</p>
            )}
            <div className="flex items-center justify-between mt-2">
              <span className="text-xs text-neutral-400">
                {commentText.length}/500
              </span>
              <button
                type="button"
                onClick={handleSubmitComment}
                disabled={submitting || !commentText.trim()}
                className="px-4 py-2 rounded-xl bg-pink-500 text-white text-sm font-medium hover:bg-pink-600 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] transition-all"
              >
                {submitting ? "등록 중..." : "등록"}
              </button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-neutral-400 mb-4">
            댓글을 작성하려면{" "}
            <Link href="/login" className="text-pink-500 underline">
              로그인
            </Link>
            이 필요합니다.
          </p>
        )}

        {/* 댓글 목록 */}
        {comments.length === 0 ? (
          <p className="text-sm text-neutral-400 text-center py-6">
            아직 댓글이 없습니다. 첫 댓글을 남겨보세요!
          </p>
        ) : (
          <div className="space-y-3">
            {comments.map((c) => (
              <div
                key={c.id}
                className="rounded-xl bg-neutral-50 border border-neutral-100 p-3"
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-neutral-800">
                      {c.nickname}
                    </span>
                    <span className="text-xs text-neutral-400">
                      {timeAgo(c.created_at)}
                    </span>
                  </div>
                  {c.is_mine && !c.deleted_at && (
                    <button
                      type="button"
                      onClick={() => handleDeleteComment(c.id)}
                      className="text-xs text-neutral-400 hover:text-red-500 transition-colors"
                    >
                      삭제
                    </button>
                  )}
                </div>
                {c.deleted_at ? (
                  <p className="text-sm text-neutral-400 italic">
                    삭제된 댓글입니다.
                  </p>
                ) : (
                  <p className="text-sm text-neutral-700 whitespace-pre-wrap break-words">
                    {c.content}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
