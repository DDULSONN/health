"use client";

import { useEffect, useState } from "react";
import { fetchClientJson } from "@/lib/client-json-request";
import { trackInviteAction, type InvitePlacement } from "@/lib/growth-analytics";

export type ReferralSummary = {
  code: string;
  inviteUrl: string;
  rewardCredits: number;
  invitedCount: number;
  rewardedCount: number;
  joinedWithReferral: boolean;
  ownReferralStatus: "pending" | "rewarded" | null;
};

export default function ReferralInvitePanel({ previewData, compact = false, placement = "mypage", onDismiss }: {
  previewData?: ReferralSummary; compact?: boolean; placement?: InvitePlacement; onDismiss?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<ReferralSummary | null>(previewData ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (previewData || !open || summary) return;

    const controller = new AbortController();
    void fetchClientJson<ReferralSummary & { error?: string }>("/api/referrals/me", { cache: "no-store", signal: controller.signal })
      .then(({ response, body }) => {
        if (controller.signal.aborted) return;
        if (!response.ok || !body || typeof body.code !== "string" || typeof body.inviteUrl !== "string" || body.rewardCredits !== 5) throw new Error(body?.error ?? "추천 정보를 불러오지 못했습니다.");
        const invite = new URL(body.inviteUrl);
        if (![window.location.origin, "https://helchang.com", "https://www.helchang.com"].includes(invite.origin) || invite.pathname !== "/signup" || invite.searchParams.get("ref") !== body.code) throw new Error("추천 링크를 확인하지 못했습니다.");
        invite.searchParams.set("utm_source", "referral");
        invite.searchParams.set("utm_medium", "share");
        invite.searchParams.set("utm_campaign", "friend_invite");
        body.inviteUrl = invite.toString();
        setSummary(body);
      })
      .catch((requestError) => {
        if (controller.signal.aborted) return;
        setError(requestError instanceof DOMException && requestError.name === "AbortError" ? "추천 정보 확인이 늦어지고 있어요. 다시 시도해 주세요." : requestError instanceof Error ? requestError.message : "추천 정보를 불러오지 못했습니다.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [open, previewData, summary, retry]);

  const copyInviteLink = async () => {
    if (!summary) return;
    try {
      await navigator.clipboard.writeText(summary.inviteUrl);
      setError("");
      setCopied(true);
      trackInviteAction(placement, "copy");
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
      setError("");
      trackInviteAction(placement, "share");
    } catch (shareError) {
      if (shareError instanceof DOMException && shareError.name === "AbortError") return;
      setError("초대 링크를 공유하지 못했습니다.");
    }
  };

  const toggleOpen = () => {
    const nextOpen = !open;
    if (nextOpen) trackInviteAction(placement, "open");
    if (nextOpen && !summary && !previewData) {
      setLoading(true);
      setError("");
    }
    setOpen(nextOpen);
  };

  return (
    <section className={`${compact ? "" : "mt-3 "}overflow-hidden rounded-lg border border-neutral-200 bg-white`}>
      <div className="flex items-center">
      <button
        type="button"
        aria-expanded={open}
        onClick={toggleOpen}
        className="flex min-h-[48px] min-w-0 flex-1 items-center justify-between gap-2 px-3 text-left"
      >
        <span className="min-w-0">
          <span className="block text-xs font-semibold text-neutral-800">{compact ? "친구 초대하고 지원권 5장씩" : "친구 초대"}</span>
          {!compact && <span className="mt-0.5 block text-[11px] text-neutral-500">조건 완료 시 친구와 각 5장</span>}
        </span>
        <span className="shrink-0 text-xs font-medium text-neutral-500">
          {open ? "접기" : "보기"}
        </span>
      </button>
      {onDismiss && <button type="button" aria-label="친구 초대 안내 닫기" className="min-h-11 min-w-11 shrink-0 text-neutral-400" onClick={onDismiss}>×</button>}
      </div>

      {open ? (
        <div className="border-t border-neutral-100 bg-neutral-50/50 px-3 py-2.5">
          <p className="text-[11px] leading-4 text-neutral-500">
            초대 링크로 가입한 친구가 휴대폰 인증과 오픈카드 또는 1:1 신청서 등록을 완료하면 둘 다 지원권 5장을 받아요. 링크 공유만으로 바로 지급되지는 않아요.
          </p>
          {loading ? <div className="mt-2 h-10 animate-pulse rounded-md bg-neutral-100" /> : null}
          {!loading && error ? <div><p role="status" className="mt-2 text-xs font-medium text-red-600">{error}</p>{!summary && <button type="button" className="min-h-11 text-xs underline" onClick={() => { setError(""); setLoading(true); setRetry(value => value + 1); }}>다시 시도</button>}</div> : null}
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
                  className="min-h-11 rounded-md border border-neutral-200 bg-white px-2 text-xs font-semibold text-neutral-700"
                >
                  {copied ? "복사 완료" : "링크 복사"}
                </button>
                <button
                  type="button"
                  onClick={() => void shareInviteLink()}
                  className="min-h-11 rounded-md bg-neutral-950 px-2 text-xs font-semibold text-white"
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
