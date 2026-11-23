"use client";

import Link from "next/link";

export default function OneOnOneActionNotice({ message, onDismiss, matchHref }: { message: string; onDismiss: () => void; matchHref?: string }) {
  if (!message) return null;
  return (
    <div className="fixed inset-x-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-[70] mx-auto flex max-w-md flex-wrap items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-2 shadow-lg">
      <p role="status" aria-live="polite" aria-atomic="true" className="min-w-0 flex-1 break-words text-xs leading-5 text-neutral-800">{message}</p>
      {matchHref ? <Link href={matchHref} prefetch={false} onClick={onDismiss}
        className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg px-2 text-xs font-semibold text-rose-700 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-700">매칭 확인</Link> : null}
      <button type="button" onClick={onDismiss} aria-label={matchHref ? "매칭 안내 닫기" : "요청 전송 안내 닫기"} className="inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-lg px-2 text-xs text-neutral-500 hover:bg-neutral-50">닫기</button>
    </div>
  );
}
