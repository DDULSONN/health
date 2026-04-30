"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

type ConfirmResponse = {
  ok?: boolean;
  orderId?: string;
  paymentKey?: string;
  productType?: string;
  amount?: number;
  method?: string | null;
  addedCredits?: number;
  creditsAfter?: number;
  alreadyConfirmed?: boolean;
  message?: string;
};

function formatProductType(productType?: string) {
  if (productType === "apply_credits") return "지원권 3장 구매";
  if (productType === "paid_card") return "유료카드 등록 결제";
  if (productType === "more_view") return "이상형 더보기";
  return "-";
}

function PaymentSuccessContent() {
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ConfirmResponse | null>(null);

  useEffect(() => {
    const paymentKey = searchParams.get("paymentKey") ?? "";
    const orderId = searchParams.get("orderId") ?? "";
    const amount = searchParams.get("amount") ?? "";

    if (!paymentKey || !orderId || !amount) {
      setError("결제 확인 정보가 올바르지 않습니다.");
      setLoading(false);
      return;
    }

    let cancelled = false;
    queueMicrotask(async () => {
      try {
        const res = await fetch("/api/payments/toss/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paymentKey, orderId, amount }),
        });
        const body = (await res.json().catch(() => ({}))) as ConfirmResponse;
        if (!res.ok || !body.ok) {
          if (!cancelled) setError(body.message ?? "결제 확인 처리에 실패했습니다.");
          return;
        }
        if (!cancelled) setResult(body);
      } catch {
        if (!cancelled) setError("결제 확인 중 네트워크 오류가 발생했습니다.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [searchParams]);

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <section className="rounded-3xl border border-neutral-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-bold text-neutral-900">결제가 완료됐어요</h1>

        {loading ? <p className="mt-4 text-sm text-neutral-500">결제 승인 상태를 확인하고 있어요.</p> : null}
        {error ? <p className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p> : null}

        {!loading && !error && result ? (
          <div className="mt-4 space-y-3">
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-sm font-semibold text-emerald-800">
                {result.alreadyConfirmed ? "이미 승인 처리된 결제입니다." : "결제가 정상적으로 승인됐습니다."}
              </p>
              <p className="mt-1 text-sm text-emerald-900">주문번호: {result.orderId ?? "-"}</p>
              <p className="mt-1 text-sm text-emerald-900">결제 키: {result.paymentKey ?? "-"}</p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-700">
                <p className="text-xs font-medium text-neutral-500">상품</p>
                <p className="mt-1 font-semibold text-neutral-900">{formatProductType(result.productType)}</p>
              </div>
              <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-700">
                <p className="text-xs font-medium text-neutral-500">결제금액</p>
                <p className="mt-1 font-semibold text-neutral-900">
                  {typeof result.amount === "number" ? `${result.amount.toLocaleString("ko-KR")}원` : "-"}
                </p>
              </div>
              <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-700">
                <p className="text-xs font-medium text-neutral-500">결제수단</p>
                <p className="mt-1 font-semibold text-neutral-900">{result.method ?? "-"}</p>
              </div>
              <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-700">
                <p className="text-xs font-medium text-neutral-500">지원권 지급 결과</p>
                <p className="mt-1 font-semibold text-neutral-900">
                  {typeof result.addedCredits === "number" && result.addedCredits > 0
                    ? `+${result.addedCredits}장 / 보유 ${result.creditsAfter ?? 0}장`
                    : "해당 없음"}
                </p>
              </div>
            </div>
          </div>
        ) : null}

        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/dating/more-view"
            className="inline-flex min-h-[44px] items-center rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700"
          >
            이상형 더보기로 돌아가기
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

export default function PaymentSuccessPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto max-w-2xl px-4 py-8">
          <section className="rounded-3xl border border-neutral-200 bg-white p-6 shadow-sm">
            <h1 className="text-2xl font-bold text-neutral-900">결제가 완료됐어요</h1>
            <p className="mt-4 text-sm text-neutral-500">결제 승인 상태를 확인하고 있어요.</p>
          </section>
        </main>
      }
    >
      <PaymentSuccessContent />
    </Suspense>
  );
}
