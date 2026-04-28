"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import DatingAdultNotice from "@/components/DatingAdultNotice";

type ApplyCreditsStatusResponse = {
  ok?: boolean;
  loggedIn?: boolean;
  baseRemaining?: number;
  creditsRemaining?: number;
};

const OPEN_KAKAO_URL = "https://open.kakao.com/o/s2gvTdhi";
const PACK_SIZE = 3;
const PACK_AMOUNT = 5000;

export default function ApplyCreditsPage() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [baseRemaining, setBaseRemaining] = useState(0);
  const [creditsRemaining, setCreditsRemaining] = useState(0);
  const [creditRequesting, setCreditRequesting] = useState(false);
  const [creditOrderId, setCreditOrderId] = useState("");

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/dating/apply-credits/status", { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as ApplyCreditsStatusResponse;
      setLoggedIn(body.loggedIn === true);
      setBaseRemaining(Math.max(0, Number(body.baseRemaining ?? 0)));
      setCreditsRemaining(Math.max(0, Number(body.creditsRemaining ?? 0)));
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const handleRequestApplyCredits = useCallback(async () => {
    if (!loggedIn || creditRequesting) return;
    setCreditRequesting(true);
    setCreditOrderId("");

    try {
      const res = await fetch("/api/dating/apply-credits/request", { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; orderId?: string; message?: string };
      if (!res.ok || !body.ok || !body.orderId) {
        alert(body.message ?? "지원권 요청 생성에 실패했습니다.");
        return;
      }
      setCreditOrderId(body.orderId);
      await loadStatus();
    } catch {
      alert("지원권 요청 중 네트워크 오류가 발생했습니다.");
    } finally {
      setCreditRequesting(false);
    }
  }, [creditRequesting, loadStatus, loggedIn]);

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <div className="mb-4 flex items-center gap-2">
        <Link
          href="/community/dating/cards"
          className="rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
        >
          오픈카드
        </Link>
        <span className="rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-sm font-semibold text-emerald-700">
          지원권 구매
        </span>
        <Link
          href="/dating/more-view"
          className="rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
        >
          이상형 더보기
        </Link>
      </div>

      <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
        <h1 className="text-lg font-bold text-emerald-900">오픈카드 지원권 구매</h1>
        <p className="mt-2 text-sm font-semibold text-emerald-900">지원권이 있으면 기본 하루 2장 외에 추가로 오픈카드 지원이 가능합니다.</p>
        <p className="mt-2 text-sm text-emerald-800">
          요청 후 오픈카톡으로 닉네임과 신청ID를 보내주시면 확인 뒤 승인 처리됩니다.
        </p>
        <p className="mt-1 text-xs text-emerald-700">
          1세트 {PACK_SIZE}장 / {PACK_AMOUNT.toLocaleString("ko-KR")}원
        </p>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-emerald-200 bg-white/80 p-3">
            <p className="text-sm font-semibold text-emerald-900">현재 보유 현황</p>
            <ul className="mt-2 space-y-1 text-xs leading-5 text-emerald-800">
              <li>오늘 기본 지원 가능 수: {baseRemaining}장</li>
              <li>추가 지원권: {creditsRemaining}장</li>
            </ul>
          </div>
          <div className="rounded-xl border border-emerald-200 bg-white/80 p-3">
            <p className="text-sm font-semibold text-emerald-900">구매 안내</p>
            <ul className="mt-2 space-y-1 text-xs leading-5 text-emerald-800">
              <li>상품명: 오픈카드 지원권</li>
              <li>구성: 3장</li>
              <li>금액: 5,000원</li>
              <li>승인 후 바로 잔여 지원권에 반영됩니다.</li>
            </ul>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void handleRequestApplyCredits()}
            disabled={!loggedIn || creditRequesting}
            className="inline-flex min-h-[40px] items-center rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white disabled:opacity-50"
          >
            {creditRequesting ? "요청 중..." : "지원권 구매 요청"}
          </button>
          <a
            href={OPEN_KAKAO_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-[40px] items-center rounded-lg border border-emerald-300 bg-white px-4 text-sm font-semibold text-emerald-800"
          >
            오픈카톡 이동
          </a>
          {!loggedIn ? <span className="inline-flex items-center text-xs text-neutral-500">로그인 후 요청 가능</span> : null}
        </div>

        {creditOrderId ? (
          <p className="mt-3 rounded-lg border border-emerald-200 bg-white/80 px-3 py-2 text-xs text-emerald-900">
            요청 완료: {creditOrderId} (오픈카톡으로 닉네임 + 신청ID 전송)
          </p>
        ) : null}
      </section>

      <DatingAdultNotice />
    </main>
  );
}
