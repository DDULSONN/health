import Link from "next/link";

export default function Footer() {
  return (
    <footer className="mt-auto border-t border-neutral-200 bg-neutral-50">
      <div className="mx-auto max-w-4xl px-4 py-6 text-center space-y-2">
        <div className="text-xs text-neutral-500">
          <span>상호명: 알파핏</span>
          <span className="mx-2 text-neutral-300">|</span>
          <span>문의: gymtools.kr@gmail.com</span>
        </div>

        <div className="flex justify-center gap-3 text-[11px] text-neutral-400">
          <Link href="/terms" className="transition-colors hover:text-neutral-600">
            이용약관
          </Link>
          <span>|</span>
          <Link href="/privacy" className="transition-colors hover:text-neutral-600">
            개인정보처리방침
          </Link>
          <span>|</span>
          <Link href="/refund" className="transition-colors hover:text-neutral-600">
            환불/취소
          </Link>
        </div>

        <details className="mx-auto max-w-xl rounded-md border border-neutral-200 bg-white px-3 py-2 text-left text-xs text-neutral-500">
          <summary className="cursor-pointer text-neutral-600">환불/취소 규정 요약</summary>
          <div className="mt-2 space-y-1">
            <p>결제 후 서비스가 시작되기 전에는 운영 확인 후 환불이 검토될 수 있습니다.</p>
            <p>서비스 제공이 이미 시작된 경우 환불이 제한될 수 있습니다.</p>
            <p>문의: gymtools.kr@gmail.com</p>
          </div>
        </details>

        <p className="text-xs text-neutral-400">
          본 사이트는 제휴/광고 링크를 포함할 수 있으며, 이를 통해 일정 수수료를 제공받을 수 있습니다.
        </p>

        <div className="flex justify-center gap-4 text-xs text-neutral-400">
          <Link href="/" className="transition-colors hover:text-neutral-600">
            홈
          </Link>
          <span>|</span>
          <span>문의: gymtools.kr@gmail.com</span>
        </div>

        <p className="text-xs text-neutral-300">&copy; {new Date().getFullYear()} GymTools. All rights reserved.</p>
      </div>
    </footer>
  );
}
