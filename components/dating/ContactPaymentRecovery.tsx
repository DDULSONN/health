"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { ContactPaymentRecovery as Recovery } from "@/lib/contact-payment-recovery";

export default function ContactPaymentRecovery({ orderId }: { orderId: string }) {
  const [result, setResult] = useState<{ orderId: string; recovery: Recovery } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [photoFailed, setPhotoFailed] = useState(false);
  const lock = useRef(false);
  const recovery = result?.orderId === orderId ? result.recovery : null;

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(""); setResult(null); setPhotoFailed(false);
    void fetch(`/api/payments/toss/contact-recovery?orderId=${encodeURIComponent(orderId)}`, {
      cache: "no-store", credentials: "same-origin", signal: controller.signal,
    }).then(async (res) => {
      const body = await res.json();
      if (controller.signal.aborted) return;
      if (!res.ok || !body.ok) throw new Error(res.status === 401 ? "로그인 후 결제 내역을 확인해 주세요." : "결제 상태를 확인하지 못했어요. 결제 내역을 먼저 확인해 주세요.");
      setResult({ orderId, recovery: body.recovery });
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "결제 내역을 먼저 확인해 주세요.");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [orderId]);

  async function retry() {
    if (lock.current || !recovery || recovery.state !== "retry") return;
    lock.current = true; setProcessing(true); setError("");
    try {
      const res = await fetch("/api/payments/toss/create", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productType: "one_on_one_contact_exchange", matchId: recovery.matchId, recoveryOrderId: orderId }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body.message || "결제 상태를 다시 확인해 주세요.");
      if (body.fulfilledWithoutPayment) {
        window.location.assign("/mypage?section=matching&match=one_on_one");
        return;
      }
      const url = new URL(body.checkoutUrl);
      if (url.protocol !== "https:" || url.username || url.password || !(url.hostname === "tosspayments.com" || url.hostname.endsWith(".tosspayments.com"))) throw new Error("결제창 주소를 확인하지 못했어요.");
      window.location.assign(url.href);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "결제 준비에 실패했어요. 결제 내역을 먼저 확인해 주세요.");
      // A lost response may have created an order: require a fresh server check.
      setResult(current => current ? { ...current, recovery: { ...current.recovery, state: "unavailable" } } : null);
      lock.current = false; setProcessing(false);
    }
  }

  return <div className="mt-4 rounded-2xl border border-neutral-200 bg-neutral-50 p-4" aria-live="polite">
    {loading ? <p className="text-sm text-neutral-600">주문과 결제 상태를 확인하고 있어요.</p> : null}
    {recovery ? <>
      <div className="flex min-w-0 items-center gap-3">
        {recovery.photoUrl && !photoFailed ? (
          // Same authenticated image proxy as the matching tab. No public original URL.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={recovery.photoUrl} alt={`${recovery.name}님의 1:1 프로필 사진`} width={64} height={80} onError={() => setPhotoFailed(true)} className="h-20 w-16 shrink-0 rounded-xl bg-neutral-200 object-cover" />
        ) : null}
        <div className="min-w-0">
          <p className="break-words text-sm font-semibold text-neutral-900">{recovery.name}님과의 연락처 교환</p>
          <p className="mt-1 break-words text-xs text-neutral-500">{[recovery.age ? `${recovery.age}세` : null, recovery.region].filter(Boolean).join(" · ")}</p>
        </div>
      </div>
      {recovery.state === "retry" ? <>
        <p className="mt-3 text-xs leading-5 text-neutral-600">결제가 완료되지 않았어요. 이용 가능한 다른 카드로 다시 시도할 수 있어요.</p>
        <button type="button" disabled={processing} onClick={() => void retry()} className="mt-3 min-h-[44px] w-full rounded-xl bg-neutral-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {processing ? "결제 상태 확인 중..." : `다른 카드로 다시 시도 · ${recovery.amount.toLocaleString("ko-KR")}원`}
        </button>
      </> : <p className="mt-3 text-sm leading-6 text-neutral-700">{recovery.state === "paid" ? "이미 결제가 확인됐어요. 추가 결제하지 말고 내 매칭과 결제 내역을 확인해 주세요." : recovery.state === "pending" ? "진행 중인 결제가 있어요. 중복 결제를 막기 위해 결제 상태를 먼저 확인해 주세요." : "바로 재결제하기 어려운 상태예요. 결제 내역을 먼저 확인해 주세요."}</p>}
      <Link href="/mypage?section=matching&match=one_on_one" className="mt-2 inline-flex min-h-[44px] items-center text-xs text-neutral-600 underline">내 1:1 매칭 확인</Link>
    </> : null}
    {error ? <p className="mt-2 text-sm leading-6 text-rose-700" role="alert">{error}</p> : null}
  </div>;
}
