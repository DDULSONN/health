"use client";

export default function OneOnOneActionNotice({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  if (!message) return null;
  return (
    <div className="fixed inset-x-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-[70] mx-auto flex max-w-md items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-2 shadow-lg">
      <p role="status" aria-live="polite" aria-atomic="true" className="min-w-0 flex-1 break-words text-xs leading-5 text-neutral-800">{message}</p>
      <button type="button" onClick={onDismiss} aria-label="요청 전송 안내 닫기" className="inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-lg px-2 text-xs text-neutral-500 hover:bg-neutral-50">닫기</button>
    </div>
  );
}
