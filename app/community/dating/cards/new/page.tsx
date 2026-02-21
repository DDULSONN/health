"use client";

import { type ReactNode, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_FILE_SIZE = 5 * 1024 * 1024;

type MyCardItem = {
  id: string;
  sex: "male" | "female";
  age: number | null;
  region: string | null;
  height_cm: number | null;
  job: string | null;
  training_years: number | null;
  ideal_type: string | null;
  strengths_text: string | null;
  photo_visibility: "blur" | "public";
  instagram_id: string | null;
  photo_paths: string[] | null;
  blur_thumb_path: string | null;
  blur_paths: string[] | null;
  total_3lift: number | null;
  status: "pending" | "public" | "expired" | "hidden";
};

function normalizeInstagramId(value: string) {
  return value.trim().replace(/^@+/, "").replace(/\s+/g, "").slice(0, 30);
}

async function createBlurThumbnailFile(source: File): Promise<File> {
  const imageUrl = URL.createObjectURL(source);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("이미지 로드 실패"));
      el.src = imageUrl;
    });

    const maxWidth = 960;
    const ratio = img.width > maxWidth ? maxWidth / img.width : 1;
    const width = Math.max(1, Math.round(img.width * ratio));
    const height = Math.max(1, Math.round(img.height * ratio));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas context 없음");

    ctx.filter = "blur(9px)";
    ctx.drawImage(img, 0, 0, width, height);
    ctx.filter = "none";

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => {
        if (b) resolve(b);
        else reject(new Error("블러 썸네일 생성 실패"));
      }, "image/jpeg", 0.82);
    });

    return new File([blob], "blur_thumb.jpg", { type: "image/jpeg" });
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

async function createLiteFile(source: File): Promise<File> {
  const imageUrl = URL.createObjectURL(source);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("이미지 로드 실패"));
      el.src = imageUrl;
    });

    const maxEdge = 1200;
    const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
    const width = Math.max(1, Math.round(img.width * scale));
    const height = Math.max(1, Math.round(img.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas context 없음");
    ctx.drawImage(img, 0, 0, width, height);

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => {
        if (b) resolve(b);
        else reject(new Error("lite 이미지 생성 실패"));
      }, "image/webp", 0.78);
    });

    return new File([blob], "lite.webp", { type: "image/webp" });
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

