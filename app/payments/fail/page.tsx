"use client";

import { Suspense, useEffect } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { normalizeDatingApplyReturn } from "@/lib/dating-apply-return";
import PaymentCardNotice from "@/components/PaymentCardNotice";
import { getPaymentRecoveryAction, normalizeFailureOrderId, normalizePaymentFailureCode } from "@/lib/payment-guidance";
import { reportPaymentFailure } from "@/lib/payment-failure-client";
import ContactPaymentRecovery from "@/components/dating/ContactPaymentRecovery";

function PaymentFailContent() {
  const searchParams = useSearchParams();
  const code = normalizePaymentFailureCode(searchParams.get("code"));
  const message = (searchParams.get("message") ?? "결제가 중단되었거나 정상적으로 완료되지 않았습니다.").slice(0, 500);
  const orderId = normalizeFailureOrderId(searchParams.get("failedOrderId")) ?? normalizeFailureOrderId(searchParams.get("orderId"));
  const productType = searchParams.get("productType");
  const applyReturn = productType === "apply_credits" ? normalizeDatingApplyReturn(searchParams.get("returnTo")) : null;
  const primaryAction = getPaymentRecoveryAction(productType, { returnTo: applyReturn, province: searchParams.get("province") });
  const canceled = code === "PAY_PROCESS_CANCELED";

  useEffect(() => {
    void reportPaymentFailure(orderId, code);
  }, [orderId, code]);

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <section className="rounded-3xl border border-neutral-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-bold text-neutral-900">{orderId && productType === "one_on_one_contact_exchange" ? "연락처 교환 결제 확인" : canceled ? "결제를 중단했어요" : "결제가 완료되지 않았어요"}</h1>
        {orderId && productType === "one_on_one_contact_exchange" ? <ContactPaymentRecovery orderId={orderId} /> : null}
        <PaymentCardNotice prominent className="mt-4" />
        <p className="mt-2 text-sm leading-6 text-neutral-600">{primaryAction.description}</p>
        <p className="mt-2 text-xs leading-5 text-neutral-500">간편결제에 연결한 카드도 제한될 수 있어요. 승인 문자를 받았다면 다시 결제하기 전에 결제 내역을 먼저 확인해 주세요.</p>

        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Link
            href={primaryAction.href}
            className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-neutral-900 px-4 py-2 text-center text-sm font-semibold text-white hover:bg-neutral-800"
          >
            {primaryAction.label}
          </Link>
          <Link
            href={applyReturn ?? (primaryAction.href === "/mypage?section=payment" ? "/mypage?section=matching" : "/mypage?section=payment")}
            className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
          >
            {applyReturn ? "작성하던 지원서로 돌아가기" : primaryAction.href === "/mypage?section=payment" ? "내 매칭 보기" : "결제 내역 확인"}
          </Link>
        </div>
        <details className="mt-5 rounded-xl border border-neutral-200 px-3 py-3 text-xs leading-5 text-neutral-500">
          <summary className="cursor-pointer font-medium text-neutral-600">오류 정보 · 문의 시 확인해 주세요</summary>
          <div className="mt-2 space-y-1 break-all">
            <p>코드: {code}</p>
            <p>메시지: {message}</p>
            <p>주문번호: {orderId ?? "확인되지 않음"}</p>
          </div>
        </details>
        <Link href="/mypage?section=settings" className="mt-4 inline-flex min-h-[44px] items-center text-xs text-neutral-500 underline">계속 결제가 안 된다면 문의해 주세요</Link>
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
