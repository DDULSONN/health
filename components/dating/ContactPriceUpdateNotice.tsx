"use client";

import { useEffect, useId, useRef } from "react";
import { CONTACT_PRICE_UPDATE_NOTICE as notice } from "@/lib/contact-price-update-notice";

// Visibility, fixed expiry and one-time acknowledgement are managed by the host.
export default function ContactPriceUpdateNotice({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    const overflow = document.body.style.overflow;
    dialog?.showModal();
    document.body.style.overflow = "hidden";
    return () => { dialog?.close(); document.body.style.overflow = overflow; };
  }, []);
  return <dialog ref={ref} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose(); }}
    className="m-auto max-h-[85dvh] w-[calc(100%_-_2rem)] max-w-sm overflow-y-auto rounded-2xl border border-neutral-200 bg-white p-5 text-neutral-900 shadow-xl backdrop:bg-black/45">
    <p className="text-xs font-medium text-neutral-500">짐툴 이용 안내</p>
    <h2 id={titleId} className="mt-2 text-lg font-semibold leading-7 tracking-tight">{notice.title}</h2>
    <div className="mt-4 rounded-xl bg-neutral-50 px-4 py-3">
      <p className="text-xs font-semibold text-neutral-700">{notice.priceLabel}</p>
      <p className="mt-1 flex flex-wrap items-baseline gap-2">
        <span className="text-sm text-neutral-400 line-through">{notice.previousPrice.toLocaleString("ko-KR")}원</span>
        <span aria-hidden="true" className="text-neutral-400">→</span>
        <strong className="text-xl font-bold text-[#f0003d]">{notice.price.toLocaleString("ko-KR")}원</strong>
      </p>
      <p className="mt-1 text-[11px] leading-5 text-neutral-500">{notice.priceNote}</p>
    </div>
    <div className="mt-4 space-y-3 text-[13px] leading-6 text-neutral-600">
      {notice.paragraphs.map(paragraph => <p key={paragraph}>{paragraph}</p>)}
    </div>
    <button type="button" onClick={onClose} className="mt-5 min-h-11 w-full rounded-xl bg-neutral-950 px-4 text-sm font-semibold text-white hover:bg-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-500">확인</button>
  </dialog>;
}
