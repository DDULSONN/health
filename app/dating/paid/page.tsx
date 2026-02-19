"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatRemainingToKorean } from "@/lib/dating-open";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_FILE_SIZE = 5 * 1024 * 1024;

type PaidItem = {
  id: string;
  nickname: string;
  gender: "M" | "F";
  age: number | null;
  region: string | null;
  height_cm: number | null;
  job: string | null;
  training_years: number | null;
  strengths_text: string | null;
  ideal_text: string | null;
  intro_text: string | null;
  thumbUrl: string;
  expires_at: string | null;
  paid_at: string | null;
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
      el.onerror = () => reject(new Error("image-load-failed"));
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
    if (!ctx) throw new Error("canvas-context-missing");

    ctx.filter = "blur(9px)";
    ctx.drawImage(img, 0, 0, width, height);
    ctx.filter = "none";

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("blur-generate-failed"))), "image/jpeg", 0.82);
    });

    return new File([blob], "paid_blur_thumb.jpg", { type: "image/jpeg" });
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

export default function DatingPaidPage() {
  const supabase = useMemo(() => createClient(), []);
  const openKakaoUrl = process.env.NEXT_PUBLIC_OPENKAKAO_URL ?? "https://open.kakao.com/o/s2gvTdhi";

  const [items, setItems] = useState<PaidItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [successId, setSuccessId] = useState("");
  const [formOpen, setFormOpen] = useState(false);

  const [gender, setGender] = useState<"M" | "F">("M");
  const [age, setAge] = useState("");
  const [region, setRegion] = useState("");
  const [heightCm, setHeightCm] = useState("");
  const [job, setJob] = useState("");
  const [trainingYears, setTrainingYears] = useState("");
  const [strengthsText, setStrengthsText] = useState("");
  const [idealText, setIdealText] = useState("");
  const [introText, setIntroText] = useState("");
  const [instagramId, setInstagramId] = useState("");
  const [photoVisibility, setPhotoVisibility] = useState<"blur" | "public">("blur");
  const [photos, setPhotos] = useState<(File | null)[]>([null, null]);
  const [previewUrls, setPreviewUrls] = useState<(string | null)[]>([null, null]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    queueMicrotask(async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/dating/paid/list", { cache: "no-store" });
        const body = (await res.json().catch(() => ({}))) as { items?: PaidItem[] };
        setItems(Array.isArray(body.items) ? body.items : []);
      } catch {
        setItems([]);
      } finally {
        setLoading(false);
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
    const timer = window.setInterval(() => setTick((v) => v + 1), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccessId("");

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      window.location.href = `/login?redirect=${encodeURIComponent("/dating/paid")}`;
      return;
    }

    const normalizedInstagramId = normalizeInstagramId(instagramId);
    if (!/^[A-Za-z0-9._]{1,30}$/.test(normalizedInstagramId)) {
      setError("인스타그램 아이디 형식을 확인해주세요. (@ 없이 최대 30자)");
      return;
    }

    const validPhotos = photos.filter((p): p is File => Boolean(p));
    if (validPhotos.length < 1) {
      setError("사진은 최소 1장 필요합니다.");
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
        const body = (await res.json().catch(() => ({}))) as { path?: string; error?: string };
        if (!res.ok || !body.path) {
          setError(body.error ?? "사진 업로드에 실패했습니다.");
          setSubmitting(false);
          return;
        }
        uploadedRawPaths.push(body.path);
      }

      let blurThumbPath = "";
      if (photoVisibility === "blur") {
        const blurFile = await createBlurThumbnailFile(validPhotos[0]);
        const blurFd = new FormData();
        blurFd.append("file", blurFile);
        blurFd.append("kind", "blur");
        blurFd.append("index", "0");
        const blurRes = await fetch("/api/dating/cards/upload-card", { method: "POST", body: blurFd });
        const blurBody = (await blurRes.json().catch(() => ({}))) as { path?: string; error?: string };
        if (!blurRes.ok || !blurBody.path) {
          setError(blurBody.error ?? "블러 썸네일 업로드에 실패했습니다.");
          setSubmitting(false);
          return;
        }
        blurThumbPath = blurBody.path;
      }

      const payload = {
        gender,
        age: age ? Number(age) : null,
        region: region.trim(),
        height_cm: heightCm ? Number(heightCm) : null,
        job: job.trim(),
        training_years: trainingYears ? Number(trainingYears) : null,
        strengths_text: strengthsText.trim(),
        ideal_text: idealText.trim(),
        intro_text: introText.trim(),
        instagram_id: normalizedInstagramId,
        photo_visibility: photoVisibility,
        blur_thumb_path: blurThumbPath || null,
        photo_paths: uploadedRawPaths,
      };

      const createRes = await fetch("/api/dating/paid/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const createBody = (await createRes.json().catch(() => ({}))) as {
        ok?: boolean;
        paidCardId?: string;
        message?: string;
      };
      if (!createRes.ok || !createBody.ok || !createBody.paidCardId) {
        setError(createBody.message ?? "유료 신청 생성에 실패했습니다.");
        setSubmitting(false);
        return;
      }

      setSuccessId(createBody.paidCardId);
      setPhotos([null, null]);
      setAge("");
      setRegion("");
      setHeightCm("");
      setJob("");
      setTrainingYears("");
      setStrengthsText("");
      setIdealText("");
      setIntroText("");
      setInstagramId("");
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  const maleItems = useMemo(() => items.filter((item) => item.gender === "M"), [items]);
  const femaleItems = useMemo(() => items.filter((item) => item.gender === "F"), [items]);
  const nowTick = useMemo(() => tick, [tick]);
  void nowTick;

  return (
    <main className="max-w-4xl mx-auto px-4 py-6">
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Link href="/community/dating/cards" className="rounded-full border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50">
          오픈카드
        </Link>
        <span className="rounded-full border border-rose-300 bg-rose-50 px-3 py-1.5 text-sm font-semibold text-rose-700">🔥24시간 고정</span>
      </div>

      <section className="rounded-2xl border border-neutral-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h1 className="text-xl font-bold text-neutral-900">🔥24시간 고정 신청</h1>
          <button
            type="button"
            onClick={() => setFormOpen((prev) => !prev)}
            className="rounded-lg bg-rose-500 px-3 py-2 text-sm font-medium text-white hover:bg-rose-600"
          >
            신청하기
          </button>
        </div>
        <p className="text-sm text-neutral-600">신청 후 결제 확인이 완료되면 운영자가 승인하고 24시간 노출됩니다.</p>
      </section>

      {formOpen && (
      <section id="paid-create-form" className="mt-5 rounded-2xl border border-neutral-200 bg-white p-4">
        <h2 className="text-lg font-bold text-neutral-900">유료 신청 작성</h2>
        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <div className="flex gap-2">
            <button type="button" onClick={() => setGender("M")} className={`h-10 rounded-lg border px-4 text-sm ${gender === "M" ? "border-rose-500 bg-rose-500 text-white" : "border-neutral-300 bg-white text-neutral-700"}`}>
              남자
            </button>
            <button type="button" onClick={() => setGender("F")} className={`h-10 rounded-lg border px-4 text-sm ${gender === "F" ? "border-rose-500 bg-rose-500 text-white" : "border-neutral-300 bg-white text-neutral-700"}`}>
              여자
            </button>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <input className="input" placeholder="나이" type="number" min={19} max={99} value={age} onChange={(e) => setAge(e.target.value)} />
            <input className="input" placeholder="지역" maxLength={50} value={region} onChange={(e) => setRegion(e.target.value)} />
            <input className="input" placeholder="키(cm)" type="number" min={120} max={230} value={heightCm} onChange={(e) => setHeightCm(e.target.value)} />
            <input className="input" placeholder="직업" maxLength={80} value={job} onChange={(e) => setJob(e.target.value)} />
            <input className="input md:col-span-2" placeholder="운동경력(년)" type="number" min={0} max={50} value={trainingYears} onChange={(e) => setTrainingYears(e.target.value)} />
          </div>

          <textarea className="w-full rounded-xl border border-neutral-300 px-3 py-2" rows={3} maxLength={300} placeholder="내 장점" value={strengthsText} onChange={(e) => setStrengthsText(e.target.value)} />
          <textarea className="w-full rounded-xl border border-neutral-300 px-3 py-2" rows={3} maxLength={1000} placeholder="이상형" value={idealText} onChange={(e) => setIdealText(e.target.value)} />
          <textarea className="w-full rounded-xl border border-neutral-300 px-3 py-2" rows={4} maxLength={1000} placeholder="자기소개" value={introText} onChange={(e) => setIntroText(e.target.value)} />

          <input className="input" placeholder="인스타그램 아이디(@ 없이, 필수)" required maxLength={30} value={instagramId} onChange={(e) => setInstagramId(normalizeInstagramId(e.target.value))} />

          <label className="inline-flex items-start gap-2 text-sm text-neutral-700">
            <input type="checkbox" checked={photoVisibility === "public"} onChange={(e) => setPhotoVisibility(e.target.checked ? "public" : "blur")} className="mt-1" />
            <span>사진을 블러 없이 공개합니다. (미선택 시 블러)</span>
          </label>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm text-neutral-700">사진 1 (필수)</label>
              <input type="file" accept="image/jpeg,image/png,image/webp" required onChange={(e) => setPhotos((prev) => [e.target.files?.[0] ?? null, prev[1]])} />
              {previewUrls[0] && (
                <div className="mt-2 h-36 overflow-hidden rounded-xl border border-neutral-200 bg-neutral-50">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={previewUrls[0]} alt="" className="h-full w-full object-contain" />
                </div>
              )}
            </div>
            <div>
              <label className="mb-1 block text-sm text-neutral-700">사진 2 (선택)</label>
              <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setPhotos((prev) => [prev[0], e.target.files?.[0] ?? null])} />
              {previewUrls[1] && (
                <div className="mt-2 h-36 overflow-hidden rounded-xl border border-neutral-200 bg-neutral-50">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={previewUrls[1]} alt="" className="h-full w-full object-contain" />
                </div>
              )}
            </div>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button type="submit" disabled={submitting} className="h-11 rounded-xl bg-rose-500 px-4 text-sm font-medium text-white hover:bg-rose-600 disabled:opacity-50">
            {submitting ? "신청 중..." : "유료 신청 등록"}
          </button>
        </form>

        {successId && (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
            <p className="font-semibold">신청이 접수되었습니다.</p>
            <p className="mt-1">신청ID: {successId}</p>
            <p className="mt-1">입금 후 오픈카톡으로 "닉네임+신청ID" 보내면 확인 후 업로드됩니다.</p>
            <a href={openKakaoUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-emerald-700">
              오픈카톡 이동
            </a>
          </div>
        )}
      </section>
      )}

      <section className="mt-5">
        <h2 className="text-lg font-bold text-neutral-900">승인된 24시간 고정</h2>
        {loading ? (
          <p className="mt-2 text-sm text-neutral-500">불러오는 중...</p>
        ) : items.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500">현재 공개 중인 고정 카드가 없습니다.</p>
        ) : (
          <div className="mt-3 space-y-6">
            <GenderSection title="남자 24시간 고정" items={maleItems} />
            <GenderSection title="여자 24시간 고정" items={femaleItems} />
          </div>
        )}
      </section>

      <style jsx>{`
        .input {
          min-height: 44px;
          width: 100%;
          border: 1px solid #d4d4d8;
          border-radius: 0.75rem;
          padding: 0 0.75rem;
          background: #fff;
        }
      `}</style>
    </main>
  );
}

function GenderSection({ title, items }: { title: string; items: PaidItem[] }) {
  return (
    <section>
      <h3 className="mb-2 text-base font-semibold text-neutral-800">{title}</h3>
      {items.length === 0 ? (
        <p className="rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-500">현재 노출 중인 카드가 없습니다.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {items.map((item) => (
            <article key={item.id} className="rounded-2xl border border-neutral-200 bg-white p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold text-neutral-900">{item.nickname}</p>
                {item.expires_at ? (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                    ⏳ {formatRemainingToKorean(item.expires_at)}
                  </span>
                ) : null}
              </div>
              {item.thumbUrl ? (
                <div className="mt-2 h-44 overflow-hidden rounded-xl border border-neutral-100 bg-neutral-50">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={item.thumbUrl} alt="" className="h-full w-full object-contain" />
                </div>
              ) : (
                <div className="mt-2 h-44 rounded-xl border border-neutral-100 bg-neutral-50" />
              )}
              <div className="mt-2 flex flex-wrap gap-2 text-xs text-neutral-600">
                {item.age != null && <span>{item.age}세</span>}
                {item.region && <span>{item.region}</span>}
                {item.height_cm != null && <span>{item.height_cm}cm</span>}
                {item.job && <span>{item.job}</span>}
                {item.training_years != null && <span>운동 {item.training_years}년</span>}
              </div>
              {item.strengths_text && <p className="mt-2 text-sm text-emerald-700">내 장점: {item.strengths_text}</p>}
              {item.ideal_text && <p className="mt-1 text-sm text-rose-700">이상형: {item.ideal_text}</p>}
              {item.intro_text && <p className="mt-1 text-sm text-neutral-700 whitespace-pre-wrap break-words">{item.intro_text}</p>}
              <div className="mt-3">
                <Link
                  href={`/dating/paid/${item.id}/apply`}
                  className="inline-flex min-h-[40px] items-center rounded-lg bg-pink-500 px-4 text-sm font-medium text-white hover:bg-pink-600"
                >
                  지원하기
                </Link>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
