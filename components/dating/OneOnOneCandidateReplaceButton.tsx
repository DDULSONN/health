"use client";

export default function OneOnOneCandidateReplaceButton({ onClick, busy, disabled }: {
  onClick: () => void;
  busy: boolean;
  disabled: boolean;
}) {
  return <button type="button" onClick={onClick} disabled={disabled || busy} aria-busy={busy}
    className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-neutral-200 bg-white px-3 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900 disabled:cursor-not-allowed disabled:opacity-50">
    <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 11a8 8 0 0 0-13-5L4 9m0-5v5h5m-5 4a8 8 0 0 0 13 5l3-3m0 5v-5h-5" />
    </svg>
    {busy ? "바꾸는 중…" : "새 후보"}
  </button>;
}
