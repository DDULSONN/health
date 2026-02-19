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
  is_3lift_verified: boolean;
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
      setError("?몄뒪?洹몃옩 ?꾩씠???뺤떇???뺤씤?댁＜?몄슂. (@ ?놁씠 理쒕? 30??");
      return;
    }

    const validPhotos = photos.filter((p): p is File => Boolean(p));
    if (validPhotos.length < 1) {
      setError("?ъ쭊? 理쒖냼 1???꾩슂?⑸땲??");
      return;
    }
    for (const photo of validPhotos) {
      if (!ALLOWED_TYPES.includes(photo.type)) {
        setError("?ъ쭊? JPG/PNG/WebP留??낅줈?쒗븷 ???덉뒿?덈떎.");
        return;
      }
      if (photo.size > MAX_FILE_SIZE) {
        setError("?ъ쭊? ?λ떦 5MB ?댄븯留?媛?ν빀?덈떎.");
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
          setError(body.error ?? "?ъ쭊 ?낅줈?쒖뿉 ?ㅽ뙣?덉뒿?덈떎.");
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
          setError(blurBody.error ?? "釉붾윭 ?몃꽕???낅줈?쒖뿉 ?ㅽ뙣?덉뒿?덈떎.");
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
        setError(createBody.message ?? "?좊즺 ?좎껌 ?앹꽦???ㅽ뙣?덉뒿?덈떎.");
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
      setError("?ㅽ듃?뚰겕 ?ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.");
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
          ?ㅽ뵂移대뱶
        </Link>
        <span className="rounded-full border border-rose-300 bg-rose-50 px-3 py-1.5 text-sm font-semibold text-rose-700">?뵦24?쒓컙 怨좎젙</span>
      </div>

      <section className="rounded-2xl border border-neutral-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h1 className="text-xl font-bold text-neutral-900">?뵦24?쒓컙 怨좎젙 ?좎껌</h1>
          <button
            type="button"
            onClick={() => setFormOpen((prev) => !prev)}
            className="rounded-lg bg-rose-500 px-3 py-2 text-sm font-medium text-white hover:bg-rose-600"
          >
            ?좎껌?섍린
          </button>
        </div>
        <p className="text-sm text-neutral-600">?좎껌 ??寃곗젣 ?뺤씤???꾨즺?섎㈃ ?댁쁺?먭? ?뱀씤?섍퀬 24?쒓컙 ?몄텧?⑸땲??</p>
      </section>

      {formOpen && (
      <section id="paid-create-form" className="mt-5 rounded-2xl border border-neutral-200 bg-white p-4">
        <h2 className="text-lg font-bold text-neutral-900">?좊즺 ?좎껌 ?묒꽦</h2>
        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <div className="flex gap-2">
            <button type="button" onClick={() => setGender("M")} className={`h-10 rounded-lg border px-4 text-sm ${gender === "M" ? "border-rose-500 bg-rose-500 text-white" : "border-neutral-300 bg-white text-neutral-700"}`}>
              ?⑥옄
            </button>
            <button type="button" onClick={() => setGender("F")} className={`h-10 rounded-lg border px-4 text-sm ${gender === "F" ? "border-rose-500 bg-rose-500 text-white" : "border-neutral-300 bg-white text-neutral-700"}`}>
              ?ъ옄
            </button>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <input className="input" placeholder="?섏씠" type="number" min={19} max={99} value={age} onChange={(e) => setAge(e.target.value)} />
            <input className="input" placeholder="지역" maxLength={50} value={region} onChange={(e) => setRegion(e.target.value)} />
            <input className="input" placeholder="??cm)" type="number" min={120} max={230} value={heightCm} onChange={(e) => setHeightCm(e.target.value)} />
            <input className="input" placeholder="吏곸뾽" maxLength={80} value={job} onChange={(e) => setJob(e.target.value)} />
            <input className="input md:col-span-2" placeholder="?대룞寃쎈젰(??" type="number" min={0} max={50} value={trainingYears} onChange={(e) => setTrainingYears(e.target.value)} />
          </div>

          <textarea className="w-full rounded-xl border border-neutral-300 px-3 py-2" rows={3} maxLength={300} placeholder="???μ젏" value={strengthsText} onChange={(e) => setStrengthsText(e.target.value)} />
          <textarea className="w-full rounded-xl border border-neutral-300 px-3 py-2" rows={3} maxLength={1000} placeholder="이상형" value={idealText} onChange={(e) => setIdealText(e.target.value)} />
          <textarea className="w-full rounded-xl border border-neutral-300 px-3 py-2" rows={4} maxLength={1000} placeholder="?먭린?뚭컻" value={introText} onChange={(e) => setIntroText(e.target.value)} />

          <input className="input" placeholder="?몄뒪?洹몃옩 ?꾩씠??@ ?놁씠, ?꾩닔)" required maxLength={30} value={instagramId} onChange={(e) => setInstagramId(normalizeInstagramId(e.target.value))} />

          <label className="inline-flex items-start gap-2 text-sm text-neutral-700">
            <input type="checkbox" checked={photoVisibility === "public"} onChange={(e) => setPhotoVisibility(e.target.checked ? "public" : "blur")} className="mt-1" />
            <span>?ъ쭊??釉붾윭 ?놁씠 怨듦컻?⑸땲?? (誘몄꽑????釉붾윭)</span>
          </label>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm text-neutral-700">?ъ쭊 1 (?꾩닔)</label>
              <input type="file" accept="image/jpeg,image/png,image/webp" required onChange={(e) => setPhotos((prev) => [e.target.files?.[0] ?? null, prev[1]])} />
              {previewUrls[0] && (
                <div className="mt-2 h-36 overflow-hidden rounded-xl border border-neutral-200 bg-neutral-50">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={previewUrls[0]} alt="" className="h-full w-full object-contain" />
                </div>
              )}
            </div>
            <div>
              <label className="mb-1 block text-sm text-neutral-700">?ъ쭊 2 (?좏깮)</label>
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
            {submitting ? "?좎껌 以?.." : "?좊즺 ?좎껌 ?깅줉"}
          </button>
        </form>

        {successId && (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
            <p className="font-semibold">?좎껌???묒닔?섏뿀?듬땲??</p>
            <p className="mt-1">?좎껌ID: {successId}</p>
            <p className="mt-1">?낃툑 ???ㅽ뵂移댄넚?쇰줈 "?됰꽕???좎껌ID" 蹂대궡硫??뺤씤 ???낅줈?쒕맗?덈떎.</p>
            <a href={openKakaoUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-emerald-700">
              ?ㅽ뵂移댄넚 ?대룞
            </a>
          </div>
        )}
      </section>
      )}

      <section className="mt-5">
        <h2 className="text-lg font-bold text-neutral-900">?뱀씤??24?쒓컙 怨좎젙</h2>
        {loading ? (
          <p className="mt-2 text-sm text-neutral-500">遺덈윭?ㅻ뒗 以?..</p>
        ) : items.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500">?꾩옱 怨듦컻 以묒씤 怨좎젙 移대뱶媛 ?놁뒿?덈떎.</p>
        ) : (
          <div className="mt-3 space-y-6">
            <GenderSection title="?⑥옄 24?쒓컙 怨좎젙" items={maleItems} />
            <GenderSection title="?ъ옄 24?쒓컙 怨좎젙" items={femaleItems} />
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
        <p className="rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-500">?꾩옱 ?몄텧 以묒씤 移대뱶媛 ?놁뒿?덈떎.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {items.map((item) => (
            <article key={item.id} className="rounded-2xl border border-neutral-200 bg-white p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold text-neutral-900">{item.nickname}</p>
                {item.expires_at ? (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                    ??{formatRemainingToKorean(item.expires_at)}
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
                {item.gender === "M" && item.is_3lift_verified && (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-700">3-lift verified</span>
                )}
              </div>
              {item.strengths_text && <p className="mt-2 text-sm text-emerald-700">???μ젏: {item.strengths_text}</p>}
              {item.ideal_text && <p className="mt-1 text-sm text-rose-700">?댁긽?? {item.ideal_text}</p>}
              {item.intro_text && <p className="mt-1 text-sm text-neutral-700 whitespace-pre-wrap break-words">{item.intro_text}</p>}
              <div className="mt-3 flex items-center gap-2">
                <Link
                  href={`/dating/paid/${item.id}`}
                  className="inline-flex min-h-[40px] items-center rounded-lg border border-neutral-300 px-4 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
                >
                  상세보기
                </Link>
                <Link
                  href={`/dating/paid/${item.id}/apply`}
                  className="inline-flex min-h-[40px] items-center rounded-lg bg-pink-500 px-4 text-sm font-medium text-white hover:bg-pink-600"
                >
                  吏?먰븯湲?                </Link>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

