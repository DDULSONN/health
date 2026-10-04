"use client";

import Link from "next/link";
import type { usePaidRegistrationStatus } from "@/lib/use-paid-registration-status";
import { PAID_REGISTRATION_MANAGE_HREF } from "@/lib/paid-registration-status";

export default function PaidRegistrationStatus({ state, afterPayment = false }: {
  state: ReturnType<typeof usePaidRegistrationStatus>;
  afterPayment?: boolean;
}) {
  const { card, presentation, loading, error, reload } = state;
  if (!loading && !error && !card && !afterPayment) return null;
  const needsCheck = error || (!loading && afterPayment && !presentation?.active);
  return (
    <div className="my-3 rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-xs" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <p className="font-semibold text-neutral-800">
            {loading ? "등록 상태 확인 중…" : needsCheck ? "공개 상태 확인 필요" : `${presentation?.product} · ${presentation?.label}`}
          </p>
          {presentation?.active && !loading && !error ? <p className="mt-0.5 text-[11px] text-neutral-500">{afterPayment ? "등록 완료 · " : ""}{presentation.remaining}</p> : null}
        </div>
        {!loading ? <div className="flex shrink-0 items-center gap-3">
          {needsCheck ? <button type="button" onClick={() => void reload()} className="min-h-8 font-semibold text-neutral-700 underline underline-offset-2">다시 확인</button> : null}
          <Link href={presentation?.active && !error && card ? `/dating/paid/${card.id}` : PAID_REGISTRATION_MANAGE_HREF} className="inline-flex min-h-8 items-center font-semibold text-rose-600">
            {presentation?.active && !error ? "내 카드 보기" : "등록 내역"} ›
          </Link>
        </div> : null}
      </div>
      {needsCheck && afterPayment ? <p className="mt-1 text-[11px] leading-5 text-neutral-500">결제는 확인됐어요. 다시 결제하지 말고 등록 내역을 확인해 주세요.</p> : null}
    </div>
  );
}
