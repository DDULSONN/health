"use client";

import Link from "next/link";
import Image from "next/image";
import { useDeferredValue, useEffect, useState } from "react";
import { toBodyBattleImageUrl } from "@/lib/bodybattle-image";
import { createClient } from "@/lib/supabase/client";

type MatchEntry = {
  id: string;
  nickname: string;
  gender: "male" | "female";
  image_url: string | null;
  rating: number;
  current_streak?: number;
  best_streak?: number;
};

type CurrentPayload = {
  ok: boolean;
  season: {
    id: string;
    week_id: string;
    theme_slug: string;
    theme_label: string;
  } | null;
  matchup: {
    matchup_key: string;
    prompt: string;
    left: MatchEntry;
    right: MatchEntry;
  } | null;
  message?: string;
};

type ApplicantComment = {
  id: string;
  user_id: string;
  nickname: string;
  content: string | null;
  deleted_at: string | null;
  created_at: string;
  is_mine: boolean;
};

type ApplicantItem = {
  id: string;
  user_id: string;
  user_nickname: string;
  gender: "male" | "female";
  intro_text: string | null;
  champion_comment: string | null;
  image_url: string | null;
  moderation_status: "pending" | "approved" | "rejected";
  created_at: string;
  comments: ApplicantComment[];
};

type ApplicantsPayload = {
  ok: boolean;
  season: {
    id: string;
    week_id: string;
    theme_label: string;
  } | null;
  items: ApplicantItem[];
  page?: number;
  limit?: number;
  has_more?: boolean;
};

type BattleProgress = {
  level: number;
  xp: number;
  total_votes: number;
  daily_votes: number;
  vote_streak_days: number;
  xp_next_level: number;
};

type BattleAchievement = {
  key: string;
  label: string;
  earned: boolean;
};

type RewardItem = {
  code: string;
  label: string;
  amount: number;
  met: boolean;
  claimed: boolean;
  claimable: boolean;
};

type VoteFeedback = {
  matchup_stats: {
    total: number;
    left_pct: number;
    right_pct: number;
    draw_pct: number;
  };
  reward: {
    xp_gained: number;
  };
};

type ScoreboardItem = {
  rank: number;
  nickname: string;
  level: number;
  xp: number;
  total_votes: number;
  vote_streak_days: number;
  weekly_votes: number;
  weekly_xp: number;
  streak_badge: string | null;
  is_me: boolean;
  last_voted_at: string | null;
};

type JoinForm = {
  gender: "male" | "female";
  image_urls: string[];
  consent_policy: boolean;
  consent_instagram_reels: boolean;
};

type SeasonSummary = {
  latest: {
    season_id: string;
    finalized_at: string;
    week_id: string | null;
    theme_label: string | null;
    champion: { nickname?: string; rating?: number } | null;
  } | null;
  me: {
    rank?: number;
    nickname?: string;
    rating?: number;
  } | null;
};

const INITIAL_JOIN_FORM: JoinForm = {
  gender: "male",
  image_urls: [],
  consent_policy: false,
  consent_instagram_reels: false,
};

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString("ko-KR");
}

