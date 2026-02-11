"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const CATEGORIES = [
  { value: "free", label: "자유글" },
  { value: "lifts", label: "3대 합계" },
  { value: "1rm", label: "1RM" },
  { value: "helltest", label: "헬창판독기" },
  { value: "bodycheck", label: "몸평가" },
];

export default function WritePage() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  const [category, setCategory] = useState("free");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");

  useEffect(() => {
    createClient().auth.getUser().then(({ data: { user } }) => {
      if (!user) {
        router.replace("/login?redirect=/community/write");
        return;
      }
      setUserId(user.id);
      setAuthChecked(true);
    });
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError("제목을 입력해주세요.");
      return;
    }
    if (category === "free" && !content.trim()) {
      setError("내용을 입력해주세요.");
      return;
    }

    setLoading(true);
    setError("");

    const res = await fetch("/api/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: category,
        title: title.trim(),
        content: content.trim() || null,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      setToast("게시글이 등록되었습니다!");
      setTimeout(() => router.push(`/community/${data.id}`), 800);
    } else {
      const data = await res.json();
      setError(data.error ?? "오류가 발생했습니다.");
      setLoading(false);
    }
  };

  if (!authChecked) {
    return (
      <main className="max-w-md mx-auto px-4 py-10">
        <p className="text-neutral-400 text-center">로딩 중...</p>
      </main>
    );
  }

  return (
    <main className="max-w-md mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-neutral-900 mb-6">글쓰기</h1>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* 카테고리 */}
        <div>
          <label htmlFor="category" className="block text-sm font-medium text-neutral-700 mb-1">
            카테고리
          </label>
          <select
            id="category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full h-12 rounded-xl border border-neutral-300 bg-white px-3 text-neutral-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>

        {/* 제목 */}
        <div>
          <label htmlFor="title" className="block text-sm font-medium text-neutral-700 mb-1">
            제목
          </label>
          <input
            id="title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="제목을 입력하세요"
            maxLength={100}
            className="w-full h-12 rounded-xl border border-neutral-300 bg-white px-3 text-neutral-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>

        {/* 내용 */}
        <div>
          <label htmlFor="content" className="block text-sm font-medium text-neutral-700 mb-1">
            내용
          </label>
          <textarea
            id="content"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="내용을 입력하세요"
            rows={6}
            maxLength={2000}
            className="w-full rounded-xl border border-neutral-300 bg-white p-3 text-neutral-900 resize-none focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
          <p className="text-xs text-neutral-400 mt-1 text-right">{content.length}/2000</p>
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 rounded-xl p-3">{error}</p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full min-h-[52px] rounded-xl bg-emerald-600 text-white font-medium hover:bg-emerald-700 active:scale-[0.98] transition-all disabled:opacity-50"
        >
          {loading ? "등록 중..." : "등록하기"}
        </button>
      </form>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-neutral-900 text-white px-5 py-3 rounded-xl text-sm font-medium shadow-lg z-50 animate-[fadeIn_0.3s]">
          {toast}
        </div>
      )}
    </main>
  );
}
