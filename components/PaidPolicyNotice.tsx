import Link from "next/link";

const OPEN_KAKAO_URL = process.env.NEXT_PUBLIC_OPENKAKAO_URL ?? "https://open.kakao.com/o/s2gvTdhi";

type PaidPolicyNoticeProps = {
  className?: string;
};

export default function PaidPolicyNotice({ className = "" }: PaidPolicyNoticeProps) {
  return (
    <section
      className={`mt-5 rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-[11px] leading-5 text-neutral-500 ${className}`.trim()}
    >
      <p>결제 후 열람, 노출, 지원권 지급, 연락처 교환 등 서비스 제공이 시작된 상품은 환불이 제한될 수 있어요.</p>
      <p className="mt-1">결제 오류나 미반영 건은 주문번호와 닉네임을 알려주시면 빠르게 확인해드릴게요.</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-medium text-neutral-600">
        <Link href="/refund" className="hover:text-neutral-900">
          환불/취소 규정
        </Link>
        <a href={OPEN_KAKAO_URL} target="_blank" rel="noreferrer" className="hover:text-neutral-900">
          오픈카톡 문의
        </a>
      </div>
    </section>
  );
}
