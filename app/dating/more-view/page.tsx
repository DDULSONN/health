"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type MoreViewStatus = "none" | "pending" | "approved" | "rejected";
type MoreViewStatusResponse = {
  ok?: boolean;
  loggedIn?: boolean;
  male?: MoreViewStatus;
  female?: MoreViewStatus;
};

const OPEN_KAKAO_URL = "https://open.kakao.com/o/s2gvTdhi";

export default function MoreViewPage() {
  const [status, setStatus] = useState<{ loggedIn: boolean; male: MoreViewStatus; female: MoreViewStatus }>({
    loggedIn: false,
    male: "none",
    female: "none",
  });
  const [submitting, setSubmitting] = useState<null | "male" | "female">(null);
  const [creditRequesting, setCreditRequesting] = useState(false);
  const [creditOrderId, setCreditOrderId] = useState("");

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/dating/cards/more-view/status", { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as MoreViewStatusResponse;
      setStatus({
        loggedIn: body.loggedIn === true,
        male: body.male ?? "none",
        female: body.female ?? "none",
      });
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const request = useCallback(
    async (sex: "male" | "female") => {
      if (submitting) return;
      setSubmitting(sex);
      try {
        const res = await fetch("/api/dating/cards/more-view/request", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sex }),
        });
        const body = (await res.json().catch(() => ({}))) as { status?: MoreViewStatus; message?: string; requestRowId?: string };

        if (!res.ok) {
          alert(body.message ?? "신청에 실패했습니다.");
          return;
        }

        if (body.status === "approved") {
          alert("이미 승인된 상태입니다. 구매 후 3시간 이용, 랜덤 25명 고정 노출 + 지원권 1장 추가 지급입니다.");
        } else if (body.requestRowId) {
          alert(`신청 접수 완료 (${body.requestRowId}). 오픈카톡으로 닉네임 + 신청ID를 보내주세요.`);
        } else {
          alert("신청이 접수되었습니다. 오픈카톡으로 닉네임을 보내주세요.");
        }

        await loadStatus();
      } catch {
        alert("신청 처리 중 오류가 발생했습니다.");
      } finally {
        setSubmitting(null);
      }
    },
    [loadStatus, submitting]
  );

  const handleRequestApplyCredits = useCallback(async () => {
    if (!status.loggedIn || creditRequesting) return;
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
    } catch {
      alert("지원권 요청 중 네트워크 오류가 발생했습니다.");
    } finally {
      setCreditRequesting(false);
    }
  }, [creditRequesting, status.loggedIn]);

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <div className="mb-4 flex items-center gap-2">
        <Link href="/community/dating/cards" className="rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50">
          오픈카드
        </Link>
        <span className="rounded-full border border-pink-300 bg-pink-50 px-3 py-1.5 text-sm font-semibold text-pink-700">이상형 더보기(유료)</span>
      </div>

      <section className="rounded-2xl border border-pink-200 bg-pink-50 p-5">
        <h1 className="text-lg font-bold text-pink-900">이상형 더보기(유료)</h1>
        <p className="mt-2 text-sm font-semibold text-pink-900">더 많은 대기열 프로필을 먼저 확인하고, 빠르게 지원 기회를 얻을 수 있어요.</p>
        <p className="mt-2 text-sm text-pink-800">구매 후 3시간 동안만 이용 가능하며, 대기열 랜덤 25명이 1회 고정으로 노출됩니다.</p>
        <p className="mt-1 text-sm text-pink-800">승인 시 지원권 1장이 추가 지급됩니다.</p>
        <p className="mt-2 text-xs text-pink-700">가격 5,000원</p>
        <p className="mt-1 text-sm text-pink-800">신청 후 오픈카톡으로 닉네임과 신청ID를 보내주시면 승인 처리됩니다.</p>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void request("male")}
            disabled={!status.loggedIn || status.male === "approved" || submitting === "male"}
            className="min-h-[40px] rounded-lg border border-pink-300 bg-white px-3 text-xs font-medium text-pink-700 disabled:opacity-50"
          >
            남자 카드 보기 {status.male === "approved" ? "승인됨" : status.male === "pending" ? "심사중" : "신청"}
          </button>
          <button
            type="button"
            onClick={() => void request("female")}
            disabled={!status.loggedIn || status.female === "approved" || submitting === "female"}
            className="min-h-[40px] rounded-lg border border-pink-300 bg-white px-3 text-xs font-medium text-pink-700 disabled:opacity-50"
          >
            여자 카드 보기 {status.female === "approved" ? "승인됨" : status.female === "pending" ? "심사중" : "신청"}
          </button>
          <a
            href={OPEN_KAKAO_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-[40px] items-center rounded-lg border border-pink-300 bg-white px-3 text-xs font-medium text-pink-700"
          >
            오픈카톡 링크
          </a>
          {!status.loggedIn && <span className="inline-flex items-center text-xs text-neutral-500">로그인 후 신청 가능</span>}
        </div>

        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs text-amber-800">지원권 3장 5,000원 구매 요청</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handleRequestApplyCredits()}
              disabled={!status.loggedIn || creditRequesting}
              className="inline-flex min-h-[36px] items-center rounded-md bg-amber-500 px-3 text-xs font-medium text-white disabled:opacity-50"
            >
              {creditRequesting ? "요청 중..." : "지원권 구매 요청"}
            </button>
            <a
              href={OPEN_KAKAO_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-[36px] items-center rounded-md border border-amber-300 bg-white px-3 text-xs font-medium text-amber-800"
            >
              오픈카톡 이동
            </a>
          </div>
          {creditOrderId && <p className="mt-2 text-xs text-amber-900">요청 완료: {creditOrderId} (오픈카톡으로 닉네임 + 신청ID 전송)</p>}
        </div>
      </section>
    </main>
  );
}