export default function BodyBattlePage() {
  const [tab, setTab] = useState<"vote" | "apply">("vote");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [payload, setPayload] = useState<CurrentPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  const [applicantsLoading, setApplicantsLoading] = useState(true);
  const [applicantsData, setApplicantsData] = useState<ApplicantsPayload | null>(null);
  const [applicantsPage, setApplicantsPage] = useState(1);
  const [applicantsHasMore, setApplicantsHasMore] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [joinSubmitting, setJoinSubmitting] = useState(false);
  const [joinUploading, setJoinUploading] = useState(false);
  const [joinForm, setJoinForm] = useState<JoinForm>(INITIAL_JOIN_FORM);
  const [commentInputByEntry, setCommentInputByEntry] = useState<Record<string, string>>({});
  const [commentSubmittingByEntry, setCommentSubmittingByEntry] = useState<Record<string, boolean>>({});

  const [progress, setProgress] = useState<BattleProgress | null>(null);
  const [achievements, setAchievements] = useState<BattleAchievement[]>([]);
  const [rewards, setRewards] = useState<RewardItem[]>([]);
  const [creditsRemaining, setCreditsRemaining] = useState(0);
  const [claimingCode, setClaimingCode] = useState<string | null>(null);
  const [voteFeedback, setVoteFeedback] = useState<VoteFeedback | null>(null);
  const [scoreboard, setScoreboard] = useState<ScoreboardItem[]>([]);
  const [scoreboardLoading, setScoreboardLoading] = useState(false);
  const [scoreMode, setScoreMode] = useState<"all" | "weekly">("all");
  const [seasonSummary, setSeasonSummary] = useState<SeasonSummary | null>(null);

  async function loadCurrent() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/bodybattle/current", { cache: "no-store" });
      const data = (await res.json()) as CurrentPayload;
      if (!res.ok || !data.ok) {
        setError("현재 대결 정보를 불러오지 못했습니다.");
        setPayload(null);
      } else {
        setPayload(data);
      }
    } catch {
      setError("대결 정보를 불러오는 중 네트워크 오류가 발생했습니다.");
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }

  async function loadApplicants(page = 1, append = false) {
    setApplicantsLoading(true);
    setApplyError(null);
    try {
      const res = await fetch(`/api/bodybattle/applicants?page=${page}&limit=20`, { cache: "no-store" });
      const data = (await res.json()) as ApplicantsPayload;
      if (!res.ok || !data.ok) {
        setApplyError("신청자 목록을 불러오지 못했습니다.");
        if (!append) setApplicantsData(null);
      } else {
        setApplicantsData((prev) => {
          if (!append || !prev) return data;
          const merged = [...(prev.items ?? []), ...(data.items ?? [])];
          return { ...data, items: merged };
        });
        setApplicantsPage(page);
        setApplicantsHasMore(Boolean(data.has_more));
      }
    } catch {
      setApplyError("신청자 목록을 불러오는 중 네트워크 오류가 발생했습니다.");
      if (!append) setApplicantsData(null);
    } finally {
      setApplicantsLoading(false);
    }
  }

  async function loadMyProgress() {
    try {
      const res = await fetch("/api/bodybattle/me", { cache: "no-store" });
      const data = (await res.json()) as {
        ok?: boolean;
        profile?: BattleProgress;
        achievements?: BattleAchievement[];
        rewards?: RewardItem[];
        credits_remaining?: number;
      };
      if (!res.ok || !data.ok) return;
      setProgress(data.profile ?? null);
      setAchievements(data.achievements ?? []);
      setRewards(data.rewards ?? []);
      setCreditsRemaining(Math.max(0, Number(data.credits_remaining ?? 0)));
    } catch {
      // no-op
    }
  }

  async function loadScoreboard() {
    setScoreboardLoading(true);
    try {
      const res = await fetch(`/api/bodybattle/scoreboard?top=20&mode=${scoreMode}`, { cache: "no-store" });
      const data = (await res.json()) as { ok?: boolean; items?: ScoreboardItem[] };
      if (!res.ok || !data.ok) return;
      setScoreboard(data.items ?? []);
    } catch {
      // no-op
    } finally {
      setScoreboardLoading(false);
    }
  }

  async function loadSeasonSummary() {
    try {
      const res = await fetch("/api/bodybattle/season-summary", { cache: "no-store" });
      const data = (await res.json()) as ({ ok?: boolean } & SeasonSummary);
      if (!res.ok || !data.ok) return;
      setSeasonSummary({ latest: data.latest ?? null, me: data.me ?? null });
    } catch {
      // no-op
    }
  }

  async function vote(winnerSide: "left" | "right" | "draw") {
    if (!payload?.season || !payload.matchup || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/bodybattle/vote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          season_id: payload.season.id,
          left_entry_id: payload.matchup.left.id,
          right_entry_id: payload.matchup.right.id,
          winner_side: winnerSide,
          matchup_key: payload.matchup.matchup_key,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        message?: string;
        progress?: BattleProgress;
        matchup_stats?: VoteFeedback["matchup_stats"];
        reward?: VoteFeedback["reward"];
      };
      if (!res.ok || !data.ok) {
        setError(data.message ?? "투표 처리에 실패했습니다.");
        return;
      }
      if (data.progress) setProgress(data.progress);
      if (data.matchup_stats && data.reward) {
        setVoteFeedback({
          matchup_stats: data.matchup_stats,
          reward: data.reward,
        });
      }
      await loadCurrent();
      if (tab === "apply") await loadApplicants(1, false);
      await Promise.all([loadMyProgress(), loadScoreboard()]);
    } catch {
      setError("투표 중 네트워크 오류가 발생했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  async function claimReward(code: string) {
    if (!isLoggedIn || claimingCode) return;
    setClaimingCode(code);
    setError(null);
    try {
      const res = await fetch("/api/bodybattle/rewards/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reward_code: code }),
      });
      const data = (await res.json()) as { ok?: boolean; message?: string };
      if (!res.ok || !data.ok) {
        setError(data.message ?? "보상 수령에 실패했습니다.");
        return;
      }
      await loadMyProgress();
    } catch {
      setError("보상 수령 중 네트워크 오류가 발생했습니다.");
    } finally {
      setClaimingCode(null);
    }
  }

  async function submitJoin() {
    const seasonId = applicantsData?.season?.id ?? payload?.season?.id ?? null;
    if (!seasonId) {
      setApplyError("현재 신청 가능한 시즌이 없습니다.");
      return;
    }
    const imageUrls = joinForm.image_urls;

    if (!joinForm.consent_policy || !joinForm.consent_instagram_reels) {
      setApplyError("필수 동의 항목을 모두 체크해 주세요.");
      return;
    }
    if (imageUrls.length < 1) {
      setApplyError("이미지를 최소 1장 업로드해 주세요.");
      return;
    }

    setJoinSubmitting(true);
    setApplyError(null);
    try {
      const res = await fetch("/api/bodybattle/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          season_id: seasonId,
          gender: joinForm.gender,
          image_urls: imageUrls,
          consent_policy: joinForm.consent_policy,
          consent_instagram_reels: joinForm.consent_instagram_reels,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; message?: string };
      if (!res.ok || !data.ok) {
        setApplyError(data.message ?? "신청 처리에 실패했습니다.");
        return;
      }
      setJoinForm(INITIAL_JOIN_FORM);
      await loadApplicants(1, false);
    } catch {
      setApplyError("신청 중 네트워크 오류가 발생했습니다.");
    } finally {
      setJoinSubmitting(false);
    }
  }

  async function handleJoinImageUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    const remains = Math.max(0, 2 - joinForm.image_urls.length);
    if (remains <= 0) {
      setApplyError("이미지는 최대 2장까지 업로드할 수 있습니다.");
      return;
    }

    const picked = Array.from(files).slice(0, remains);
    setJoinUploading(true);
    setApplyError(null);
    const uploaded: string[] = [];
    try {
      for (const file of picked) {
        if (!file.type.startsWith("image/")) {
          setApplyError("이미지 파일만 업로드할 수 있습니다.");
          continue;
        }
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/upload", {
          method: "POST",
          body: fd,
        });
        const data = (await res.json().catch(() => null)) as { url?: string; error?: string } | null;
        if (!res.ok || !data?.url) {
          setApplyError(data?.error ?? "이미지 업로드에 실패했습니다.");
          continue;
        }
        uploaded.push(data.url);
      }
      if (uploaded.length > 0) {
        setJoinForm((prev) => ({
          ...prev,
          image_urls: [...prev.image_urls, ...uploaded].slice(0, 2),
        }));
      }
    } finally {
      setJoinUploading(false);
    }
  }

  async function submitComment(entryId: string) {
    const content = (commentInputByEntry[entryId] ?? "").trim();
    if (!content) return;
    setCommentSubmittingByEntry((prev) => ({ ...prev, [entryId]: true }));
    setApplyError(null);
    try {
      const res = await fetch("/api/bodybattle/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entry_id: entryId, content }),
      });
      const data = (await res.json()) as { ok?: boolean; message?: string };
      if (!res.ok || !data.ok) {
        setApplyError(data.message ?? "댓글 등록에 실패했습니다.");
        return;
      }
      setCommentInputByEntry((prev) => ({ ...prev, [entryId]: "" }));
      await loadApplicants(1, false);
    } catch {
      setApplyError("댓글 등록 중 네트워크 오류가 발생했습니다.");
    } finally {
      setCommentSubmittingByEntry((prev) => ({ ...prev, [entryId]: false }));
    }
  }

  async function deleteComment(commentId: string) {
    if (!confirm("댓글을 삭제할까요?")) return;
    try {
      const res = await fetch(`/api/bodybattle/comments/${commentId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { message?: string } | null;
        setApplyError(data?.message ?? "댓글 삭제에 실패했습니다.");
        return;
      }
      await loadApplicants(1, false);
    } catch {
      setApplyError("댓글 삭제 중 네트워크 오류가 발생했습니다.");
    }
  }

  async function reportEntry(entryId: string, seasonId: string, source: "matchup" | "applicant") {
    const reason = window.prompt("신고 사유를 입력해 주세요. (도용, 부적절한 사진 등)");
    if (!reason || !reason.trim()) return;

    try {
      const res = await fetch("/api/bodybattle/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          season_id: seasonId,
          entry_id: entryId,
          reason: reason.trim(),
        }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; message?: string } | null;
      if (!res.ok || !data?.ok) {
        const message = data?.message ?? "신고 처리에 실패했습니다.";
        if (source === "applicant") setApplyError(message);
        else setError(message);
        return;
      }

      if (source === "applicant") {
        await loadApplicants(1, false);
      } else {
        await loadCurrent();
      }
    } catch {
      if (source === "applicant") setApplyError("신고 중 네트워크 오류가 발생했습니다.");
      else setError("신고 중 네트워크 오류가 발생했습니다.");
    }
  }

  useEffect(() => {
    createClient()
      .auth.getUser()
      .then(({ data: { user } }) => {
        setUserId(user?.id ?? null);
        setIsLoggedIn(Boolean(user));
      });
    void loadCurrent();
    void Promise.all([loadMyProgress(), loadScoreboard(), loadSeasonSummary()]);
  }, []);

  useEffect(() => {
    void loadScoreboard();
  }, [scoreMode]);

  useEffect(() => {
    if (tab !== "apply") return;
    if (applicantsData) return;
    void loadApplicants(1, false);
  }, [tab, applicantsData]);

  const leftImage = toBodyBattleImageUrl(payload?.matchup?.left.image_url, { width: 1080, quality: 78 });
  const rightImage = toBodyBattleImageUrl(payload?.matchup?.right.image_url, { width: 1080, quality: 78 });
  const deferredApplicants = useDeferredValue(applicantsData?.items ?? []);
  const myScoreboardRow = scoreboard.find((row) => row.is_me) ?? null;

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">바디배틀</h1>
          <p className="mt-1 text-sm text-neutral-500">주간 운동 완성도 챔피언전</p>
        </div>
        <div className="flex gap-2">
          <Link href="/bodybattle/ranking" className="rounded-lg border border-neutral-300 px-3 py-2 text-xs font-medium text-neutral-700">
            주간 랭킹
          </Link>
          <Link href="/bodybattle/hall-of-fame" className="rounded-lg border border-neutral-300 px-3 py-2 text-xs font-medium text-neutral-700">
            명예의 전당
          </Link>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 overflow-hidden rounded-xl border border-neutral-200 bg-white">
        <button
          type="button"
          className={`min-h-[44px] text-sm font-semibold ${tab === "vote" ? "bg-blue-600 text-white" : "text-neutral-700"}`}
          onClick={() => setTab("vote")}
        >
          투표
        </button>
        <button
          type="button"
          className={`min-h-[44px] text-sm font-semibold ${tab === "apply" ? "bg-blue-600 text-white" : "text-neutral-700"}`}
          onClick={() => setTab("apply")}
        >
          신청
        </button>
      </div>

      {tab === "vote" ? (
        <>
          {progress ? (
            <section className="mb-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-sm font-semibold text-emerald-900">
                레벨 {progress.level} · XP {progress.xp} · 다음 {progress.xp_next_level}
              </p>
              <p className="mt-1 text-xs text-emerald-800">
                누적 투표 {progress.total_votes} · 오늘 {progress.daily_votes} · 연속 {progress.vote_streak_days}일 · 지원권 {creditsRemaining}
              </p>
              <div className="mt-2 flex flex-wrap gap-1">
                {achievements.map((item) => (
                  <span
                    key={item.key}
                    className={`rounded-full px-2 py-0.5 text-[11px] ${item.earned ? "bg-emerald-200 text-emerald-900" : "bg-white text-emerald-700"}`}
                  >
                    {item.label}
                  </span>
                ))}
              </div>
              {rewards.length > 0 ? (
                <div className="mt-3 space-y-1">
                  {rewards.map((reward) => (
                    <div key={reward.code} className="flex items-center justify-between rounded-lg bg-white px-2 py-1">
                      <p className="text-xs text-neutral-700">
                        {reward.label} · +{reward.amount} 지원권
                      </p>
                      {reward.claimed ? (
                        <span className="text-xs text-emerald-700">수령 완료</span>
                      ) : reward.claimable ? (
                        <button
                          type="button"
                          onClick={() => claimReward(reward.code)}
                          disabled={claimingCode === reward.code}
                          className="rounded bg-emerald-600 px-2 py-1 text-xs font-semibold text-white disabled:opacity-50"
                        >
                          {claimingCode === reward.code ? "..." : "수령"}
                        </button>
                      ) : (
                        <span className="text-xs text-neutral-400">{reward.met ? "수령 가능" : "잠김"}</span>
                      )}
                    </div>
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}

          {loading ? <p className="text-sm text-neutral-500">대결 카드 불러오는 중...</p> : null}
          {error ? <p className="mb-3 text-sm text-red-600">{error}</p> : null}

          {voteFeedback ? (
            <section className="mb-3 rounded-2xl border border-blue-200 bg-blue-50 p-4">
              <p className="text-sm font-semibold text-blue-900">+{voteFeedback.reward.xp_gained} XP</p>
              <p className="mt-1 text-xs text-blue-800">
                왼쪽 {voteFeedback.matchup_stats.left_pct}% · 비슷함 {voteFeedback.matchup_stats.draw_pct}% · 오른쪽 {voteFeedback.matchup_stats.right_pct}% · 총 {voteFeedback.matchup_stats.total}표
              </p>
            </section>
          ) : null}

          <section className="mb-3 rounded-2xl border border-neutral-200 bg-white p-4">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-semibold text-neutral-900">투표 점수판</p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setScoreMode("all")}
                  className={`rounded px-2 py-1 text-[11px] ${scoreMode === "all" ? "bg-neutral-800 text-white" : "bg-neutral-100 text-neutral-600"}`}
                >
                  전체
                </button>
                <button
                  type="button"
                  onClick={() => setScoreMode("weekly")}
                  className={`rounded px-2 py-1 text-[11px] ${scoreMode === "weekly" ? "bg-neutral-800 text-white" : "bg-neutral-100 text-neutral-600"}`}
                >
                  주간
                </button>
              </div>
            </div>
            {scoreboardLoading ? <p className="text-xs text-neutral-500">점수판 불러오는 중...</p> : null}
            {!scoreboardLoading && scoreboard.length === 0 ? <p className="text-xs text-neutral-500">아직 점수 데이터가 없습니다.</p> : null}
            {myScoreboardRow ? (
              <p className="mb-2 text-xs font-semibold text-blue-700">
                내 순위: #{myScoreboardRow.rank} · {myScoreboardRow.nickname}
              </p>
            ) : null}
            <div className="space-y-1">
              {scoreboard.map((row) => (
                <div
                  key={`${row.rank}-${row.nickname}`}
                  className={`flex items-center justify-between rounded-lg px-2 py-1 ${row.is_me ? "bg-blue-50" : "bg-neutral-50"}`}
                >
                  <p className="truncate text-xs text-neutral-700">
                    #{row.rank} {row.nickname}
                  </p>
                  <p className="text-xs text-neutral-600">
                    {scoreMode === "weekly" ? `주간 XP ${row.weekly_xp} · 주간 투표 ${row.weekly_votes}` : `Lv.${row.level} · XP ${row.xp} · 투표 ${row.total_votes}`}
                    {row.streak_badge ? ` · ${row.streak_badge}` : ""}
                  </p>
                </div>
              ))}
            </div>
          </section>

          {seasonSummary?.latest ? (
            <section className="mb-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <p className="text-xs font-semibold text-amber-800">
                최근 종료 시즌: {seasonSummary.latest.week_id ?? "-"} · {seasonSummary.latest.theme_label ?? "-"}
              </p>
              <p className="mt-1 text-sm text-amber-900">
                챔피언: {seasonSummary.latest.champion?.nickname ?? "미정"} {seasonSummary.latest.champion?.rating ? `(레이팅 ${seasonSummary.latest.champion.rating})` : ""}
              </p>
              {seasonSummary.me ? (
                <p className="mt-1 text-xs text-amber-900">해당 시즌 내 순위: #{seasonSummary.me.rank ?? "-"}</p>
              ) : null}
            </section>
          ) : null}

          {!loading && !payload?.season ? (
            <section className="rounded-2xl border border-neutral-200 bg-white p-5">
              <p className="text-sm text-neutral-700">현재 진행 중인 시즌이 없습니다.</p>
            </section>
          ) : null}

          {!loading && payload?.season && !payload.matchup ? (
            <section className="rounded-2xl border border-neutral-200 bg-white p-5">
              <p className="text-sm font-semibold text-neutral-800">{payload.season.week_id}</p>
              <p className="mt-1 text-sm text-neutral-600">{payload.message ?? "대결 매칭을 만들 참가자가 아직 부족합니다."}</p>
            </section>
          ) : null}

          {!loading && payload?.season && payload.matchup ? (
            <section className="rounded-2xl border border-neutral-200 bg-white p-4">
              <p className="text-xs font-semibold text-blue-700">
                {payload.season.week_id} · {payload.season.theme_label}
              </p>
              <p className="mt-1 text-sm font-semibold text-neutral-900">{payload.matchup.prompt}</p>

              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <article className="rounded-xl border border-neutral-200 p-3">
                  {leftImage ? (
                    <Image src={leftImage} alt="" width={1080} height={1350} unoptimized className="h-[22rem] w-full rounded-lg bg-neutral-100 object-contain" />
                  ) : (
                    <div className="h-64 w-full rounded-lg bg-neutral-100" />
                  )}
                  <p className="mt-2 text-sm font-semibold text-neutral-900">{payload.matchup.left.nickname}</p>
                  <p className="text-xs text-neutral-500">
                    레이팅 {Number(payload.matchup.left.rating ?? 1000).toFixed(0)} · 연승 {Number(payload.matchup.left.current_streak ?? 0)}
                  </p>
                  {isLoggedIn && payload.season ? (
                    <button
                      type="button"
                      onClick={() => reportEntry(payload.matchup!.left.id, payload.season!.id, "matchup")}
                      className="mt-2 text-xs text-red-500"
                    >
                      신고
                    </button>
                  ) : null}
                </article>
                <article className="rounded-xl border border-neutral-200 p-3">
                  {rightImage ? (
                    <Image src={rightImage} alt="" width={1080} height={1350} unoptimized className="h-[22rem] w-full rounded-lg bg-neutral-100 object-contain" />
                  ) : (
                    <div className="h-64 w-full rounded-lg bg-neutral-100" />
                  )}
                  <p className="mt-2 text-sm font-semibold text-neutral-900">{payload.matchup.right.nickname}</p>
                  <p className="text-xs text-neutral-500">
                    레이팅 {Number(payload.matchup.right.rating ?? 1000).toFixed(0)} · 연승 {Number(payload.matchup.right.current_streak ?? 0)}
                  </p>
                  {isLoggedIn && payload.season ? (
                    <button
                      type="button"
                      onClick={() => reportEntry(payload.matchup!.right.id, payload.season!.id, "matchup")}
                      className="mt-2 text-xs text-red-500"
                    >
                      신고
                    </button>
                  ) : null}
                </article>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
                <button
                  type="button"
                  onClick={() => vote("left")}
                  disabled={submitting}
                  className="min-h-[44px] rounded-lg bg-blue-600 px-3 text-sm font-semibold text-white disabled:opacity-50"
                >
                  왼쪽 선택
                </button>
                <button
                  type="button"
                  onClick={() => vote("draw")}
                  disabled={submitting}
                  className="min-h-[44px] rounded-lg bg-neutral-700 px-3 text-sm font-semibold text-white disabled:opacity-50"
                >
                  비슷함
                </button>
                <button
                  type="button"
                  onClick={() => vote("right")}
                  disabled={submitting}
                  className="min-h-[44px] rounded-lg bg-blue-600 px-3 text-sm font-semibold text-white disabled:opacity-50"
                >
                  오른쪽 선택
                </button>
              </div>
            </section>
          ) : null}
        </>
      ) : (
        <section className="space-y-4">
          <article className="rounded-2xl border border-neutral-200 bg-white p-4">
            <p className="text-sm font-semibold text-neutral-900">
              {applicantsData?.season ? `${applicantsData.season.week_id} · ${applicantsData.season.theme_label}` : "시즌 없음"}
            </p>
            <p className="mt-1 text-xs text-neutral-500">이미지 URL을 줄바꿈으로 입력하세요. 최대 2장.</p>

            {!isLoggedIn ? (
              <p className="mt-3 text-sm text-neutral-500">
                신청/댓글은 로그인 후 이용할 수 있습니다.{" "}
                <Link href="/login" className="text-blue-600 underline">
                  로그인
                </Link>
              </p>
            ) : (
              <div className="mt-3 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setJoinForm((prev) => ({ ...prev, gender: "male" }))}
                    className={`min-h-[44px] rounded-lg border text-sm ${joinForm.gender === "male" ? "bg-blue-600 border-blue-600 text-white" : "border-neutral-300 text-neutral-700"}`}
                  >
                    남성
                  </button>
                  <button
                    type="button"
                    onClick={() => setJoinForm((prev) => ({ ...prev, gender: "female" }))}
                    className={`min-h-[44px] rounded-lg border text-sm ${joinForm.gender === "female" ? "bg-blue-600 border-blue-600 text-white" : "border-neutral-300 text-neutral-700"}`}
                  >
                    여성
                  </button>
                </div>
                <label className="flex min-h-[44px] cursor-pointer items-center justify-center rounded-lg border border-blue-300 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-700">
                  {joinUploading ? "업로드 중..." : "사진 업로드 (최대 2장)"}
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    capture="environment"
                    className="hidden"
                    disabled={joinUploading}
                    onChange={(e) => {
                      void handleJoinImageUpload(e.target.files);
                      e.currentTarget.value = "";
                    }}
                  />
                </label>
                {joinForm.image_urls.length > 0 ? (
                  <div className="grid grid-cols-2 gap-2">
                    {joinForm.image_urls.map((url) => {
                      const preview = toBodyBattleImageUrl(url, { width: 320, quality: 70 });
                      return (
                        <div key={url} className="relative overflow-hidden rounded-lg border border-neutral-200 bg-neutral-100">
                          {preview ? <Image src={preview} alt="" width={320} height={320} className="h-28 w-full object-cover" unoptimized /> : null}
                          <button
                            type="button"
                            onClick={() =>
                              setJoinForm((prev) => ({ ...prev, image_urls: prev.image_urls.filter((v) => v !== url) }))
                            }
                            className="absolute right-1 top-1 rounded bg-black/70 px-2 py-1 text-[11px] text-white"
                          >
                            삭제
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-neutral-500">아직 업로드한 사진이 없습니다.</p>
                )}
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  <p className="font-semibold">신청 전 주의사항</p>
                  <p className="mt-1">본인 사진만 업로드할 수 있으며, 타인 사진/도용/무단 사용 시 삭제 및 이용 제한됩니다.</p>
                  <p className="mt-1">부적절하거나 주제와 무관한 사진은 운영 정책에 따라 비노출 또는 삭제될 수 있습니다.</p>
                  <p className="mt-1">일반 이용자의 인스타그램 릴스(홍보 콘텐츠)에 사진/닉네임이 노출될 수 있습니다.</p>
                </div>
                <label className="flex items-start gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs text-neutral-700">
                  <input
                    type="checkbox"
                    checked={joinForm.consent_policy}
                    onChange={(e) => setJoinForm((prev) => ({ ...prev, consent_policy: e.target.checked }))}
                    className="mt-0.5 h-4 w-4"
                  />
                  <span>[필수] 본인 사진이며 운영정책/가이드를 확인했습니다.</span>
                </label>
                <label className="flex items-start gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs text-neutral-700">
                  <input
                    type="checkbox"
                    checked={joinForm.consent_instagram_reels}
                    onChange={(e) => setJoinForm((prev) => ({ ...prev, consent_instagram_reels: e.target.checked }))}
                    className="mt-0.5 h-4 w-4"
                  />
                  <span>[필수] 인스타그램 릴스 등 외부 홍보 채널 노출 가능성에 동의합니다.</span>
                </label>
                <button
                  type="button"
                  onClick={submitJoin}
                  disabled={joinSubmitting || joinUploading || !joinForm.consent_policy || !joinForm.consent_instagram_reels}
                  className="min-h-[44px] rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {joinSubmitting ? "신청 중..." : "신청하기"}
                </button>
              </div>
            )}
            {applyError ? <p className="mt-2 text-sm text-red-600">{applyError}</p> : null}
          </article>

          {applicantsLoading ? <p className="text-sm text-neutral-500">신청자 목록 불러오는 중...</p> : null}

          {deferredApplicants.map((entry) => {
            const preview = toBodyBattleImageUrl(entry.image_url, { width: 240, quality: 64 });
            const commentText = commentInputByEntry[entry.id] ?? "";
            const commentSubmitting = Boolean(commentSubmittingByEntry[entry.id]);

            return (
              <article key={entry.id} className="rounded-2xl border border-neutral-200 bg-white p-4">
                <div className="flex items-start gap-3">
                  {preview ? (
                    <Image src={preview} alt="" width={120} height={120} unoptimized className="h-20 w-20 rounded-lg object-cover" />
                  ) : (
                    <div className="h-20 w-20 rounded-lg bg-neutral-100" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-neutral-900">{entry.user_nickname}</p>
                    <p className="text-xs text-neutral-500">{entry.gender} · {timeAgo(entry.created_at)}</p>
                    <p className="mt-1 text-xs text-neutral-600">
                      상태: {entry.moderation_status === "approved" ? "승인" : entry.moderation_status === "pending" ? "검수중" : "반려"}
                    </p>
                    {isLoggedIn && applicantsData?.season ? (
                      <button
                        type="button"
                        onClick={() => reportEntry(entry.id, applicantsData.season!.id, "applicant")}
                        className="mt-1 text-xs text-red-500"
                      >
                        신고
                      </button>
                    ) : null}
                  </div>
                </div>

                {entry.intro_text ? <p className="mt-3 whitespace-pre-wrap break-words text-sm text-neutral-700">{entry.intro_text}</p> : null}
                {entry.champion_comment ? <p className="mt-2 text-xs text-neutral-500">한마디: {entry.champion_comment}</p> : null}

                <section className="mt-3 rounded-xl border border-neutral-200 bg-neutral-50 p-3">
                  <p className="text-xs font-semibold text-neutral-700">댓글 {entry.comments.length}</p>
                  <div className="mt-2 space-y-2">
                    {entry.comments.map((comment) => (
                      <div key={comment.id} className="rounded-lg bg-white p-2">
                        <div className="mb-1 flex items-center justify-between">
                          <p className="text-xs font-semibold text-neutral-700">{comment.nickname}</p>
                          {(comment.is_mine || userId === comment.user_id) && !comment.deleted_at ? (
                            <button type="button" onClick={() => deleteComment(comment.id)} className="text-xs text-red-500">
                              삭제
                            </button>
                          ) : null}
                        </div>
                        {comment.deleted_at ? (
                          <p className="text-xs text-neutral-400 italic">삭제된 댓글입니다.</p>
                        ) : (
                          <p className="whitespace-pre-wrap break-words text-sm text-neutral-700">{comment.content}</p>
                        )}
                      </div>
                    ))}
                  </div>

                  {isLoggedIn ? (
                    <div className="mt-3">
                      <textarea
                        value={commentText}
                        onChange={(e) => setCommentInputByEntry((prev) => ({ ...prev, [entry.id]: e.target.value }))}
                        rows={2}
                        maxLength={500}
                        placeholder="댓글을 입력해 주세요"
                        className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
                      />
                      <div className="mt-2 flex items-center justify-between">
                        <p className="text-xs text-neutral-500">{commentText.length}/500</p>
                        <button
                          type="button"
                          onClick={() => submitComment(entry.id)}
                          disabled={commentSubmitting || commentText.trim().length === 0}
                          className="min-h-[36px] rounded-lg bg-neutral-800 px-3 text-xs font-semibold text-white disabled:opacity-50"
                        >
                          {commentSubmitting ? "등록 중..." : "등록"}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </section>
              </article>
            );
          })}
          {applicantsHasMore ? (
            <div className="flex justify-center">
              <button
                type="button"
                onClick={() => loadApplicants(applicantsPage + 1, true)}
                disabled={applicantsLoading}
                className="min-h-[40px] rounded-lg border border-neutral-300 bg-white px-4 text-sm font-semibold text-neutral-700 disabled:opacity-50"
              >
                {applicantsLoading ? "불러오는 중..." : "더 보기"}
              </button>
            </div>
          ) : null}
        </section>
      )}
    </main>
  );
}


