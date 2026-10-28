"use client";

import { useEffect, useId, useRef } from "react";

type Props = {
  onClose: () => void;
  onExplore: () => void;
  onSettings: () => void;
};

// Presentation only. The site-wide host owns the release window and acknowledgement.
export default function FriendRecommendationNotice({ onClose, onExplore, onSettings }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialog && !dialog.open) dialog.showModal();
    titleRef.current?.focus({ preventScroll: true });
    document.body.style.overflow = "hidden";
    return () => {
      dialog?.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={event => { event.preventDefault(); onClose(); }}
      className="m-auto max-h-[calc(100dvh_-_2rem)] w-[calc(100%_-_2rem)] max-w-[384px] overflow-y-auto overscroll-contain rounded-[18px] border border-neutral-200 bg-white p-5 break-keep text-neutral-900 shadow-xl backdrop:bg-black/40 sm:p-6"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 ref={titleRef} tabIndex={-1} id={titleId} className="text-lg font-semibold leading-7 tracking-tight outline-none">친구 추천 기능 안내</h2>
        <button type="button" onClick={onClose} aria-label="친구 추천 안내 닫기"
          className="-mr-2 grid h-10 w-10 shrink-0 place-items-center rounded-full text-neutral-400 hover:bg-neutral-50 hover:text-neutral-900 focus-visible:outline-2 focus-visible:outline-rose-500">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
        </button>
      </div>

      <p id={descriptionId} className="mt-3 text-[13px] leading-6 text-neutral-600">오픈카드나 1:1 후보에서 <span className="font-medium text-neutral-900">‘친구에게 추천’</span>을 누르면, 프로필 링크를 만들어 친구에게 보낼 수 있어요.</p>
      <p className="mt-3 text-xs leading-5 text-neutral-500">한 번에 최대 3명 · 링크는 24시간 동안 유효</p>

      <div className="mt-5 border-t border-neutral-100 pt-3 text-xs leading-[1.75] text-neutral-500">
        <div className="flex items-center justify-between gap-2">
          <p className="font-medium text-neutral-800">내 프로필 추천 <span className="ml-1 text-xs font-normal text-neutral-500">· 기본 ON</span></p>
          <button type="button" onClick={onSettings} className="-mr-1 min-h-10 shrink-0 px-1 text-xs text-neutral-600 underline decoration-neutral-300 underline-offset-4 hover:text-neutral-950">설정 보기</button>
        </div>
        <p>원치 않으면 설정에서 끌 수 있어요.</p>
        <details className="group mt-2">
          <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-2 rounded-md text-xs text-neutral-600 focus-visible:outline-2 focus-visible:outline-rose-500 [&::-webkit-details-marker]:hidden">공개 범위 안내<svg className="shrink-0 text-neutral-400 group-open:rotate-180" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeLinecap="round" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg></summary>
          <p className="pb-2 text-xs leading-5 text-neutral-500">비회원에게는 블러 처리된 사진·연령대·시도만 보여요. 자세한 프로필은 가입·휴대폰 인증 후 볼 수 있어요.</p>
        </details>
      </div>

      <button type="button" onClick={onExplore} className="mt-3 min-h-11 w-full rounded-lg bg-neutral-950 px-4 text-[13px] font-medium text-white hover:bg-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-500">프로필 보기</button>
    </dialog>
  );
}
