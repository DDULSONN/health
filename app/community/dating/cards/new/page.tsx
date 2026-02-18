"use client";

import { type ReactNode, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_FILE_SIZE = 5 * 1024 * 1024;

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

export default function NewDatingCardPage() {
  const router = useRouter();
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
  const [is3LiftVerified, setIs3LiftVerified] = useState(false);
  const [photos, setPhotos] = useState<(File | null)[]>([null, null]);
  const [previewUrls, setPreviewUrls] = useState<(string | null)[]>([null, null]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const urls = photos.map((file) => (file ? URL.createObjectURL(file) : null));
    setPreviewUrls(urls);

    return () => {
      urls.forEach((url) => {
        if (url) URL.revokeObjectURL(url);
      });
    };
  }, [photos]);

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

    const validPhotos = photos.filter((p): p is File => Boolean(p));
    if (validPhotos.length < 1) {
      setError("오픈카드 사진은 최소 1장 필요합니다.");
      return;
    }

    for (const photo of validPhotos) {
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
      const uploadedRawPaths: string[] = [];
      for (let i = 0; i < validPhotos.length; i++) {
        const fd = new FormData();
        fd.append("file", validPhotos[i]);
        fd.append("kind", "raw");
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
        uploadedRawPaths.push(body.path);
      }

      const blurSource = validPhotos[0];
      const blurFile = await createBlurThumbnailFile(blurSource);
      const blurFd = new FormData();
      blurFd.append("file", blurFile);
      blurFd.append("kind", "blur");
      blurFd.append("index", "0");
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

      const payload = {
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
        photo_paths: uploadedRawPaths,
        blur_thumb_path: blurBody.path,
        total_3lift: sex === "male" && total3Lift ? Number(total3Lift) : null,
        is_3lift_verified: sex === "male" ? is3LiftVerified : false,
      };

      const res = await fetch("/api/dating/cards/my", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        setError(await readErrorMessage(res, "오픈카드 생성에 실패했습니다."));
        setSubmitting(false);
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };

      alert(body.message ?? "오픈카드를 생성했습니다.");
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
      <p className="text-sm text-neutral-500 mt-1">공개 카드 슬롯 상황에 따라 즉시 공개 또는 대기열로 등록됩니다.</p>
      <p className="text-sm text-neutral-500 mt-1">닉네임은 가입 시 설정한 프로필 닉네임이 자동으로 반영됩니다.</p>

      <form onSubmit={submit} className="space-y-4 mt-6">
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
            <span className="block text-xs text-neutral-500 mt-1">체크 시 공개 목록/상세에 원본 첫 사진이 표시됩니다.</span>
          </span>
        </label>

        {sex === "male" && (
          <>
            <Field label="3대 합계(kg)"><input className="input" type="number" min={0} value={total3Lift} onChange={(e) => setTotal3Lift(e.target.value)} /></Field>
            <label className="flex items-center gap-2 text-sm text-neutral-700">
              <input type="checkbox" checked={is3LiftVerified} onChange={(e) => setIs3LiftVerified(e.target.checked)} />
              <span>3대 인증 여부</span>
            </label>
          </>
        )}

        <Field label="오픈카드 사진 1" required>
          <input type="file" accept="image/jpeg,image/png,image/webp" required onChange={(e) => setPhotos((prev) => [e.target.files?.[0] ?? null, prev[1]])} />
          {previewUrls[0] && (
            <div className="mt-2 h-40 w-full overflow-hidden rounded-xl border border-neutral-200 bg-neutral-50">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={previewUrls[0]} alt="사진 1 미리보기" className="h-full w-full object-contain" />
            </div>
          )}
        </Field>
        <Field label="오픈카드 사진 2(선택)">
          <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setPhotos((prev) => [prev[0], e.target.files?.[0] ?? null])} />
          {previewUrls[1] && (
            <div className="mt-2 h-40 w-full overflow-hidden rounded-xl border border-neutral-200 bg-neutral-50">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={previewUrls[1]} alt="사진 2 미리보기" className="h-full w-full object-contain" />
            </div>
          )}
        </Field>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button type="submit" disabled={submitting} className="w-full min-h-[46px] rounded-xl bg-pink-500 text-white text-sm font-medium hover:bg-pink-600 disabled:opacity-50">
          {submitting ? "등록 중..." : "오픈카드 등록하기"}
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
