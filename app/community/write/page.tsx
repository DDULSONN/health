"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { BodycheckGender } from "@/lib/community";

const CATEGORIES = [
  { value: "free", label: "자유글", desc: "자유로운 대화와 질문" },
  { value: "photo_bodycheck", label: "사진 몸평", desc: "사진 + 글 + 유저 평가" },
] as const;

const MAX_IMAGES = 3;
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const THUMB_MAX_EDGE = 960;
const THUMB_QUALITY = 0.72;

export default function WritePage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);

  const [category, setCategory] = useState<"free" | "photo_bodycheck">("free");
  const [gender, setGender] = useState<BodycheckGender | "">("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [thumbImages, setThumbImages] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");

  const isPhotoBodycheck = category === "photo_bodycheck";
  const canUploadMore = images.length < MAX_IMAGES;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const qs = new URLSearchParams(window.location.search);
    if (qs.get("type") === "photo_bodycheck") {
      setCategory("photo_bodycheck");
    }
  }, []);

  useEffect(() => {
    createClient()
      .auth.getUser()
      .then(({ data: { user } }) => {
        if (!user) {
          const redirect = `/community/write${isPhotoBodycheck ? "?type=photo_bodycheck" : ""}`;
          router.replace(`/login?redirect=${encodeURIComponent(redirect)}`);
          return;
        }
        setAuthChecked(true);
      });
  }, [router, isPhotoBodycheck]);

  useEffect(() => {
    if (!isPhotoBodycheck) {
      setGender("");
    }
  }, [isPhotoBodycheck]);

  const categoryDescription = useMemo(() => {
    return CATEGORIES.find((v) => v.value === category)?.desc ?? "";
  }, [category]);

  async function uploadFileToCommunity(file: File) {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch("/api/upload", {
      method: "POST",
      body: formData,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error ?? "이미지 업로드에 실패했습니다.");
    }
    const body = (await res.json()) as { url?: string };
    if (!body.url) throw new Error("이미지 URL이 없습니다.");
    return body.url;
  }

  async function createThumbFile(file: File) {
    const objectUrl = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error("이미지를 읽지 못했습니다."));
        el.src = objectUrl;
      });
      const srcW = img.naturalWidth || img.width;
      const srcH = img.naturalHeight || img.height;
      if (!srcW || !srcH) throw new Error("유효하지 않은 이미지 크기입니다.");
      const scale = Math.min(1, THUMB_MAX_EDGE / Math.max(srcW, srcH));
      const targetW = Math.max(1, Math.round(srcW * scale));
      const targetH = Math.max(1, Math.round(srcH * scale));
      const canvas = document.createElement("canvas");
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("썸네일 캔버스를 만들지 못했습니다.");
      ctx.drawImage(img, 0, 0, targetW, targetH);
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, "image/webp", THUMB_QUALITY);
      });
      if (!blob) throw new Error("썸네일 생성에 실패했습니다.");
      const baseName = file.name.replace(/\.[^.]+$/, "");
      return new File([blob], `${baseName}-thumb.webp`, { type: "image/webp" });
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;

    if (images.length + files.length > MAX_IMAGES) {
      setError(`이미지는 최대 ${MAX_IMAGES}장까지 업로드할 수 있습니다.`);
      return;
    }

    setUploading(true);
    setUploadProgress(0);
    setError("");

    let completed = 0;
    for (const file of files) {
      if (file.size > MAX_FILE_SIZE) {
        setError(`${file.name}: 5MB 이하 이미지만 업로드 가능합니다.`);
        completed += 1;
        setUploadProgress(Math.round((completed / files.length) * 100));
        continue;
      }

      try {
        const url = await uploadFileToCommunity(file);
        setImages((prev) => [...prev, url]);

        if (isPhotoBodycheck) {
          const thumbFile = await createThumbFile(file);
          const thumbUrl = await uploadFileToCommunity(thumbFile);
          setThumbImages((prev) => [...prev, thumbUrl]);
        } else {
          setThumbImages((prev) => [...prev, ""]);
        }
      } catch {
        setError("이미지 업로드 중 오류가 발생했습니다.");
      } finally {
        completed += 1;
        setUploadProgress(Math.round((completed / files.length) * 100));
      }
    }

    setUploading(false);
    e.target.value = "";
  };

  const removeImage = (index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
    setThumbImages((prev) => prev.filter((_, i) => i !== index));
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
    if (isPhotoBodycheck) {
      if (!gender) {
        setError("사진 몸평은 성별 선택이 필수입니다.");
        return;
      }
      if (images.length < 1 || images.length > MAX_IMAGES) {
        setError("사진 몸평은 사진 1~3장이 필요합니다.");
        return;
      }
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
          payload_json:
            isPhotoBodycheck && thumbImages.some((url) => typeof url === "string" && url.length > 0)
              ? { thumb_images: thumbImages.filter((url) => typeof url === "string" && url.length > 0).slice(0, MAX_IMAGES) }
              : undefined,
          images,
          gender: isPhotoBodycheck ? gender : undefined,
        }),
      });

      const data = await res.json();

      if (res.ok) {
        setToast("게시글이 등록되었습니다.");
        setTimeout(() => router.push(`/community/${data.id}`), 700);
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
      <h1 className="text-2xl font-bold text-neutral-900 mb-2">글쓰기</h1>
      <p className="text-sm text-neutral-500 mb-5">{categoryDescription}</p>

      <form onSubmit={handleSubmit} className="space-y-4">
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
                className={`p-3 rounded-xl border-2 text-left transition-all min-h-[68px] ${
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

        {isPhotoBodycheck && (
          <>
            <div className="rounded-xl bg-indigo-50 border border-indigo-200 p-3 text-xs text-indigo-800">
              이 글은 평가를 받습니다. 등록 후 유저들이 4단계로 투표합니다.
            </div>

            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2">
                성별 (필수)
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setGender("male")}
                  className={`min-h-[44px] rounded-xl border text-sm font-medium ${
                    gender === "male"
                      ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                      : "border-neutral-300 bg-white text-neutral-700"
                  }`}
                >
                  남성
                </button>
                <button
                  type="button"
                  onClick={() => setGender("female")}
                  className={`min-h-[44px] rounded-xl border text-sm font-medium ${
                    gender === "female"
                      ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                      : "border-neutral-300 bg-white text-neutral-700"
                  }`}
                >
                  여성
                </button>
              </div>
            </div>
          </>
        )}

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

        <div>
          <label
            htmlFor="content"
            className="block text-sm font-medium text-neutral-700 mb-1"
          >
            한줄소개/본문 (선택)
          </label>
          <textarea
            id="content"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="간단한 소개나 본문을 입력하세요"
            rows={6}
            maxLength={2000}
            className="w-full rounded-xl border border-neutral-300 bg-white p-3 text-neutral-900 resize-none focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
          <p className="text-xs text-neutral-400 mt-1 text-right">
            {content.length}/2000
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-2">
            사진 ({images.length}/{MAX_IMAGES}) {isPhotoBodycheck ? "(필수 1~3장)" : "(선택)"}
          </label>

          {images.length > 0 && (
            <div className="grid grid-cols-3 gap-2 mb-2">
              {images.map((url, i) => (
                <div
                  key={url}
                  className="relative rounded-xl overflow-hidden border border-neutral-200 aspect-square"
                >
                  <img
                    src={url}
                    alt={`업로드 ${i + 1}`}
                    className="w-full h-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => removeImage(i)}
                    className="absolute top-1 right-1 min-w-[26px] min-h-[26px] rounded-full bg-black/70 text-white text-xs flex items-center justify-center"
                    aria-label="사진 삭제"
                  >
                    X
                  </button>
                </div>
              ))}
            </div>
          )}

          {canUploadMore && (
            <label className="flex items-center justify-center min-h-[44px] rounded-xl border border-dashed border-neutral-300 bg-neutral-50 text-sm text-neutral-600 cursor-pointer hover:border-emerald-400 hover:bg-emerald-50 transition-colors">
              {uploading ? "업로드 중..." : "사진 추가"}
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

          {uploading && (
            <div className="mt-2">
              <div className="h-2 w-full rounded-full bg-neutral-200 overflow-hidden">
                <div
                  className="h-full bg-emerald-500 transition-all"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
              <p className="text-xs text-neutral-500 mt-1">{uploadProgress}%</p>
            </div>
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
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-neutral-900 text-white px-5 py-3 rounded-xl text-sm font-medium shadow-lg z-50">
          {toast}
        </div>
      )}
    </main>
  );
}
