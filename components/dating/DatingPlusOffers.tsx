"use client";

import { useEffect, useState } from "react";
import {
  DATING_ALL_PASS_PRICE_KRW,
  ONE_ON_ONE_PLUS_7D_PRICE_KRW,
  ONE_ON_ONE_PLUS_PRICE_KRW,
} from "@/lib/dating-1on1-plus";
import { SWIPE_PREMIUM_PRICE_KRW } from "@/lib/dating-swipe";
import { trackCheckoutStarted, trackPaidOfferSelected, trackPaidOfferViewed } from "@/lib/payment-analytics";

type PaidPlan = {
  productType: "one_on_one_plus_7d" | "one_on_one_plus_30d" | "swipe_premium_30d" | "dating_all_pass_30d";
  title: string;
  description: string;
  amount: number;
  badge?: string;
};

const ONE_ON_ONE_PLANS: PaidPlan[] = [
  {
    productType: "one_on_one_plus_7d",
    title: "7일 먼저 써보기",
    description: "후보 새로고침 하루 2회 · 프로필 우선 노출",
    amount: ONE_ON_ONE_PLUS_7D_PRICE_KRW,
  },
  {
    productType: "one_on_one_plus_30d",
    title: "1:1 플러스 30일",
    description: "한 달 동안 새로고침 추가 · 프로필 우선 노출",
    amount: ONE_ON_ONE_PLUS_PRICE_KRW,
    badge: "꾸준히 이용",
  },
  {
    productType: "dating_all_pass_30d",
    title: "올패스 30일",
    description: "1:1 플러스 + 빠른매칭 플러스를 함께",
    amount: DATING_ALL_PASS_PRICE_KRW,
    badge: "두 플러스 묶음",
  },
];

const SWIPE_PLANS: PaidPlan[] = [
  {
    productType: "swipe_premium_30d",
    title: "빠른매칭 플러스 30일",
    description: "하루 30회 · 프로필 노출 강화",
    amount: SWIPE_PREMIUM_PRICE_KRW,
  },
  {
    productType: "dating_all_pass_30d",
    title: "올패스 30일",
    description: "빠른매칭과 1:1 플러스를 함께 이용",
    amount: DATING_ALL_PASS_PRICE_KRW,
    badge: "추천",
  },
];

const PAYMENT_NOTICE = "현재 국민/우리/현대 카드는 결제가 되지 않습니다. 다른 카드나 결제수단을 이용해 주세요.";

export default function DatingPlusOffers({
  mode,
  placement,
  oneOnOneCardId,
  disabled = false,
  className = "",
}: {
  mode: "one_on_one" | "swipe";
  placement: string;
  oneOnOneCardId?: string | null;
  disabled?: boolean;
  className?: string;
}) {
  const plans = mode === "one_on_one" ? ONE_ON_ONE_PLANS : SWIPE_PLANS;
  const [submitting, setSubmitting] = useState<PaidPlan["productType"] | null>(null);

  useEffect(() => {
    for (const plan of plans) {
      trackPaidOfferViewed({
        itemId: plan.productType,
        itemName: plan.title,
        amount: plan.amount,
        placement,
      });
    }
  }, [placement, plans]);

  const startCheckout = async (plan: PaidPlan) => {
    if (disabled || submitting) return;
    setSubmitting(plan.productType);
    trackPaidOfferSelected({
      itemId: plan.productType,
      itemName: plan.title,
      amount: plan.amount,
      placement,
    });

    try {
      const res = await fetch("/api/payments/toss/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productType: plan.productType,
          cardId: oneOnOneCardId ?? undefined,
          offerPlacement: placement,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        error?: string;
        checkoutUrl?: string;
      };
      if (!res.ok || body.ok === false || !body.checkoutUrl) {
        throw new Error(body.message ?? body.error ?? "결제창을 열지 못했습니다.");
      }
      trackCheckoutStarted({
        itemId: plan.productType,
        itemName: plan.title,
        amount: plan.amount,
        placement,
      });
      window.location.href = body.checkoutUrl;
    } catch (error) {
      const message = error instanceof Error ? error.message : "결제를 시작하지 못했습니다.";
      window.alert(`${message}\n\n${PAYMENT_NOTICE}`);
      setSubmitting(null);
    }
  };

  return (
    <div className={`space-y-2 ${className}`}>
      {plans.map((plan) => (
        <button
          key={plan.productType}
          type="button"
          disabled={disabled || Boolean(submitting)}
          onClick={() => void startCheckout(plan)}
          className={`flex min-h-[58px] w-full items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${
            plan.productType === "dating_all_pass_30d"
              ? "border-amber-300 bg-amber-50 hover:bg-amber-100/70"
              : "border-neutral-200 bg-white hover:bg-neutral-50"
          }`}
        >
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="text-sm font-bold text-neutral-950">{plan.title}</span>
              {plan.badge ? (
                <span className="rounded-full bg-neutral-900 px-2 py-0.5 text-[10px] font-bold text-white">{plan.badge}</span>
              ) : null}
            </span>
            <span className="mt-1 block text-[11px] leading-4 text-neutral-500">{plan.description}</span>
          </span>
          <span className="shrink-0 text-right">
            <span className="block text-sm font-black text-neutral-950">{plan.amount.toLocaleString("ko-KR")}원</span>
            <span className="mt-0.5 block text-[10px] font-semibold text-neutral-500">
              {submitting === plan.productType ? "결제 준비 중" : "선택"}
            </span>
          </span>
        </button>
      ))}
      <p className="px-1 text-[10px] leading-4 text-neutral-500">번호교환은 기존과 동일하게 건별 결제됩니다.</p>
    </div>
  );
}
