"use client";

import { useEffect, useState } from "react";

type ReferralMember = {
  userId: string;
  nickname: string | null;
  email: string | null;
  phoneVerified: boolean;
  isBanned: boolean;
};

type ReferralCheckResult = {
  ok?: boolean;
  message?: string;
  rewardCredits?: number;
  inviter?: ReferralMember;
  invitee?: ReferralMember;
  eligibility?: {
    phoneVerified: boolean;
    hasOpenCard: boolean;
    hasOneOnOneCard: boolean;
    hasMatchingProfile: boolean;
    eligible: boolean;
  };
  alreadyGranted?: boolean;
  inviteeClaimedByAnotherPair?: boolean;
  granted?: boolean;
  inviterGrant?: { creditsAfter?: number };
  inviteeGrant?: { creditsAfter?: number };
};

type ReferralOverview = {
  summary: { total: number; rewarded: number; pending: number };
  recent: Array<{
    invitee_user_id: string;
    inviter_user_id: string;
    referral_code: string;
    status: "pending" | "rewarded";
    claimed_at: string;
    rewarded_at: string | null;
    inviter_nickname: string | null;
    invitee_nickname: string | null;
  }>;
};

function memberLabel(member: ReferralMember | undefined) {
  if (!member) return "-";
  return member.nickname?.trim() || member.email?.trim() || member.userId;
}

