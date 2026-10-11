import Link from "next/link";

export default function OneOnOneContactPending({ status }: { status?: string }) {
  const checking = status === "paid" || status === "payment_pending_admin";
  return <div role="status" className="mt-3 rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-xs leading-5 text-neutral-600">
    <p>{checking ? "결제·번호 공개 상태를 확인 중이에요. 다시 결제하지 말고 결제 내역을 확인해 주세요."
      : status === "canceled" ? "연락처 교환이 종료된 매칭이에요."
      : "연락처 교환 상태를 확인할 수 없어요. 결제 내역을 먼저 확인해 주세요."}</p>
    {status !== "canceled" ? <Link href="/mypage?section=payment" className="mt-1 inline-flex min-h-[44px] items-center font-semibold text-neutral-800 underline">결제 내역 확인</Link> : null}
  </div>;
}
