import Link from "next/link";

export default function Footer() {
  return (
    <footer className="border-t border-neutral-200 bg-neutral-50 mt-auto">
      <div className="max-w-4xl mx-auto px-4 py-6 text-center space-y-2">
        <p className="text-xs text-neutral-400">
          본 사이트는 제휴/광고 링크를 포함할 수 있으며, 이를 통해 일정액의
          수수료를 제공받을 수 있습니다.
        </p>
        <div className="flex justify-center gap-4 text-xs text-neutral-400">
          <Link href="/" className="hover:text-neutral-600 transition-colors">
            홈
          </Link>
          <span>|</span>
          <span>문의: gymtools.kr@gmail.com</span>
        </div>
        <p className="text-xs text-neutral-300">
          &copy; {new Date().getFullYear()} GymTools. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