export default function AdminReferralRewardPanel() {
  const [inviter, setInviter] = useState("");
  const [invitee, setInvitee] = useState("");
  const [result, setResult] = useState<ReferralCheckResult | null>(null);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loadingAction, setLoadingAction] = useState<"check" | "grant" | "">("");
  const [overview, setOverview] = useState<ReferralOverview | null>(null);
  const [overviewError, setOverviewError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/admin/dating/referrals/reward", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as ReferralOverview & { message?: string };
        if (!response.ok) throw new Error(body.message ?? "추천 현황을 불러오지 못했습니다.");
        setOverview(body);
      })
      .catch((requestError) => {
        if (requestError instanceof DOMException && requestError.name === "AbortError") return;
        setOverviewError(requestError instanceof Error ? requestError.message : "추천 현황을 불러오지 못했습니다.");
      });
    return () => controller.abort();
  }, []);

  const run = async (action: "check" | "grant") => {
    if (!inviter.trim() || !invitee.trim() || loadingAction) return;
    if (
      action === "grant" &&
      !window.confirm(`${memberLabel(result?.inviter)} 님을 추천인으로 등록하고 양쪽에 지원권 5장씩 지급할까요?`)
    ) {
      return;
    }

    setLoadingAction(action);
    setError("");
    setInfo("");
    try {
      const response = await fetch("/api/admin/dating/referrals/reward", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, inviter: inviter.trim(), invitee: invitee.trim() }),
      });
      const body = (await response.json().catch(() => ({}))) as ReferralCheckResult;
      setResult(body);
      if (!response.ok || body.ok === false) {
        setError(body.message ?? "추천 보상 정보를 확인하지 못했습니다.");
        return;
      }
      if (action === "grant") {
        setInfo(body.message ?? "양쪽 회원에게 지원권을 지급했습니다.");
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "추천 보상 요청에 실패했습니다.");
    } finally {
      setLoadingAction("");
    }
  };

  const eligible = result?.eligibility?.eligible === true;
  const canGrant = eligible && !result?.alreadyGranted && !result?.inviteeClaimedByAnotherPair;

  return (
    <section className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50/40 p-3">
      <p className="text-xs font-bold text-emerald-950">관리자 추천 관계 확인·보상</p>
      <p className="mt-1 text-[11px] leading-5 text-emerald-800">
        추천 관계를 먼저 기록한 뒤, 초대 회원이 휴대폰 인증과 오픈카드 또는 1:1 신청서 등록을 완료했을 때만 양쪽에 지원권 5장씩 지급합니다.
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <label className="text-[11px] font-semibold text-neutral-700">
          추천인
          <input
            value={inviter}
            onChange={(event) => {
              setInviter(event.target.value);
              setResult(null);
              setError("");
              setInfo("");
            }}
            placeholder="닉네임 · 이메일 · 사용자 ID"
            className="mt-1 h-10 w-full rounded-lg border border-emerald-200 bg-white px-3 text-xs text-neutral-900 outline-none"
          />
        </label>
        <label className="text-[11px] font-semibold text-neutral-700">
          초대받은 회원
          <input
            value={invitee}
            onChange={(event) => {
              setInvitee(event.target.value);
              setResult(null);
              setError("");
              setInfo("");
            }}
            placeholder="닉네임 · 이메일 · 사용자 ID"
            className="mt-1 h-10 w-full rounded-lg border border-emerald-200 bg-white px-3 text-xs text-neutral-900 outline-none"
          />
        </label>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={Boolean(loadingAction) || !inviter.trim() || !invitee.trim()}
          onClick={() => void run("check")}
          className="h-9 rounded-lg border border-emerald-300 bg-white px-3 text-xs font-bold text-emerald-800 disabled:opacity-50"
        >
          {loadingAction === "check" ? "확인 중..." : "지급 조건 확인"}
        </button>
        <button
          type="button"
          disabled={Boolean(loadingAction) || !canGrant}
          onClick={() => void run("grant")}
          className="h-9 rounded-lg bg-emerald-700 px-3 text-xs font-bold text-white disabled:opacity-40"
        >
          {loadingAction === "grant" ? "지급 중..." : "양쪽 5장 지급"}
        </button>
      </div>

      {result?.inviter && result.invitee ? (
        <div className="mt-3 rounded-lg border border-emerald-100 bg-white p-3 text-[11px] leading-5 text-neutral-700">
          <p><span className="font-bold">추천인:</span> {memberLabel(result.inviter)}</p>
          <p><span className="font-bold">초대 회원:</span> {memberLabel(result.invitee)}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <span className={`rounded-full px-2 py-1 font-semibold ${result.eligibility?.phoneVerified ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-700"}`}>
              휴대폰 인증 {result.eligibility?.phoneVerified ? "완료" : "미완료"}
            </span>
            <span className={`rounded-full px-2 py-1 font-semibold ${result.eligibility?.hasMatchingProfile ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-700"}`}>
              매칭 프로필 {result.eligibility?.hasOpenCard ? "오픈카드" : result.eligibility?.hasOneOnOneCard ? "1:1" : "미등록"}
            </span>
            {result.alreadyGranted ? <span className="rounded-full bg-neutral-100 px-2 py-1 font-semibold text-neutral-700">지급 완료</span> : null}
            {result.inviteeClaimedByAnotherPair ? <span className="rounded-full bg-amber-100 px-2 py-1 font-semibold text-amber-800">기존 추천 보상 있음</span> : null}
          </div>
          {result.granted ? (
            <p className="mt-2 font-semibold text-emerald-800">
              지급 후 잔여: 추천인 {Number(result.inviterGrant?.creditsAfter ?? 0)}장 · 초대 회원 {Number(result.inviteeGrant?.creditsAfter ?? 0)}장
            </p>
          ) : null}
        </div>
      ) : null}
      {error ? <p className="mt-2 text-xs font-semibold text-rose-700">{error}</p> : null}
      {info ? <p className="mt-2 text-xs font-semibold text-emerald-700">{info}</p> : null}

      <div className="mt-4 border-t border-emerald-100 pt-3">
        <p className="text-xs font-bold text-emerald-950">가입 추천 현황</p>
        {overview ? (
          <>
            <div className="mt-2 grid grid-cols-3 gap-2 text-center">
              {[
                ["전체", overview.summary.total],
                ["조건 대기", overview.summary.pending],
                ["지급 완료", overview.summary.rewarded],
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-lg border border-emerald-100 bg-white px-2 py-2">
                  <p className="text-[10px] text-neutral-500">{label}</p>
                  <p className="mt-0.5 text-sm font-bold text-neutral-900">{Number(value).toLocaleString("ko-KR")}</p>
                </div>
              ))}
            </div>
            {overview.recent.length ? (
              <div className="mt-2 max-h-64 space-y-1.5 overflow-y-auto">
                {overview.recent.slice(0, 20).map((item) => (
                  <div key={item.invitee_user_id} className="rounded-lg border border-emerald-100 bg-white px-3 py-2 text-[11px] text-neutral-600">
                    <p className="font-semibold text-neutral-900">
                      {item.inviter_nickname ?? item.inviter_user_id.slice(0, 8)} → {item.invitee_nickname ?? item.invitee_user_id.slice(0, 8)}
                    </p>
                    <p className="mt-0.5">
                      {item.referral_code} · {item.status === "rewarded" ? "양쪽 5장 지급 완료" : "조건 달성 대기"} · {new Date(item.claimed_at).toLocaleString("ko-KR")}
                    </p>
                  </div>
                ))}
              </div>
            ) : <p className="mt-2 text-[11px] text-neutral-500">등록된 가입 추천 관계가 없습니다.</p>}
          </>
        ) : overviewError ? (
          <p className="mt-2 text-[11px] font-medium text-amber-700">{overviewError}</p>
        ) : (
          <div className="mt-2 h-16 animate-pulse rounded-lg bg-white" />
        )}
      </div>
    </section>
  );
}
