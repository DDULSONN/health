"use client";

import { type ReactNode, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

function normalizeInstagramId(value: string) {
  return value.trim().replace(/^@+/, "").replace(/\s+/g, "").slice(0, 30);
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
  const [ownerInstagramId, setOwnerInstagramId] = useState("");
  const [total3Lift, setTotal3Lift] = useState("");
  const [percentAll, setPercentAll] = useState("");
  const [is3LiftVerified, setIs3LiftVerified] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);

    const payload = {
      sex,
      age: Number(age),
      region: region.trim(),
      height_cm: Number(heightCm),
      job: job.trim(),
      training_years: Number(trainingYears),
      ideal_type: idealType.trim(),
      owner_instagram_id: normalizeInstagramId(ownerInstagramId),
      total_3lift: sex === "male" && total3Lift ? Number(total3Lift) : null,
      percent_all: sex === "male" && percentAll ? Number(percentAll) : null,
      is_3lift_verified: sex === "male" ? is3LiftVerified : false,
    };

    const res = await fetch("/api/dating/cards/my", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      setError(body.error ?? "Failed to create card");
      setSubmitting(false);
      return;
    }

    alert("Card created. It will be visible after admin approval.");
    router.push("/mypage");
  };

  return (
    <main className="max-w-lg mx-auto px-4 py-8">
      <Link href="/community/dating" className="text-sm text-neutral-500 hover:text-neutral-700">
        Back
      </Link>

      <h1 className="text-2xl font-bold text-neutral-900 mt-3">Create Public Dating Card</h1>
      <p className="text-sm text-neutral-500 mt-1">This card will be reviewed by admin before becoming public.</p>

      <form onSubmit={submit} className="space-y-4 mt-6">
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">Sex *</label>
          <div className="flex gap-2">
            <button type="button" onClick={() => setSex("male")} className={`h-10 px-4 rounded-lg border ${sex === "male" ? "bg-pink-500 text-white border-pink-500" : "bg-white"}`}>
              Male
            </button>
            <button type="button" onClick={() => setSex("female")} className={`h-10 px-4 rounded-lg border ${sex === "female" ? "bg-pink-500 text-white border-pink-500" : "bg-white"}`}>
              Female
            </button>
          </div>
        </div>

        <Field label="Age *"><input className="input" required type="number" min={19} max={99} value={age} onChange={(e) => setAge(e.target.value)} /></Field>
        <Field label="Region"><input className="input" maxLength={30} value={region} onChange={(e) => setRegion(e.target.value)} /></Field>
        <Field label="Height (cm) *"><input className="input" required type="number" min={120} max={230} value={heightCm} onChange={(e) => setHeightCm(e.target.value)} /></Field>
        <Field label="Job"><input className="input" maxLength={50} value={job} onChange={(e) => setJob(e.target.value)} /></Field>
        <Field label="Training Years *"><input className="input" required type="number" min={0} max={50} value={trainingYears} onChange={(e) => setTrainingYears(e.target.value)} /></Field>
        <Field label="Ideal Type"><textarea className="w-full rounded-xl border border-neutral-300 px-3 py-2" maxLength={1000} rows={4} value={idealType} onChange={(e) => setIdealType(e.target.value)} /></Field>
        <Field label="Instagram ID *"><input className="input" required maxLength={30} value={ownerInstagramId} onChange={(e) => setOwnerInstagramId(normalizeInstagramId(e.target.value))} /></Field>

        {sex === "male" && (
          <>
            <Field label="Total 3-lift (kg)"><input className="input" type="number" min={0} value={total3Lift} onChange={(e) => setTotal3Lift(e.target.value)} /></Field>
            <Field label="Percent All"><input className="input" type="number" step="0.01" min={0} value={percentAll} onChange={(e) => setPercentAll(e.target.value)} /></Field>
            <label className="flex items-center gap-2 text-sm text-neutral-700">
              <input type="checkbox" checked={is3LiftVerified} onChange={(e) => setIs3LiftVerified(e.target.checked)} />
              <span>3-lift verified</span>
            </label>
          </>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button type="submit" disabled={submitting} className="w-full min-h-[46px] rounded-xl bg-pink-500 text-white text-sm font-medium hover:bg-pink-600 disabled:opacity-50">
          {submitting ? "Submitting..." : "Create Card"}
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

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-neutral-700 mb-1">{label}</label>
      {children}
    </div>
  );
}
