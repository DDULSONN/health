"use client";

import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

type CardDetail = {
  id: string;
  sex: "male" | "female";
  display_nickname: string;
  age: number | null;
  region: string | null;
  height_cm: number | null;
  job: string | null;
  training_years: number | null;
  ideal_type: string | null;
  total_3lift: number | null;
  percent_all: number | null;
  is_3lift_verified: boolean;
  blur_thumb_url: string;
  expires_at: string;
};

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_FILE_SIZE = 5 * 1024 * 1024;

function normalizeInstagramId(value: string) {
  return value.trim().replace(/^@+/, "").replace(/\s+/g, "").slice(0, 30);
}

function validInstagramId(value: string) {
  if (!/^[A-Za-z0-9._]{1,30}$/.test(value)) return false;
  if (/https?:\/\//i.test(value)) return false;
  return true;
}

export default function DatingCardApplyPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [card, setCard] = useState<CardDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [displayNickname, setDisplayNickname] = useState("");
  const [age, setAge] = useState("");
  const [heightCm, setHeightCm] = useState("");
  const [region, setRegion] = useState("");
  const [job, setJob] = useState("");
  const [trainingYears, setTrainingYears] = useState("");
  const [introText, setIntroText] = useState("");
  const [instagramId, setInstagramId] = useState("");
  const [consent, setConsent] = useState(false);
  const [photos, setPhotos] = useState<(File | null)[]>([null, null]);

  useEffect(() => {
    queueMicrotask(async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.replace(`/login?redirect=/community/dating/cards/${id}/apply`);
        return;
      }

      try {
        const res = await fetch(`/api/dating/cards/${id}`);
        if (!res.ok) {
          router.replace("/community/dating/cards");
          return;
        }
        const data = (await res.json()) as { card?: CardDetail };
        if (!data.card) {
          router.replace("/community/dating/cards");
          return;
        }
        setCard(data.card);
      } catch {
        router.replace("/community/dating/cards");
      }
      setLoading(false);
    });
  }, [id, router, supabase]);

  const handlePhotoChange = (index: number, file: File | null) => {
    const next = [...photos];
    next[index] = file;
    setPhotos(next);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const normalizedInstagramId = normalizeInstagramId(instagramId);
    if (!displayNickname.trim()) {
      setError("닉네임(표시용)을 입력해주세요.");
      return;
    }
    if (!validInstagramId(normalizedInstagramId)) {
      setError("인스타 아이디 형식을 확인해주세요. (@ 없이 최대 30자)");
      return;
    }
    if (!consent) {
      setError("동의가 필요합니다.");
      return;
    }
    if (!photos[0] || !photos[1]) {
      setError("지원 사진 2장이 필요합니다.");
      return;
    }

    for (const photo of photos) {
      if (!photo) continue;
      if (!ALLOWED_TYPES.includes(photo.type)) {
        setError("사진은 JPG/PNG/WebP만 가능합니다.");
        return;
      }
      if (photo.size > MAX_FILE_SIZE) {
        setError("사진은 장당 5MB 이하만 가능합니다.");
        return;
      }
    }

    setSubmitting(true);

    try {
      const uploadedPaths: string[] = [];
      for (let i = 0; i < photos.length; i++) {
        const fd = new FormData();
        fd.append("file", photos[i]!);
        fd.append("cardId", id);
        fd.append("index", String(i));
        const uploadRes = await fetch("/api/dating/cards/upload", { method: "POST", body: fd });
        const uploadBody = (await uploadRes.json().catch(() => ({}))) as { path?: string; error?: string };
        if (!uploadRes.ok || !uploadBody.path) {
          setError(uploadBody.error ?? "사진 업로드 실패");
          setSubmitting(false);
          return;
        }
        uploadedPaths.push(uploadBody.path);
      }

      const payload = {
        card_id: id,
        applicant_display_nickname: displayNickname.trim(),
        age: Number(age),
        height_cm: Number(heightCm),
        region: region.trim(),
        job: job.trim(),
        training_years: Number(trainingYears),
        intro_text: introText.trim(),
        instagram_id: normalizedInstagramId,
        photo_paths: uploadedPaths,
        consent,
      };

      const res = await fetch("/api/dating/cards/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
      if (!res.ok) {
        setError(body.error ?? (body.code === "DAILY_APPLY_LIMIT" ? "하루 2회 제한에 도달했어요." : "지원 실패"));
        setSubmitting(false);
        return;
      }

      alert("지원이 완료되었습니다.");
      router.push("/mypage");
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    }

    setSubmitting(false);
  };

  if (loading || !card) {
    return (
      <main className="max-w-lg mx-auto px-4 py-8">
        <p className="text-sm text-neutral-500">불러오는 중...</p>
      </main>
    );
  }

  return (
    <main className="max-w-lg mx-auto px-4 py-8">
      <Link href="/community/dating/cards" className="text-sm text-neutral-500 hover:text-neutral-700">
        뒤로가기
      </Link>

      <h1 className="text-2xl font-bold text-neutral-900 mt-3">오픈카드 지원하기</h1>

      <div className="mt-4 rounded-xl border border-neutral-200 bg-white p-3">
        <p className="text-sm font-semibold text-neutral-900">{card.display_nickname}</p>
        {card.blur_thumb_url && (
          <div className="mt-2 h-40 rounded-lg overflow-hidden bg-neutral-50 border border-neutral-100 flex items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={card.blur_thumb_url} alt="" className="h-full w-full object-contain blur-[9px]" />
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="space-y-4 mt-6">
        <Field label="닉네임(표시용)" required>
          <input className="input" required maxLength={20} value={displayNickname} onChange={(e) => setDisplayNickname(e.target.value)} />
        </Field>

        <Field label="나이" required>
          <input className="input" type="number" min={19} max={99} required value={age} onChange={(e) => setAge(e.target.value)} />
        </Field>

        <Field label="키(cm)" required>
          <input className="input" type="number" min={120} max={230} required value={heightCm} onChange={(e) => setHeightCm(e.target.value)} />
        </Field>

        <Field label="지역" required>
          <input className="input" required maxLength={30} value={region} onChange={(e) => setRegion(e.target.value)} />
        </Field>

        <Field label="직업" required>
          <input className="input" required maxLength={50} value={job} onChange={(e) => setJob(e.target.value)} />
        </Field>

        <Field label="운동경력(년)" required>
          <input className="input" type="number" min={0} max={50} required value={trainingYears} onChange={(e) => setTrainingYears(e.target.value)} />
        </Field>

        <Field label="인스타 아이디(@ 없이)" required>
          <input className="input" required maxLength={30} value={instagramId} onChange={(e) => setInstagramId(normalizeInstagramId(e.target.value))} />
        </Field>

        <Field label="자기소개" required>
          <textarea className="w-full rounded-xl border border-neutral-300 px-3 py-2" required maxLength={1000} rows={4} value={introText} onChange={(e) => setIntroText(e.target.value)} />
        </Field>

        <Field label="지원 사진 1" required>
          <input type="file" accept="image/jpeg,image/png,image/webp" required onChange={(e) => handlePhotoChange(0, e.target.files?.[0] ?? null)} />
        </Field>

        <Field label="지원 사진 2" required>
          <input type="file" accept="image/jpeg,image/png,image/webp" required onChange={(e) => handlePhotoChange(1, e.target.files?.[0] ?? null)} />
        </Field>

        <label className="flex items-start gap-2 text-sm text-neutral-700">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1" />
          <span>지원 정보(인스타/사진 포함) 제출 및 매칭 진행에 동의합니다.</span>
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button type="submit" disabled={submitting} className="w-full min-h-[46px] rounded-xl bg-pink-500 text-white text-sm font-medium hover:bg-pink-600 disabled:opacity-50">
          {submitting ? "지원 중..." : "지원하기"}
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

function Field({ label, required = false, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-neutral-700 mb-1">
        {label} {required ? "*" : ""}
      </label>
      {children}
    </div>
  );
}
