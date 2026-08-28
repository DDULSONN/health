"use client";

import { useEffect, useState } from "react";

export type ReferralSummary = {
  code: string;
  inviteUrl: string;
  rewardCredits: number;
  invitedCount: number;
  rewardedCount: number;
  joinedWithReferral: boolean;
  ownReferralStatus: "pending" | "rewarded" | null;
};

export default function ReferralInvitePanel({ previewData }: { previewData?: ReferralSummary }) {
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<ReferralSummary | null>(previewData ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (previewData || !open || summary) return;

    const controller = new AbortController();
    void fetch("/api/referrals/me", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as ReferralSummary & { error?: string };
        if (!response.ok) throw new Error(body.error ?? "추천 정보를 불러오지 못했습니다.");
        setSummary(body);
      })
      .catch((requestError) => {
        if (requestError instanceof DOMException && requestError.name === "AbortError") return;
        setError(requestError instanceof Error ? requestError.message : "추천 정보를 불러오지 못했습니다.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [open, previewData, summary]);

  const copyInviteLink = async () => {
    if (!summary) return;
    try {
      await navigator.clipboard.writeText(summary.inviteUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("초대 링크를 복사하지 못했습니다.");
    }
  };

  const shareInviteLink = async () => {
    if (!summary) return;
    if (!navigator.share) {
      await copyInviteLink();
      return;
    }
    try {
      await navigator.share({
        title: "짐툴 추천 초대",
        text: "짐툴에서 같이 매칭 프로필을 등록해요. 조건을 완료하면 둘 다 지원권 5장을 받아요.",
        url: summary.inviteUrl,
      });
    } catch (shareError) {
      if (shareError instanceof DOMException && shareError.name === "AbortError") return;
      setError("초대 링크를 공유하지 못했습니다.");
    }
  };

  const toggleOpen = () => {
    const nextOpen = !open;
    if (nextOpen && !summary && !previewData) {
      setLoading(true);
      setError("");
    }
    setOpen(nextOpen);
  };

  return (
    <section className="mt-3 overflow-hidden rounded-lg border border-neutral-200 bg-white">
      <button
        type="button"
        aria-expanded={open}
        onClick={toggleOpen}
        className="flex min-h-[48px] w-full items-center justify-between gap-3 px-3 text-left"
      >
        <span className="min-w-0">
          <span className="block text-xs font-bold text-neutral-800">친구 초대</span>
          <span className="mt-0.5 block truncate text-[10px] text-neutral-400">조건 완료 시 친구와 각 5장</span>
        </span>
        <span className="shrink-0 text-[11px] font-semibold text-emerald-700">
          {open ? "접기" : "보기"}
        </span>
      </button>

      {open ? (
        <div className="border-t border-neutral-100 bg-neutral-50/50 px-3 py-2.5">
          <p className="text-[11px] leading-4 text-neutral-500">
            친구가 휴대폰 인증과 오픈카드 또는 1:1 신청서 등록을 완료하면 둘 다 지원권 5장을 받아요.
          </p>
          {loading ? <div className="mt-2 h-10 animate-pulse rounded-md bg-neutral-100" /> : null}
          {!loading && error ? <p className="mt-2 text-[11px] font-medium text-red-600">{error}</p> : null}
          {!loading && summary ? (
            <>
              <div className="mt-2 flex items-center justify-between gap-2 rounded-md border border-neutral-200 bg-white px-2.5 py-2">
                <div className="min-w-0">
                  <p className="text-[10px] text-neutral-400">내 추천 코드</p>
                  <p className="truncate font-mono text-sm font-black tracking-wider text-neutral-900">{summary.code}</p>
                </div>
                <p className="shrink-0 text-[10px] text-neutral-500">
                  초대 {summary.invitedCount} · 완료 {summary.rewardedCount}
                </p>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => void copyInviteLink()}
                  className="min-h-[36px] rounded-md border border-neutral-200 bg-white px-2 text-[11px] font-semibold text-neutral-700"
                >
                  {copied ? "복사 완료" : "링크 복사"}
                </button>
                <button
                  type="button"
                  onClick={() => void shareInviteLink()}
                  className="min-h-[36px] rounded-md bg-emerald-700 px-2 text-[11px] font-semibold text-white"
                >
                  공유하기
                </button>
              </div>
              {summary.joinedWithReferral ? (
                <p className="mt-1.5 text-[10px] font-medium text-emerald-700">
                  내 가입 보상: {summary.ownReferralStatus === "rewarded" ? "지급 완료" : "조건 달성 대기"}
                </p>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
