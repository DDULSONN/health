"use client";

import { useState } from "react";

type Props = {
  id: string; error?: string; value: string; onChange: (value: string) => void;
  label: string; placeholder: string; hint: string; example: string; maxLength: number;
};

export default function GuidedIntroductionField({ id, error, value, onChange, label, placeholder, hint, example, maxLength }: Props) {
  const [showExample, setShowExample] = useState(false);
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-sm font-bold leading-6 text-neutral-800">{label}</label>
        <button type="button" aria-expanded={showExample} aria-controls={id + "-example"} aria-label={label + " 작성 예시"} onClick={() => setShowExample((open) => !open)} className="inline-flex min-h-9 shrink-0 items-center px-1 text-xs font-medium text-neutral-500 underline underline-offset-4 hover:text-neutral-900 focus-visible:outline-2 focus-visible:outline-rose-600">
          {showExample ? "예시 닫기" : "예시 보기"}
        </button>
      </div>
      <p id={id + "-hint"} className="mb-2 text-xs leading-5 text-neutral-500">{hint}</p>
      <div id={id + "-example"} hidden={!showExample} className="mb-2 rounded-lg bg-neutral-100 px-3 py-2.5 text-xs leading-5 text-neutral-600">
        <p>{example}</p>
        <p className="mt-1 text-[11px] text-neutral-500">참고만 하고, 내 이야기로 적어 주세요.</p>
      </div>
      <textarea id={id} aria-invalid={Boolean(error)} aria-describedby={[id + "-hint", showExample ? id + "-example" : "", error ? id + "-error" : ""].filter(Boolean).join(" ")} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} maxLength={maxLength} rows={3} className={`block w-full rounded-lg border ${error ? "border-rose-400" : "border-neutral-300"} bg-white px-3 py-3 text-sm leading-6 text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-neutral-900`} />
      <div className="mt-1.5 flex items-start justify-between gap-2">
        {error ? <p id={id + "-error"} className="text-xs leading-5 text-rose-700">{error}</p> : <span />}
        {value.length > 0 && <span aria-hidden="true" className="shrink-0 text-[11px] tabular-nums leading-5 text-neutral-400">{value.length}/{maxLength}</span>}
      </div>
    </div>
  );
}
