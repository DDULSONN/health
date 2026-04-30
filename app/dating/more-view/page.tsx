"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import DatingAdultNotice from "@/components/DatingAdultNotice";

type MoreViewStatus = "none" | "pending" | "approved" | "rejected";
type MoreViewStatusResponse = {
  ok?: boolean;
  loggedIn?: boolean;
  male?: MoreViewStatus;
  female?: MoreViewStatus;
};

type AdminStatusResponse = {
  isAdmin?: boolean;
};

const OPEN_KAKAO_URL = "https://open.kakao.com/o/s2gvTdhi";

export default function MoreViewPage() {
  const [status, setStatus] = useState<{ loggedIn: boolean; male: MoreViewStatus; female: MoreViewStatus }>({
    loggedIn: false,
    male: "none",
    female: "none",
  });
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminChecked, setAdminChecked] = useState(false);
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
      // ignore
    }
  }, []);

  const loadAdminStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/me", { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as AdminStatusResponse;
      setIsAdmin(body.isAdmin === true);
    } catch {
      setIsAdmin(false);
    } finally {
      setAdminChecked(true);
    }
  }, []);

  useEffect(() => {
    void Promise.all([loadStatus(), loadAdminStatus()]);
  }, [loadAdminStatus, loadStatus]);

  const request = useCallback(
    async (sex: "male" | "female") => {
      if (submitting || !isAdmin) return;
      setSubmitting(sex);
      try {
        const res = await fetch("/api/payments/toss/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ productType: "more_view", sex }),
        });
        const body = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          message?: string;
          checkoutUrl?: string;
        };

        if (!res.ok) {
          alert(body.message ?? "신청에 실패했습니다.");
          return;
        }

        if (!body.checkoutUrl) {
          alert(body.message ?? "결제창을 열지 못했습니다.");
          return;
        }

        window.location.href = body.checkoutUrl;
      } catch {
        alert("결제 요청 처리 중 오류가 발생했습니다.");
      } finally {
        setSubmitting(null);
      }
    },
    [isAdmin, submitting]
  );

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <div className="mb-4 flex items-center gap-2">
        <Link href="/community/dating/cards" className="rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50">
          오픈카드
        </Link>
        <Link href="/dating/apply-credits" className="rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50">
          지원권 구매
        </Link>
        <span className="rounded-full border border-pink-300 bg-pink-50 px-3 py-1.5 text-sm font-semibold text-pink-700">이상형 더보기</span>
      </div>

      <section className="rounded-2xl border border-pink-200 bg-pink-50 p-5">
        <h1 className="text-lg font-bold text-pink-900">이상형 더보기</h1>
        <p className="mt-2 text-sm font-semibold text-pink-900">더 많은 대기열 프로필을 먼저 확인하고, 빠르게 지원 기회를 얻을 수 있어요.</p>
        <p className="mt-2 text-sm text-pink-800">이용이 열리면 3시간 동안만 이용 가능하며, 대기열 랜덤 25명이 1회 고정으로 노출됩니다.</p>
        <p className="mt-1 text-sm text-pink-800">이용 완료 시 지원권 1장이 함께 지급됩니다.</p>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-pink-200 bg-white/80 p-3">
            <p className="text-sm font-semibold text-pink-900">이용 안내</p>
            <ul className="mt-2 space-y-1 text-xs leading-5 text-pink-800">
              <li>상품명: 이상형 더보기</li>
              <li>금액: 5,000원</li>
              <li>제공 내용: 3시간 이용, 랜덤 25명 1회 고정 노출</li>
              <li>추가 혜택: 이용 완료 시 지원권 1장 지급</li>
            </ul>
          </div>
          <div className="rounded-xl border border-pink-200 bg-white/80 p-3">
            <p className="text-sm font-semibold text-pink-900">환불 및 문의</p>
            <ul className="mt-2 space-y-1 text-xs leading-5 text-pink-800">
              <li>이용 시작 전에는 운영 확인 후 환불 검토가 가능합니다.</li>
              <li>결제 승인 및 열람 권한 부여 후에는 환불이 제한될 수 있습니다.</li>
              <li>문의: gymtools.kr@gmail.com / 010-8693-0657</li>
            </ul>
          </div>
        </div>

        {isAdmin ? (
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void request("male")}
              disabled={!status.loggedIn || status.male === "approved" || submitting === "male"}
              className="min-h-[40px] rounded-lg border border-pink-300 bg-white px-3 text-xs font-medium text-pink-700 disabled:opacity-50"
            >
              남자 카드 보기 {status.male === "approved" ? "이용중" : submitting === "male" ? "결제 준비중" : "결제"}
            </button>
            <button
              type="button"
              onClick={() => void request("female")}
              disabled={!status.loggedIn || status.female === "approved" || submitting === "female"}
              className="min-h-[40px] rounded-lg border border-pink-300 bg-white px-3 text-xs font-medium text-pink-700 disabled:opacity-50"
            >
              여자 카드 보기 {status.female === "approved" ? "이용중" : submitting === "female" ? "결제 준비중" : "결제"}
            </button>
            <a
              href={OPEN_KAKAO_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-[40px] items-center rounded-lg border border-pink-300 bg-white px-3 text-xs font-medium text-pink-700"
            >
              오픈카톡 링크
            </a>
            {!status.loggedIn && <span className="inline-flex items-center text-xs text-neutral-500">로그인 후 이용 가능</span>}
          </div>
        ) : (
          <div className="mt-4 rounded-xl border border-dashed border-pink-200 bg-white/80 p-4">
            <p className="text-sm font-semibold text-neutral-900">현재 운영 테스트 중입니다.</p>
            <p className="mt-1 text-xs leading-5 text-neutral-600">
              이상형 더보기 토스 결제는 아직 관리자 계정에서만 확인 중이에요. 일반 사용자용 오픈은 안정화 후 바로 이어서 진행하겠습니다.
            </p>
            {!adminChecked ? <p className="mt-2 text-xs text-neutral-500">운영 권한 확인 중...</p> : null}
          </div>
        )}

        <div className="mt-4 rounded-lg border border-neutral-200 bg-white/80 p-3">
          <p className="text-xs font-semibold text-neutral-900">지원권 구매는 별도 탭으로 분리됐어요.</p>
          <p className="mt-1 text-xs text-neutral-600">오픈카드 지원권 구매가 필요하면 아래 버튼으로 이동해 주세요.</p>
          <div className="mt-3">
            <Link
              href="/dating/apply-credits"
              className="inline-flex min-h-[36px] items-center rounded-md border border-neutral-300 bg-white px-3 text-xs font-medium text-neutral-800"
            >
              지원권 구매 탭으로 이동
            </Link>
          </div>
        </div>
      </section>

      <DatingAdultNotice />
    </main>
  );
}