export default function NewDatingCardPage() {
  const router = useRouter();
  const [editId, setEditId] = useState("");
  const isEditMode = editId.length > 0;
  const [writeEnabled, setWriteEnabled] = useState(true);
  const [writeSettingLoading, setWriteSettingLoading] = useState(true);
  const [editLoading, setEditLoading] = useState(false);
  const [sex, setSex] = useState<"male" | "female">("male");
  const [age, setAge] = useState("");
  const [region, setRegion] = useState("");
  const [heightCm, setHeightCm] = useState("");
  const [job, setJob] = useState("");
  const [trainingYears, setTrainingYears] = useState("");
  const [idealType, setIdealType] = useState("");
  const [strengthsText, setStrengthsText] = useState("");
  const [instagramId, setInstagramId] = useState("");
  const [photoVisibility, setPhotoVisibility] = useState<"blur" | "public">("blur");
  const [total3Lift, setTotal3Lift] = useState("");
  const [photos, setPhotos] = useState<(File | null)[]>([null, null]);
  const [previewUrls, setPreviewUrls] = useState<(string | null)[]>([null, null]);
  const [existingRawPaths, setExistingRawPaths] = useState<string[]>([]);
  const [existingBlurPaths, setExistingBlurPaths] = useState<string[]>([]);
  const [existingBlurThumbPath, setExistingBlurThumbPath] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    queueMicrotask(async () => {
      try {
        const res = await fetch("/api/dating/cards/write-enabled", { cache: "no-store" });
        const body = (await res.json().catch(() => ({}))) as { enabled?: boolean };
        setWriteEnabled(body.enabled !== false);
      } catch {
        setWriteEnabled(true);
      } finally {
        setWriteSettingLoading(false);
      }
    });
  }, []);

  useEffect(() => {
    const urls = photos.map((file) => (file ? URL.createObjectURL(file) : null));
    setPreviewUrls(urls);

    return () => {
      urls.forEach((url) => {
        if (url) URL.revokeObjectURL(url);
      });
    };
  }, [photos]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const nextId = new URLSearchParams(window.location.search).get("editId") ?? "";
    setEditId(nextId);
  }, []);

  useEffect(() => {
    if (!isEditMode || !editId) return;
    let cancelled = false;
    setEditLoading(true);
    queueMicrotask(async () => {
      try {
        const res = await fetch("/api/dating/cards/my", { cache: "no-store" });
        const body = (await res.json().catch(() => ({}))) as { items?: MyCardItem[]; error?: string };
        if (!res.ok) {
          if (!cancelled) setError(body.error ?? "수정할 카드를 불러오지 못했습니다.");
          return;
        }
        const item = (body.items ?? []).find((card) => card.id === editId);
        if (!item || item.status !== "pending") {
          if (!cancelled) setError("대기중 오픈카드만 수정할 수 있습니다.");
          return;
        }
        if (cancelled) return;
        setSex(item.sex);
        setAge(item.age != null ? String(item.age) : "");
        setRegion(item.region ?? "");
        setHeightCm(item.height_cm != null ? String(item.height_cm) : "");
        setJob(item.job ?? "");
        setTrainingYears(item.training_years != null ? String(item.training_years) : "");
        setIdealType(item.ideal_type ?? "");
        setStrengthsText(item.strengths_text ?? "");
        setPhotoVisibility(item.photo_visibility === "public" ? "public" : "blur");
        setInstagramId(item.instagram_id ?? "");
        setTotal3Lift(item.total_3lift != null ? String(item.total_3lift) : "");
        setExistingRawPaths(Array.isArray(item.photo_paths) ? item.photo_paths : []);
        setExistingBlurPaths(Array.isArray(item.blur_paths) ? item.blur_paths : []);
        setExistingBlurThumbPath(item.blur_thumb_path ?? "");
      } catch {
        if (!cancelled) setError("수정할 카드를 불러오지 못했습니다.");
      } finally {
        if (!cancelled) setEditLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [editId, isEditMode]);

  const readErrorMessage = async (res: Response, fallback: string) => {
    const text = await res.text().catch(() => "");
    if (!text) return `${fallback} (HTTP ${res.status})`;
    try {
      const parsed = JSON.parse(text) as { error?: string; message?: string };
      if (parsed.error) return parsed.error;
      if (parsed.message) return parsed.message;
    } catch {
      // not json
    }
    return `${fallback} (HTTP ${res.status}) ${text.slice(0, 180)}`;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!writeEnabled) {
      setError("현재 오픈카드 작성이 일시 중단되었습니다.");
      return;
    }

    const hasPhotoSlot0 = Boolean(photos[0]) || Boolean(existingRawPaths[0]);
    const hasPhotoSlot1 = Boolean(photos[1]) || Boolean(existingRawPaths[1]);
    if (!hasPhotoSlot0 || !hasPhotoSlot1) {
      setError("오픈카드 사진은 2장 모두 필요합니다.");
      return;
    }

    for (const photo of photos.filter((p): p is File => Boolean(p))) {
      if (!ALLOWED_TYPES.includes(photo.type)) {
        setError("사진은 JPG/PNG/WebP만 업로드할 수 있습니다.");
        return;
      }
      if (photo.size > MAX_FILE_SIZE) {
        setError("사진은 장당 5MB 이하만 가능합니다.");
        return;
      }
    }

    setSubmitting(true);

    try {
      const nextRawPaths = [...existingRawPaths];
      const nextBlurPaths = [...existingBlurPaths];
      let nextBlurThumbPath = existingBlurThumbPath;

      for (let i = 0; i < 2; i++) {
        const photo = photos[i];
        if (!photo) continue;

        const assetId = crypto.randomUUID();
        const fd = new FormData();
        fd.append("file", photo);
        fd.append("kind", "raw");
        fd.append("asset_id", assetId);
        fd.append("index", String(i));
        const res = await fetch("/api/dating/cards/upload-card", { method: "POST", body: fd });
        if (!res.ok) {
          setError(await readErrorMessage(res, "카드 사진 업로드에 실패했습니다."));
          setSubmitting(false);
          return;
        }
        const body = (await res.json().catch(() => ({}))) as { path?: string; error?: string };
        if (!body.path) {
          setError("카드 사진 업로드 응답이 올바르지 않습니다.");
          setSubmitting(false);
          return;
        }
        nextRawPaths[i] = body.path;

        const liteFile = await createLiteFile(photo);
        const liteFd = new FormData();
        liteFd.append("file", liteFile);
        liteFd.append("kind", "lite");
        liteFd.append("asset_id", assetId);
        liteFd.append("index", String(i));
        const liteRes = await fetch("/api/dating/cards/upload-card", { method: "POST", body: liteFd });
        if (!liteRes.ok) {
          setError(await readErrorMessage(liteRes, "라이트 이미지 업로드에 실패했습니다."));
          setSubmitting(false);
          return;
        }

        const blurFile = await createBlurThumbnailFile(photo);
        const blurFd = new FormData();
        blurFd.append("file", blurFile);
        blurFd.append("kind", "blur");
        blurFd.append("index", String(i));
        const blurRes = await fetch("/api/dating/cards/upload-card", { method: "POST", body: blurFd });
        if (!blurRes.ok) {
          setError(await readErrorMessage(blurRes, "블러 썸네일 업로드에 실패했습니다."));
          setSubmitting(false);
          return;
        }
        const blurBody = (await blurRes.json().catch(() => ({}))) as { path?: string; error?: string };
        if (!blurBody.path) {
          setError("블러 썸네일 업로드 응답이 올바르지 않습니다.");
          setSubmitting(false);
          return;
        }
        nextBlurPaths[i] = blurBody.path;
        if (i === 0) nextBlurThumbPath = blurBody.path;
      }

      if (nextRawPaths.length < 2 || !nextRawPaths[0] || !nextRawPaths[1]) {
        setError("오픈카드 사진은 2장 모두 필요합니다.");
        setSubmitting(false);
        return;
      }
      if (nextBlurPaths.length < 2 || !nextBlurPaths[0] || !nextBlurPaths[1] || !nextBlurThumbPath) {
        setError("블러 이미지 2장 생성에 실패했습니다. 다시 시도해주세요.");
        setSubmitting(false);
        return;
      }

      const payload = {
        ...(isEditMode ? { id: editId } : {}),
        sex,
        age: age ? Number(age) : null,
        region: region.trim(),
        height_cm: heightCm ? Number(heightCm) : null,
        job: job.trim(),
        training_years: trainingYears ? Number(trainingYears) : null,
        ideal_type: idealType.trim(),
        strengths_text: strengthsText.trim(),
        photo_visibility: photoVisibility,
        instagram_id: normalizeInstagramId(instagramId),
        photo_paths: nextRawPaths,
        blur_thumb_path: nextBlurThumbPath,
        blur_paths: nextBlurPaths,
        total_3lift: sex === "male" && total3Lift ? Number(total3Lift) : null,
      };

      const res = await fetch("/api/dating/cards/my", {
        method: isEditMode ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const message = await readErrorMessage(res, "오픈카드 생성에 실패했습니다.");
        setError(message);
        setSubmitting(false);
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };

      alert(body.message ?? (isEditMode ? "오픈카드를 수정했습니다." : "오픈카드를 생성했습니다."));
      router.push("/mypage");
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    }

    setSubmitting(false);
  };

  return (
    <main className="max-w-lg mx-auto px-4 py-8">
      <Link href="/community/dating/cards" className="text-sm text-neutral-500 hover:text-neutral-700">
        뒤로가기
      </Link>

      <h1 className="text-2xl font-bold text-neutral-900 mt-3">오픈카드 작성</h1>
      {isEditMode && <p className="text-sm text-amber-700 mt-1">대기중 오픈카드 수정 모드</p>}
      <p className="text-sm text-neutral-500 mt-1">공개 카드 슬롯 상황에 따라 즉시 공개 또는 대기열로 등록됩니다.</p>
      <p className="text-sm text-neutral-500 mt-1">닉네임은 가입 시 설정한 프로필 닉네임이 자동으로 반영됩니다.</p>
      {!writeSettingLoading && !writeEnabled && (
        <p className="mt-2 text-sm font-medium text-red-600">현재 오픈카드 작성이 일시 중단되었습니다.</p>
      )}

      <form onSubmit={submit} className="space-y-4 mt-6">
        {editLoading && <p className="text-sm text-neutral-500">기존 카드 정보를 불러오는 중...</p>}
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">성별 *</label>
          <div className="flex gap-2">
            <button type="button" onClick={() => setSex("male")} className={`h-10 px-4 rounded-lg border ${sex === "male" ? "bg-pink-500 text-white border-pink-500" : "bg-white"}`}>
              남자
            </button>
            <button type="button" onClick={() => setSex("female")} className={`h-10 px-4 rounded-lg border ${sex === "female" ? "bg-pink-500 text-white border-pink-500" : "bg-white"}`}>
              여자
            </button>
          </div>
        </div>

        <Field label="나이"><input className="input" type="number" min={19} max={99} value={age} onChange={(e) => setAge(e.target.value)} /></Field>
        <Field label="지역"><input className="input" maxLength={30} value={region} onChange={(e) => setRegion(e.target.value)} /></Field>
        <Field label="키(cm)"><input className="input" type="number" min={120} max={230} value={heightCm} onChange={(e) => setHeightCm(e.target.value)} /></Field>
        <Field label="직업"><input className="input" maxLength={50} value={job} onChange={(e) => setJob(e.target.value)} /></Field>
        <Field label="운동경력(년)"><input className="input" type="number" min={0} max={50} value={trainingYears} onChange={(e) => setTrainingYears(e.target.value)} /></Field>
        <Field label="이상형(상세 전체 공개)"><textarea className="w-full rounded-xl border border-neutral-300 px-3 py-2" maxLength={1000} rows={4} value={idealType} onChange={(e) => setIdealType(e.target.value)} /></Field>
        <Field label="내 장점(공개, 최대 150자)"><textarea className="w-full rounded-xl border border-neutral-300 px-3 py-2" maxLength={150} rows={3} value={strengthsText} onChange={(e) => setStrengthsText(e.target.value)} /></Field>
        <Field label="인스타그램 아이디(필수, @ 없이)" required><input className="input" required maxLength={30} value={instagramId} onChange={(e) => setInstagramId(normalizeInstagramId(e.target.value))} /></Field>
        <label className="flex items-start gap-2 text-sm text-neutral-700">
          <input
            type="checkbox"
            checked={photoVisibility === "public"}
            onChange={(e) => setPhotoVisibility(e.target.checked ? "public" : "blur")}
            className="mt-1"
          />
          <span>
            사진을 블러 없이 공개합니다.
            <span className="block text-xs text-neutral-500 mt-1">체크 시 공개 목록/상세에 원본 사진 2장이 표시됩니다.</span>
          </span>
        </label>

        {sex === "male" && (
          <>
            <Field label="3대 합계(kg)"><input className="input" type="number" min={0} value={total3Lift} onChange={(e) => setTotal3Lift(e.target.value)} /></Field>
          </>
        )}

        <Field label="오픈카드 사진 1" required>
          <input type="file" accept="image/jpeg,image/png,image/webp" required={!isEditMode} onChange={(e) => setPhotos((prev) => [e.target.files?.[0] ?? null, prev[1]])} />
          {previewUrls[0] && (
            <div className="mt-2 h-40 w-full overflow-hidden rounded-xl border border-neutral-200 bg-neutral-50">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={previewUrls[0]} alt="사진 1 미리보기" className="h-full w-full object-contain" />
            </div>
          )}
        </Field>
        <Field label="오픈카드 사진 2" required>
          <input type="file" accept="image/jpeg,image/png,image/webp" required={!isEditMode} onChange={(e) => setPhotos((prev) => [prev[0], e.target.files?.[0] ?? null])} />
          {previewUrls[1] && (
            <div className="mt-2 h-40 w-full overflow-hidden rounded-xl border border-neutral-200 bg-neutral-50">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={previewUrls[1]} alt="사진 2 미리보기" className="h-full w-full object-contain" />
            </div>
          )}
        </Field>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={submitting || editLoading || (!isEditMode && (writeSettingLoading || !writeEnabled))}
          className="w-full min-h-[46px] rounded-xl bg-pink-500 text-white text-sm font-medium hover:bg-pink-600 disabled:opacity-50"
        >
          {submitting ? "처리 중..." : isEditMode ? "오픈카드 수정하기" : "오픈카드 등록하기"}
        </button>
      </form>

      <style jsx>{`
        .input {
          width: 100%;
          min-height: 44px;
          border: 1px solid #d4d4d8;
          border-radius: 0.75rem;
          padding: 0 0.75rem;
          background: white;
        }
      `}</style>
    </main>
  );
}

function Field({ label, children, required = false }: { label: string; children: ReactNode; required?: boolean }) {
  return (
    <div>
      <label className="block text-sm font-medium text-neutral-700 mb-1">
        {label} {required ? "*" : ""}
      </label>
      {children}
    </div>
  );
}
