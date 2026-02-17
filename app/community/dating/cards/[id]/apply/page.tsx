"use client";

import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

type CardDetail = {
  id: string;
  owner_user_id: string;
  sex: "male" | "female";
  age: number | null;
  region: string | null;
  height_cm: number | null;
  job: string | null;
  training_years: number | null;
  ideal_type: string | null;
  total_3lift: number | null;
  percent_all: number | null;
  is_3lift_verified: boolean;
  created_at: string;
  status: string;
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
          router.replace("/community/dating");
          return;
        }
        const data = (await res.json()) as { card?: CardDetail; can_apply?: boolean };
        if (!data.card || data.can_apply === false) {
          router.replace("/community/dating");
          return;
        }
        setCard(data.card);
      } catch {
        router.replace("/community/dating");
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
    if (!validInstagramId(normalizedInstagramId)) {
      setError("Invalid Instagram ID format.");
      return;
    }
    if (!consent) {
      setError("Consent is required.");
      return;
    }
    if (!photos[0] || !photos[1]) {
      setError("2 photos are required.");
      return;
    }

    for (const photo of photos) {
      if (!photo) continue;
      if (!ALLOWED_TYPES.includes(photo.type)) {
        setError("Only JPG/PNG/WebP is allowed.");
        return;
      }
      if (photo.size > MAX_FILE_SIZE) {
        setError("Each photo must be 5MB or less.");
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
        const uploadRes = await fetch("/api/dating/cards/upload", {
          method: "POST",
          body: fd,
        });
        const uploadBody = (await uploadRes.json().catch(() => ({}))) as { path?: string; error?: string };
        if (!uploadRes.ok || !uploadBody.path) {
          setError(uploadBody.error ?? "Photo upload failed.");
          setSubmitting(false);
          return;
        }
        uploadedPaths.push(uploadBody.path);
      }

      const payload = {
        card_id: id,
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
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? "Application failed.");
        setSubmitting(false);
        return;
      }

      alert("Application submitted.");
      router.push("/mypage");
    } catch {
      setError("Network error.");
    }
    setSubmitting(false);
  };

  if (loading || !card) {
    return (
      <main className="max-w-lg mx-auto px-4 py-8">
        <p className="text-sm text-neutral-500">Loading...</p>
      </main>
    );
  }

  return (
    <main className="max-w-lg mx-auto px-4 py-8">
      <Link href="/community/dating" className="text-sm text-neutral-500 hover:text-neutral-700">
        Back
      </Link>

      <h1 className="text-2xl font-bold text-neutral-900 mt-3">Apply to Card</h1>
      <p className="text-sm text-neutral-500 mt-1">Card ID: {card.id}</p>

      <form onSubmit={handleSubmit} className="space-y-4 mt-6">
        <Field label="Age" required>
          <input type="number" min={19} max={99} required value={age} onChange={(e) => setAge(e.target.value)} className="input" />
        </Field>

        <Field label="Height (cm)" required>
          <input type="number" min={120} max={230} required value={heightCm} onChange={(e) => setHeightCm(e.target.value)} className="input" />
        </Field>

        <Field label="Region" required>
          <input type="text" required maxLength={30} value={region} onChange={(e) => setRegion(e.target.value)} className="input" />
        </Field>

        <Field label="Job" required>
          <input type="text" required maxLength={50} value={job} onChange={(e) => setJob(e.target.value)} className="input" />
        </Field>

        <Field label="Training Years" required>
          <input type="number" min={0} max={50} required value={trainingYears} onChange={(e) => setTrainingYears(e.target.value)} className="input" />
        </Field>

        <Field label="Instagram ID" required>
          <input
            type="text"
            required
            maxLength={30}
            value={instagramId}
            onChange={(e) => setInstagramId(normalizeInstagramId(e.target.value))}
            className="input"
            placeholder="instagram_id"
          />
        </Field>

        <Field label="Intro Text" required>
          <textarea
            required
            rows={4}
            maxLength={1000}
            value={introText}
            onChange={(e) => setIntroText(e.target.value)}
            className="w-full rounded-xl border border-neutral-300 px-3 py-2"
          />
        </Field>

        <Field label="Photo 1" required>
          <input type="file" accept="image/jpeg,image/png,image/webp" required onChange={(e) => handlePhotoChange(0, e.target.files?.[0] ?? null)} />
        </Field>

        <Field label="Photo 2" required>
          <input type="file" accept="image/jpeg,image/png,image/webp" required onChange={(e) => handlePhotoChange(1, e.target.files?.[0] ?? null)} />
        </Field>

        <label className="flex items-start gap-2 text-sm text-neutral-700">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1" />
          <span>I agree to submit my information and photos for dating card application.</span>
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="w-full min-h-[46px] rounded-xl bg-pink-500 text-white text-sm font-medium hover:bg-pink-600 disabled:opacity-50"
        >
          {submitting ? "Submitting..." : "Submit Application"}
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

function Field({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-neutral-700 mb-1">
        {label} {required ? "*" : ""}
      </label>
      {children}
    </div>
  );
}
