import Link from "next/link";

export default function InstantOpenCardHint() {
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-neutral-100 pt-3">
      <div className="text-[11px] leading-5 text-neutral-500">
        <p>기다리는 동안 별도 카드로 바로 공개해 보세요.</p>
        <p>기존 대기 순번 유지 · 상대방은 지원권 차감 없이 지원</p>
      </div>
      <Link href="/dating/paid?apply=1&source=open_card" className="inline-flex min-h-10 shrink-0 items-center text-xs font-semibold text-rose-600 hover:text-rose-700">
        대기 없이 등록 · 10,000원 ›
      </Link>
    </div>
  );
}
