import Link from "next/link";

export default function Footer() {
  return (
    <footer className="mt-auto border-t border-neutral-200 bg-neutral-50">
      <div className="mx-auto max-w-5xl px-4 py-6 text-center">
        <div className="space-y-2 text-[11px] leading-5 text-neutral-500">
          <p>
            상호명: 알파핏
            <span className="mx-2 text-neutral-300">|</span>
            대표자: 김준호
            <span className="mx-2 text-neutral-300">|</span>
            사업자등록번호: 466-39-01271
            <span className="mx-2 text-neutral-300">|</span>
            통신판매업 신고번호: 2025-수원권선-0625
          </p>
          <p>
            주소: 수원시 권선구 50번길
            <span className="mx-2 text-neutral-300">|</span>
            연락처: 010-8693-0657
            <span className="mx-2 text-neutral-300">|</span>
            이메일: gymtools.kr@gmail.com
          </p>
        </div>

        <div className="mt-3 flex justify-center gap-3 text-[11px] text-neutral-500">
          <Link href="/terms" className="transition-colors hover:text-neutral-700">
            이용약관
          </Link>
          <span>|</span>
          <Link href="/privacy" className="transition-colors hover:text-neutral-700">
            개인정보처리방침
          </Link>
          <span>|</span>
          <Link href="/refund" className="transition-colors hover:text-neutral-700">
            환불/취소 규정
          </Link>
        </div>

        <details className="mx-auto mt-4 max-w-2xl rounded-md border border-neutral-200 bg-white px-3 py-2 text-left text-xs text-neutral-500">
          <summary className="cursor-pointer text-neutral-700">상품 및 환불 안내 요약</summary>
          <div className="mt-2 space-y-1 leading-5">
            <p>유료 상품은 각 상품 안내 페이지에 기재된 노출 방식, 제공 시점, 이용 시간 기준으로 제공됩니다.</p>
            <p>서비스 제공 전에는 문의 확인 후 환불 검토가 가능할 수 있으나, 노출 또는 이용이 시작된 뒤에는 환불이 제한될 수 있습니다.</p>
            <p>결제 및 환불 문의: gymtools.kr@gmail.com / 010-8693-0657</p>
          </div>
        </details>

        <p className="mt-4 text-xs text-neutral-400">
          본 사이트는 제휴 및 광고 링크를 포함할 수 있으며, 일부 링크를 통해 일정 수수료를 제공받을 수 있습니다.
        </p>

        <p className="mt-3 text-xs text-neutral-300">&copy; {new Date().getFullYear()} GymTools. All rights reserved.</p>
      </div>
    </footer>
  );
}
