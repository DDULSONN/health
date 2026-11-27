"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { oneOnOneMatchHref } from "@/lib/dating-1on1-match-navigation";

const MESSAGE = {
  retry: "완료된 결제가 확인되지 않았어요. 계속하려면 매칭 화면에서 기존 상태를 확인해 주세요.",
  paid: "이 매칭에 확인된 결제 또는 교환 내역이 있어요. 추가로 결제하지 마세요.",
  pending: "아직 진행 중인 결제가 있어요. 중복 결제를 피하려면 추가로 결제하지 마세요.",
  unavailable: "지금은 주문 상태를 확인하기 어려워요. 결제하지 말고 나중에 다시 확인해 주세요.",
  not_found: "이 주문은 바로 확인하기 어려워요. 결제하지 말고 주문번호와 함께 문의해 주세요.",
} as const;

type CheckState = keyof typeof MESSAGE;

export default function ContactPaymentOrderCheck({ orderId, matchId }: { orderId: string; matchId?: string | null }) {
  const [result, setResult] = useState<CheckState | null>(null);
  const [checking, setChecking] = useState(false);
  const requestRef = useRef<AbortController | null>(null);

  useEffect(() => () => {
    const request = requestRef.current;
    requestRef.current = null;
    request?.abort();
  }, []);

  async function checkOrder() {
    if (requestRef.current) return;
    const request = new AbortController();
    requestRef.current = request;
    const timer = window.setTimeout(() => request.abort(), 8_000);
    setChecking(true);
    setResult(null);
    try {
      const response = await fetch(`/api/payments/toss/contact-recovery?${new URLSearchParams({ orderId, view: "order-status" })}`, {
        cache: "no-store",
        credentials: "same-origin",
        signal: request.signal,
      });
      const body = await response.json().catch(() => null) as { ok?: boolean; state?: string } | null;
      const state = body?.state;
      if (requestRef.current !== request) return;
      if (response.status === 404) {
        setResult("not_found");
      } else if (response.ok && body?.ok && (state === "retry" || state === "paid" || state === "pending")) {
        setResult(state);
      } else {
        setResult("unavailable");
      }
    } catch {
      if (requestRef.current === request) setResult("unavailable");
    } finally {
      window.clearTimeout(timer);
      if (requestRef.current === request) {
        requestRef.current = null;
        setChecking(false);
      }
    }
  }

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={() => void checkOrder()}
        disabled={checking}
        className="inline-flex min-h-11 items-center rounded-lg border border-neutral-200 bg-white px-3 text-xs font-semibold text-neutral-800 disabled:opacity-50"
      >
        {checking ? "결제 상태 확인 중…" : result ? "결제 상태 다시 확인" : "기존 주문 상태 확인"}
      </button>
      <div aria-live="polite">
        {result ? <p className="max-w-md text-xs leading-5 text-neutral-700">{MESSAGE[result]}</p> : null}
        {matchId && (result === "retry" || result === "paid") ? (
          <Link href={oneOnOneMatchHref(matchId)} className="inline-flex min-h-11 items-center text-xs font-medium text-neutral-700 underline">
            이 매칭 확인
          </Link>
        ) : null}
      </div>
    </div>
  );
}
