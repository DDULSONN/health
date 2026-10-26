"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

export default function ApplicationCompleteNotice({ historyHref, listHref }: { historyHref: string; listHref: string }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  return (
    <main className="mx-auto max-w-lg px-4 py-8">
      <section className="rounded-2xl border border-neutral-200 bg-white p-5">
        <h1 ref={heading} tabIndex={-1} className="text-xl font-bold text-neutral-950 outline-none">지원이 완료됐어요</h1>
        <p className="mt-2 text-sm leading-6 text-neutral-600">상대방의 답변은 마이페이지의 ‘내 지원’에서 확인할 수 있어요.</p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Link href={historyHref} className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-[#f0003d] px-4 text-sm font-semibold text-white hover:bg-[#d90037] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900">내 지원 확인</Link>
          <Link href={listHref} className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-neutral-200 px-4 text-sm text-neutral-700 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900">카드 더 보기</Link>
        </div>
      </section>
    </main>
  );
}
