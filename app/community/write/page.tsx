"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const CATEGORIES = [
  { value: "free", label: "💬 자유글", desc: "자유로운 대화와 질문" },
  { value: "bodycheck", label: "📊 몸평가", desc: "사진과 함께 몸평가 요청" },
];

const MAX_IMAGES = 3;
const MAX_FILE_SIZE = 5 * 1024 * 1024;

export default function WritePage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);

  const [category, setCategory] = useState("free");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");

  useEffect(() => {
    createClient()
      .auth.getUser()
      .then(({ data: { user } }) => {
        if (!user) {
          router.replace("/login?redirect=/community/write");
          return;
        }
        setAuthChecked(true);
      });
  }, [router]);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (images.length + files.length > MAX_IMAGES) {
      setError(`이미지는 최대 ${MAX_IMAGES}장까지 업로드할 수 있습니다.`);
      return;
    }

    setUploading(true);
    setError("");

    for (const file of files) {
      if (file.size > MAX_FILE_SIZE) {
        setError(`${file.name}: 5MB 이하의 이미지만 업로드할 수 있습니다.`);
        continue;
      }

      const formData = new FormData();
      formData.append("file", file);

      try {
        const res = await fetch("/api/upload", {
          method: "POST",
          body: formData,
        });
        if (res.ok) {
          const { url } = await res.json();
          setImages((prev) => [...prev, url]);
        } else {
          const data = await res.json();
          setError(data.error ?? "이미지 업로드에 실패했습니다.");
        }
      } catch {
        setError("이미지 업로드 중 오류가 발생했습니다.");
      }
    }

    setUploading(false);
    e.target.value = "";
  };

  const removeImage = (index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  };

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

    try {
      const res = await fetch("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: category,
          title: title.trim(),
          content: content.trim() || null,
          images,
        }),
      });

      const data = await res.json();

      if (res.ok) {
        setToast("게시글이 등록되었습니다!");
        setTimeout(() => router.push(`/community/${data.id}`), 800);
      } else {
        setError(data.error ?? "오류가 발생했습니다.");
        setLoading(false);
      }
    } catch {
      setError("네트워크 오류가 발생했습니다.");
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
        {/* 카테고리 선택 */}
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-2">
            카테고리
          </label>
          <div className="grid grid-cols-2 gap-2">
            {CATEGORIES.map((c) => (
              <button
                key={c.value}
                type="button"
                onClick={() => setCategory(c.value)}
                className={`p-3 rounded-xl border-2 text-left transition-all ${
                  category === c.value
                    ? "border-emerald-500 bg-emerald-50"
                    : "border-neutral-200 bg-white hover:border-neutral-300"
                }`}
              >
                <span className="block text-sm font-medium">{c.label}</span>
                <span className="block text-xs text-neutral-500 mt-0.5">
                  {c.desc}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* 제목 */}
        <div>
          <label
            htmlFor="title"
            className="block text-sm font-medium text-neutral-700 mb-1"
          >
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
          <label
            htmlFor="content"
            className="block text-sm font-medium text-neutral-700 mb-1"
          >
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
          <p className="text-xs text-neutral-400 mt-1 text-right">
            {content.length}/2000
          </p>
        </div>

        {/* 이미지 업로드 */}
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-2">
            이미지 ({images.length}/{MAX_IMAGES})
          </label>

          {images.length > 0 && (
            <div className="flex gap-2 mb-2 overflow-x-auto pb-1">
              {images.map((url, i) => (
                <div
                  key={url}
                  className="relative shrink-0 w-20 h-20 rounded-lg overflow-hidden border border-neutral-200"
                >
                  <img
                    src={url}
                    alt={`업로드 ${i + 1}`}
                    className="w-full h-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => removeImage(i)}
                    className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/60 text-white text-xs flex items-center justify-center"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          {images.length < MAX_IMAGES && (
            <label className="flex items-center justify-center h-12 rounded-xl border border-dashed border-neutral-300 bg-neutral-50 text-sm text-neutral-500 cursor-pointer hover:border-emerald-400 hover:bg-emerald-50 transition-colors">
              {uploading ? "업로드 중..." : "📷 사진 추가"}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                multiple
                onChange={handleImageUpload}
                disabled={uploading}
                className="hidden"
              />
            </label>
          )}
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 rounded-xl p-3">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading || uploading}
          className="w-full min-h-[52px] rounded-xl bg-emerald-600 text-white font-medium hover:bg-emerald-700 active:scale-[0.98] transition-all disabled:opacity-50"
        >
          {loading ? "등록 중..." : "등록하기"}
        </button>
      </form>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-neutral-900 text-white px-5 py-3 rounded-xl text-sm font-medium shadow-lg z-50 animate-[fadeIn_0.3s]">
          {toast}
        </div>
      )}
    </main>
  );
}
