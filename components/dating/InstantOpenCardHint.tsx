import Link from "next/link";
import CompactPaidOffer from "@/components/dating/CompactPaidOffer";

export default function InstantOpenCardHint() {
  return (
    <div className="mt-3">
      <CompactPaidOffer title="대기 중에도 바로 공개할 수 있어요" description="기존 대기 순번 유지 · 상대방은 지원권 차감 없이 지원" itemId="paid_card" amount={10000} placement="open_card_waiting">
        <Link href="/dating/paid?apply=1&source=open_card" className="inline-flex min-h-11 shrink-0 items-center text-xs font-semibold text-rose-600 hover:text-rose-700">
          대기 없이 등록 · 10,000원 ›
        </Link>
      </CompactPaidOffer>
    </div>
  );
}
