"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function Footer() {
  const pathname = usePathname();

  if (pathname === "/" || pathname.startsWith("/landing")) return null;

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

        <div className="mt-3 flex flex-wrap justify-center gap-3 text-[11px] text-neutral-500">
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
          <span>|</span>
          <Link href="/dating-policy" className="transition-colors hover:text-neutral-700">
            소개팅 운영정책
          </Link>
        </div>

        <p className="mt-3 text-xs text-neutral-300">&copy; {new Date().getFullYear()} GymTools. All rights reserved.</p>
      </div>
    </footer>
  );
}
