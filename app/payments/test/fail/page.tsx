"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import PaymentCardNotice from "@/components/PaymentCardNotice";

function PaymentFailContent() {
  const searchParams = useSearchParams();
  const code = searchParams.get("code") ?? "-";
  const message = searchParams.get("message") ?? "결제가 취소되었거나 승인되지 않았습니다.";
  const orderId = searchParams.get("orderId") ?? "-";
  const canceled = code === "PAY_PROCESS_CANCELED";

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <section className="rounded-3xl border border-neutral-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-bold text-neutral-900">{canceled ? "결제를 중단했어요" : "결제 진행 실패"}</h1>
        <PaymentCardNotice prominent className="mt-4" />
        <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <p className="font-semibold">코드: {code}</p>
          <p className="mt-1">메시지: {message}</p>
          <p className="mt-1">주문번호: {orderId}</p>
        </div>

        <p className="mt-4 text-xs leading-5 text-neutral-500">승인 문자를 받았다면 다시 결제하기 전에 결제 내역을 먼저 확인해 주세요.</p>

        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/payments/test"
            className="inline-flex min-h-[44px] items-center rounded-xl bg-neutral-900 px-4 text-sm font-semibold text-white hover:bg-neutral-800"
          >
            다시 결제하기
          </Link>
          <Link
            href="/mypage"
            className="inline-flex min-h-[44px] items-center rounded-xl border border-neutral-300 bg-white px-4 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
          >
            마이페이지
          </Link>
        </div>
      </section>
    </main>
  );
}

export default function TestPaymentFailPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto max-w-2xl px-4 py-8">
          <section className="rounded-3xl border border-neutral-200 bg-white p-6 shadow-sm">
            <h1 className="text-2xl font-bold text-neutral-900">결제 진행 실패</h1>
            <p className="mt-4 text-sm text-neutral-500">결제 실패 정보를 불러오고 있습니다.</p>
          </section>
        </main>
      }
    >
      <PaymentFailContent />
    </Suspense>
  );
}
