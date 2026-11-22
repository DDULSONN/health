import Link from "next/link";
import CompactPaidOffer from "@/components/dating/CompactPaidOffer";

export default function InstantOpenCardHint() {
  return (
    <div className="mt-3">
      <CompactPaidOffer title="기다리지 않고 공개하려면" description="무료 대기는 유지하고, 카드 한 장을 더 공개해요." itemId="paid_card" amount={10000} placement="open_card_waiting">
        <Link href="/dating/paid?apply=1&source=open_card" className="inline-flex min-h-11 shrink-0 items-center text-xs font-semibold text-rose-600 hover:text-rose-700">
          유료 등록 보기 · 10,000원
        </Link>
      </CompactPaidOffer>
    </div>
  );
}
