"use client";

import { useMemo, useState } from "react";

type ProductType = "apply_credits" | "paid_card";

type TestPaymentPageClientProps = {
  nickname: string;
  email: string;
};

const PRODUCTS: Array<{
  productType: ProductType;
  title: string;
  amount: number;
  description: string;
}> = [
  {
    productType: "apply_credits",
    title: "지원권 3장 구매",
    amount: 5000,
    description: "결제 완료 후 지원권 지급 결과와 승인 흐름을 바로 확인할 수 있습니다.",
  },
  {
    productType: "paid_card",
    title: "유료카드 등록 결제",
    amount: 10000,
    description: "유료카드 등록 결제 승인 흐름과 결과 화면을 확인할 수 있습니다.",
  },
];

function formatAmount(amount: number) {
  return `${amount.toLocaleString("ko-KR")}원`;
}

export default function TestPaymentPageClient({ nickname, email }: TestPaymentPageClientProps) {
  const [loadingProduct, setLoadingProduct] = useState<ProductType | null>(null);
  const [error, setError] = useState("");
  const [lastOrderId, setLastOrderId] = useState("");
  const profileSummary = useMemo(() => `${nickname} / ${email}`, [email, nickname]);

  const startPayment = async (productType: ProductType) => {
    if (loadingProduct) return;
    setLoadingProduct(productType);
    setError("");

    try {
      const res = await fetch("/api/payments/toss/test/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productType }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        checkoutUrl?: string;
        orderId?: string;
        message?: string;
      };

      if (!res.ok || !body.ok || !body.checkoutUrl || !body.orderId) {
        setError(body.message ?? "결제 페이지를 준비하지 못했습니다.");
        return;
      }

      setLastOrderId(body.orderId);
      window.location.href = body.checkoutUrl;
    } catch {
      setError("결제 요청 중 네트워크 오류가 발생했습니다.");
    } finally {
      setLoadingProduct(null);
    }
  };

  return (
    <>
      <div className="mt-6 rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
        <p className="text-sm font-semibold text-neutral-900">현재 결제 계정</p>
        <p className="mt-1 text-sm text-neutral-700">{profileSummary}</p>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {PRODUCTS.map((product) => (
          <section key={product.productType} className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-neutral-900">{product.title}</h2>
                <p className="mt-1 text-xs font-medium text-emerald-700">{formatAmount(product.amount)}</p>
              </div>
              <span className="rounded-full bg-white px-2 py-1 text-[11px] font-semibold text-neutral-600">결제</span>
            </div>
            <p className="mt-3 text-sm leading-6 text-neutral-700">{product.description}</p>
            <button
              type="button"
              onClick={() => void startPayment(product.productType)}
              disabled={loadingProduct !== null}
              className="mt-4 inline-flex min-h-[44px] w-full items-center justify-center rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {loadingProduct === product.productType ? "결제창 준비 중..." : "결제하기"}
            </button>
          </section>
        ))}
      </div>

      {(error || lastOrderId) && (
        <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm">
          {error ? <p className="font-medium text-red-700">{error}</p> : null}
          {lastOrderId ? <p className="mt-1 text-amber-900">최근 주문번호: {lastOrderId}</p> : null}
        </div>
      )}
    </>
  );
}
