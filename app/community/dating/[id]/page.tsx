"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

type CardDetail = {
  id: string;
  sex: "male" | "female";
  display_nickname: string;
  age: number;
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
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
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
        setError(data?.error ?? "Failed to submit comment.");
        setSubmitting(false);
        return;
      }

      setCommentText("");
      await load();
      textareaRef.current?.focus();
    } catch {
      setError("Network error.");
    }
    setSubmitting(false);
  };

  const handleDeleteComment = async (commentId: string) => {
    if (!confirm("Delete this comment?")) return;
    try {
      await fetch(`/api/dating/comments/${commentId}`, { method: "DELETE" });
      await load();
    } catch {
      alert("Delete failed.");
    }
  };

  if (loading) {
    return (
      <main className="max-w-2xl mx-auto px-4 py-10">
        <p className="text-neutral-400 text-center py-10">Loading...</p>
      </main>
    );
  }

  if (!card) return null;

  return (
    <main className="max-w-2xl mx-auto px-4 py-6">
      <Link
        href="/community/dating"
        className="inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-700 mb-4"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        {"\uBAA9\uB85D\uC73C\uB85C"}
      </Link>

      <div className="rounded-2xl border border-neutral-200 bg-white p-5 mb-6">
        <h2 className="text-xl font-bold text-neutral-900 mb-1">{card.display_nickname}</h2>
        <div className="flex flex-wrap items-center gap-2 text-sm text-neutral-600">
          <span>{card.age}y</span>
          <span className="text-neutral-300">|</span>
          <span>{card.height_cm}cm</span>
        </div>

        {card.training_years != null && (
          <p className="text-xs text-neutral-500 mt-1">Training {card.training_years}y</p>
        )}

        <div className="flex flex-wrap gap-2 mt-3">
          {card.sex === "male" && (
            <>
              {card.total_3lift != null && (
                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-rose-100 text-rose-700">
                  3-lift {card.total_3lift}kg
                </span>
              )}
              {card.percent_all != null && (
                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                  Top {card.percent_all}% KR
                </span>
              )}
            </>
          )}
          {card.sex === "female" && card.has_sbd && (
            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-pink-100 text-pink-700">SBD</span>
          )}
        </div>

        {!!card.ideal_type?.trim() && (
          <div className="mt-4 rounded-xl border border-pink-100 bg-pink-50 p-3">
            <p className="text-sm font-semibold text-pink-700">{"\uD83D\uDC98 \uC774\uC0C1\uD615"}</p>
            <p className="mt-1 text-sm text-neutral-700 whitespace-pre-wrap break-words">{card.ideal_type}</p>
          </div>
        )}
      </div>

      <section>
        <h3 className="text-base font-bold text-neutral-800 mb-3">Comments ({comments.length})</h3>

        {userId ? (
          <div className="mb-4">
            <textarea
              ref={textareaRef}
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              placeholder="Write a comment (no contacts / SNS IDs)"
              maxLength={500}
              rows={2}
              className="w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-pink-300 focus:border-pink-300"
            />
            {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
            <div className="flex items-center justify-between mt-2">
              <span className="text-xs text-neutral-400">{commentText.length}/500</span>
              <button
                type="button"
                onClick={handleSubmitComment}
                disabled={submitting || !commentText.trim()}
                className="px-4 py-2 rounded-xl bg-pink-500 text-white text-sm font-medium hover:bg-pink-600 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] transition-all"
              >
                {submitting ? "Posting..." : "Post"}
              </button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-neutral-400 mb-4">
            Login required to comment. <Link href="/login" className="text-pink-500 underline">Login</Link>
          </p>
        )}

        {comments.length === 0 ? (
          <p className="text-sm text-neutral-400 text-center py-6">No comments yet.</p>
        ) : (
          <div className="space-y-3">
            {comments.map((c) => (
              <div key={c.id} className="rounded-xl bg-neutral-50 border border-neutral-100 p-3">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-neutral-800">{c.nickname}</span>
                    <span className="text-xs text-neutral-400">{timeAgo(c.created_at)}</span>
                  </div>
                  {c.is_mine && !c.deleted_at && (
                    <button
                      type="button"
                      onClick={() => handleDeleteComment(c.id)}
                      className="text-xs text-neutral-400 hover:text-red-500 transition-colors"
                    >
                      Delete
                    </button>
                  )}
                </div>
                {c.deleted_at ? (
                  <p className="text-sm text-neutral-400 italic">Deleted comment.</p>
                ) : (
                  <p className="text-sm text-neutral-700 whitespace-pre-wrap break-words">{c.content}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
