"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

function PaymentFailContent() {
  const searchParams = useSearchParams();
  const code = searchParams.get("code") ?? "-";
  const message = searchParams.get("message") ?? "결제가 취소되었거나 정상적으로 완료되지 않았습니다.";
  const orderId = searchParams.get("orderId") ?? "-";

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <section className="rounded-3xl border border-neutral-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-bold text-neutral-900">결제가 진행되지 않았어요</h1>
        <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <p className="font-semibold">코드: {code}</p>
          <p className="mt-1">메시지: {message}</p>
          <p className="mt-1">주문번호: {orderId}</p>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/mypage"
            className="inline-flex min-h-[44px] items-center rounded-xl bg-neutral-900 px-4 text-sm font-semibold text-white hover:bg-neutral-800"
          >
            마이페이지로 돌아가기
          </Link>
          <Link
            href="/dating/1on1"
            className="inline-flex min-h-[44px] items-center rounded-xl border border-neutral-300 bg-white px-4 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
          >
            1:1 소개팅 보기
          </Link>
        </div>
      </section>
    </main>
  );
}

export default function PaymentFailPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto max-w-2xl px-4 py-8">
          <section className="rounded-3xl border border-neutral-200 bg-white p-6 shadow-sm">
            <h1 className="text-2xl font-bold text-neutral-900">결제가 진행되지 않았어요</h1>
            <p className="mt-4 text-sm text-neutral-500">결제 실패 정보를 불러오고 있어요.</p>
          </section>
        </main>
      }
    >
      <PaymentFailContent />
    </Suspense>
  );
}
