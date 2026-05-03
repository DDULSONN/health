"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

function getPrimaryAction(productType?: string | null) {
  if (productType === "paid_card") {
    return { href: "/dating/paid", label: "대기 없이 등록으로 돌아가기" };
  }
  if (productType === "swipe_premium_30d") {
    return { href: "/community/dating/cards", label: "빠른매칭으로 돌아가기" };
  }
  if (productType === "more_view") {
    return { href: "/dating/more-view", label: "이상형 더보기로 돌아가기" };
  }
  if (productType === "city_view") {
    return { href: "/dating/nearby-view", label: "가까운 이상형 보기로 돌아가기" };
  }
  if (productType === "one_on_one_contact_exchange") {
    return { href: "/mypage", label: "마이페이지로 돌아가기" };
  }
  return { href: "/mypage", label: "마이페이지로 돌아가기" };
}

function PaymentFailContent() {
  const searchParams = useSearchParams();
  const code = searchParams.get("code") ?? "-";
  const message = searchParams.get("message") ?? "결제가 취소됐거나 정상적으로 완료되지 않았습니다.";
  const orderId = searchParams.get("orderId") ?? "-";
  const productType = searchParams.get("productType");
  const primaryAction = getPrimaryAction(productType);

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <section className="rounded-3xl border border-neutral-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-bold text-neutral-900">결제가 진행되지 않았어요</h1>
        <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <p className="font-semibold">코드: {code}</p>
          <p className="mt-1 break-words">메시지: {message}</p>
          <p className="mt-1">주문번호: {orderId}</p>
        </div>

        <p className="mt-4 text-sm text-neutral-500">카카오페이로 다시 시도해 보시고, 같은 문제가 이어지면 오픈카톡으로 문의해 주세요.</p>

        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href={primaryAction.href}
            className="inline-flex min-h-[44px] items-center rounded-xl bg-neutral-900 px-4 text-sm font-semibold text-white hover:bg-neutral-800"
          >
            {primaryAction.label}
          </Link>
          <Link
            href={productType === "one_on_one_contact_exchange" ? "/dating/1on1" : "/mypage"}
            className="inline-flex min-h-[44px] items-center rounded-xl border border-neutral-300 bg-white px-4 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
          >
            {productType === "one_on_one_contact_exchange" ? "1:1 소개팅 보기" : "마이페이지"}
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
