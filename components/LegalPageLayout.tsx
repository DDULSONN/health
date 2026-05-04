import Link from "next/link";

type LegalPageLayoutProps = {
  title: string;
  description: string;
  updatedAt: string;
  children: React.ReactNode;
};

export default function LegalPageLayout({
  title,
  description,
  updatedAt,
  children,
}: LegalPageLayoutProps) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <div className="rounded-3xl border border-neutral-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="mb-8 space-y-2 border-b border-neutral-100 pb-6">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-emerald-700">Legal</p>
          <h1 className="text-3xl font-bold text-neutral-900">{title}</h1>
          <p className="text-sm leading-relaxed text-neutral-600">{description}</p>
          <p className="text-xs text-neutral-400">최종 업데이트: {updatedAt}</p>
        </div>

        <div className="space-y-8 text-sm leading-7 text-neutral-700">{children}</div>

        <div className="mt-10 flex flex-wrap gap-4 border-t border-neutral-100 pt-5 text-xs text-neutral-500">
          <Link href="/terms" className="hover:text-neutral-700">
            이용약관
          </Link>
          <Link href="/privacy" className="hover:text-neutral-700">
            개인정보처리방침
          </Link>
          <Link href="/refund" className="hover:text-neutral-700">
            환불/취소 규정
          </Link>
          <Link href="/dating-policy" className="hover:text-neutral-700">
            소개팅 안전/운영정책
          </Link>
        </div>
      </div>
    </main>
  );
}
