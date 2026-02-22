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
      // ignore status fetch failure
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
        const body = (await res.json().catch(() => ({}))) as {
          status?: MoreViewStatus;
          message?: string;
          requestRowId?: string;
        };
        if (!res.ok) {
          alert(body.message ?? "신청에 실패했습니다.");
          return;
        }
        if (body.status === "approved") {
          alert("이미 승인된 상태입니다. 구매 후 3시간 이용, 랜덤 10명 고정 노출입니다.");
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
        <p className="mt-2 text-sm text-pink-800">구매 후 3시간 동안만 이용 가능하며, 대기열 랜덤 10명이 1회 고정으로 노출됩니다.</p>
        <p className="mt-1 text-sm text-pink-800">신청 후 오픈카톡으로 닉네임/신청ID를 보내주시면 승인 처리됩니다.</p>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void request("male")}
            disabled={!status.loggedIn || status.male === "approved" || submitting === "male"}
            className="min-h-[40px] rounded-lg border border-pink-300 bg-white px-3 text-xs font-medium text-pink-700 disabled:opacity-50"
          >
            남자 더보기 {status.male === "approved" ? "승인됨" : status.male === "pending" ? "심사중" : "신청"}
          </button>
          <button
            type="button"
            onClick={() => void request("female")}
            disabled={!status.loggedIn || status.female === "approved" || submitting === "female"}
            className="min-h-[40px] rounded-lg border border-pink-300 bg-white px-3 text-xs font-medium text-pink-700 disabled:opacity-50"
          >
            여자 더보기 {status.female === "approved" ? "승인됨" : status.female === "pending" ? "심사중" : "신청"}
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
      </section>
    </main>
  );
}

