"use client";

import { useEffect, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const MAX_IMAGES = 3;
const MAX_FILE_SIZE = 5 * 1024 * 1024;

export default function EditPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const load = async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.replace(`/login?redirect=/community/${id}/edit`);
        return;
      }

      const res = await fetch(`/api/posts/${id}`);
      if (!res.ok) {
        router.replace("/community");
        return;
      }

      const { post } = await res.json();

      if (post.user_id !== user.id) {
        router.replace(`/community/${id}`);
        return;
      }

      if (!["free", "bodycheck"].includes(post.type)) {
        router.replace(`/community/${id}`);
        return;
      }

      setTitle(post.title ?? "");
      setContent(post.content ?? "");
      setImages(post.images ?? []);
      setLoading(false);
    };

    load();
  }, [id, router]);

  // textarea 자동 높이
  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = el.scrollHeight + "px";
    }
  }, [content]);

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
        setError(`${file.name}: 5MB 이하만 가능합니다.`);
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
          setError(data.error ?? "업로드 실패");
        }
      } catch {
        setError("업로드 중 오류가 발생했습니다.");
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

    setSaving(true);
    setError("");

    try {
      const res = await fetch(`/api/posts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          content: content.trim() || null,
          images,
        }),
      });

      const data = await res.json();

      if (res.ok) {
        setToast("수정되었습니다!");
        setTimeout(() => router.push(`/community/${id}`), 800);
      } else {
        setError(data.error ?? "수정에 실패했습니다.");
        setSaving(false);
      }
    } catch {
      setError("네트워크 오류가 발생했습니다.");
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <main className="max-w-md mx-auto px-4 py-10">
        <p className="text-neutral-400 text-center">로딩 중...</p>
      </main>
    );
  }

  return (
    <main className="max-w-md mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-neutral-900 mb-6">글 수정</h1>

      <form onSubmit={handleSubmit} className="space-y-4">
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
            ref={textareaRef}
            id="content"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="내용을 입력하세요"
            maxLength={2000}
            className="w-full min-h-[150px] rounded-xl border border-neutral-300 bg-white p-3 text-neutral-900 resize-none focus:outline-none focus:ring-2 focus:ring-emerald-500 overflow-hidden"
          />
          <p className="text-xs text-neutral-400 mt-1 text-right">
            {content.length}/2000
          </p>
        </div>

        {/* 이미지 */}
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
                    alt={`이미지 ${i + 1}`}
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

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => router.back()}
            className="flex-1 min-h-[52px] rounded-xl bg-neutral-100 text-neutral-700 font-medium"
          >
            취소
          </button>
          <button
            type="submit"
            disabled={saving || uploading}
            className="flex-1 min-h-[52px] rounded-xl bg-emerald-600 text-white font-medium hover:bg-emerald-700 active:scale-[0.98] transition-all disabled:opacity-50"
          >
            {saving ? "저장 중..." : "저장하기"}
          </button>
        </div>
      </form>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-neutral-900 text-white px-5 py-3 rounded-xl text-sm font-medium shadow-lg z-50 animate-[fadeIn_0.3s]">
          {toast}
        </div>
      )}
    </main>
  );
}
