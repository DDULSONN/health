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
  image_urls_text: string;
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
  image_urls_text: "",
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
        setError("Failed to load current matchup.");
        setPayload(null);
      } else {
        setPayload(data);
      }
    } catch {
      setError("Network error while loading matchup.");
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
        setApplyError("Failed to load applicants.");
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
      setApplyError("Network error while loading applicants.");
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
        setError(data.message ?? "Failed to submit vote.");
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
      setError("Network error while submitting vote.");
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
        setError(data.message ?? "Failed to claim reward.");
        return;
      }
      await loadMyProgress();
    } catch {
      setError("Network error while claiming reward.");
    } finally {
      setClaimingCode(null);
    }
  }

  async function submitJoin() {
    const seasonId = applicantsData?.season?.id ?? payload?.season?.id ?? null;
    if (!seasonId) {
      setApplyError("No active season.");
      return;
    }
    const imageUrls = joinForm.image_urls_text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    if (!joinForm.consent_policy || !joinForm.consent_instagram_reels) {
      setApplyError("필수 동의 항목을 모두 체크해 주세요.");
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
        setApplyError(data.message ?? "Failed to submit application.");
        return;
      }
      setJoinForm(INITIAL_JOIN_FORM);
      await loadApplicants(1, false);
    } catch {
      setApplyError("Network error while submitting application.");
    } finally {
      setJoinSubmitting(false);
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
        setApplyError(data.message ?? "Failed to submit comment.");
        return;
      }
      setCommentInputByEntry((prev) => ({ ...prev, [entryId]: "" }));
      await loadApplicants(1, false);
    } catch {
      setApplyError("Network error while submitting comment.");
    } finally {
      setCommentSubmittingByEntry((prev) => ({ ...prev, [entryId]: false }));
    }
  }

  async function deleteComment(commentId: string) {
    if (!confirm("?볤?????젣?좉퉴??")) return;
    try {
      const res = await fetch(`/api/bodybattle/comments/${commentId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { message?: string } | null;
        setApplyError(data?.message ?? "Failed to delete comment.");
        return;
      }
      await loadApplicants(1, false);
    } catch {
      setApplyError("Network error while deleting comment.");
    }
  }

  async function reportEntry(entryId: string, seasonId: string, source: "matchup" | "applicant") {
    const reason = window.prompt("Report reason (spam, abuse, stolen photo, etc)");
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
        const message = data?.message ?? "Failed to report.";
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
      if (source === "applicant") setApplyError("Network error while reporting.");
      else setError("Network error while reporting.");
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
          <h1 className="text-2xl font-bold text-neutral-900">BodyBattle</h1>
          <p className="mt-1 text-sm text-neutral-500">Weekly training-based champion battle.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/bodybattle/ranking" className="rounded-lg border border-neutral-300 px-3 py-2 text-xs font-medium text-neutral-700">
            Weekly Ranking
          </Link>
          <Link href="/bodybattle/hall-of-fame" className="rounded-lg border border-neutral-300 px-3 py-2 text-xs font-medium text-neutral-700">
            Hall of Fame
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
                Lv.{progress.level} · XP {progress.xp} · Next {progress.xp_next_level}
              </p>
              <p className="mt-1 text-xs text-emerald-800">
                Total votes {progress.total_votes} · Today {progress.daily_votes} · Streak {progress.vote_streak_days}d · Apply credits {creditsRemaining}
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
                        {reward.label} · +{reward.amount} credit
                      </p>
                      {reward.claimed ? (
                        <span className="text-xs text-emerald-700">Claimed</span>
                      ) : reward.claimable ? (
                        <button
                          type="button"
                          onClick={() => claimReward(reward.code)}
                          disabled={claimingCode === reward.code}
                          className="rounded bg-emerald-600 px-2 py-1 text-xs font-semibold text-white disabled:opacity-50"
                        >
                          {claimingCode === reward.code ? "..." : "Claim"}
                        </button>
                      ) : (
                        <span className="text-xs text-neutral-400">{reward.met ? "Ready" : "Locked"}</span>
                      )}
                    </div>
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}

          {loading ? <p className="text-sm text-neutral-500">Loading matchup...</p> : null}
          {error ? <p className="mb-3 text-sm text-red-600">{error}</p> : null}

          {voteFeedback ? (
            <section className="mb-3 rounded-2xl border border-blue-200 bg-blue-50 p-4">
              <p className="text-sm font-semibold text-blue-900">+{voteFeedback.reward.xp_gained} XP</p>
              <p className="mt-1 text-xs text-blue-800">
                Left {voteFeedback.matchup_stats.left_pct}% · Similar {voteFeedback.matchup_stats.draw_pct}% · Right {voteFeedback.matchup_stats.right_pct}% · Total {voteFeedback.matchup_stats.total}
              </p>
            </section>
          ) : null}

          <section className="mb-3 rounded-2xl border border-neutral-200 bg-white p-4">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-semibold text-neutral-900">Voter Scoreboard</p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setScoreMode("all")}
                  className={`rounded px-2 py-1 text-[11px] ${scoreMode === "all" ? "bg-neutral-800 text-white" : "bg-neutral-100 text-neutral-600"}`}
                >
                  All
                </button>
                <button
                  type="button"
                  onClick={() => setScoreMode("weekly")}
                  className={`rounded px-2 py-1 text-[11px] ${scoreMode === "weekly" ? "bg-neutral-800 text-white" : "bg-neutral-100 text-neutral-600"}`}
                >
                  Weekly
                </button>
              </div>
            </div>
            {scoreboardLoading ? <p className="text-xs text-neutral-500">Loading scoreboard...</p> : null}
            {!scoreboardLoading && scoreboard.length === 0 ? <p className="text-xs text-neutral-500">No score data yet.</p> : null}
            {myScoreboardRow ? (
              <p className="mb-2 text-xs font-semibold text-blue-700">
                You: #{myScoreboardRow.rank} · {myScoreboardRow.nickname}
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
                    {scoreMode === "weekly" ? `Weekly XP ${row.weekly_xp} · Weekly Votes ${row.weekly_votes}` : `Lv.${row.level} · XP ${row.xp} · Votes ${row.total_votes}`}
                    {row.streak_badge ? ` · ${row.streak_badge}` : ""}
                  </p>
                </div>
              ))}
            </div>
          </section>

          {seasonSummary?.latest ? (
            <section className="mb-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <p className="text-xs font-semibold text-amber-800">
                Last Finalized: {seasonSummary.latest.week_id ?? "-"} · {seasonSummary.latest.theme_label ?? "-"}
              </p>
              <p className="mt-1 text-sm text-amber-900">
                Champion: {seasonSummary.latest.champion?.nickname ?? "TBD"} {seasonSummary.latest.champion?.rating ? `(Rating ${seasonSummary.latest.champion.rating})` : ""}
              </p>
              {seasonSummary.me ? (
                <p className="mt-1 text-xs text-amber-900">Your rank in that season: #{seasonSummary.me.rank ?? "-"}</p>
              ) : null}
            </section>
          ) : null}

          {!loading && !payload?.season ? (
            <section className="rounded-2xl border border-neutral-200 bg-white p-5">
              <p className="text-sm text-neutral-700">No active season right now.</p>
            </section>
          ) : null}

          {!loading && payload?.season && !payload.matchup ? (
            <section className="rounded-2xl border border-neutral-200 bg-white p-5">
              <p className="text-sm font-semibold text-neutral-800">{payload.season.week_id}</p>
              <p className="mt-1 text-sm text-neutral-600">{payload.message ?? "Not enough entries to build a matchup yet."}</p>
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
                    Rating {Number(payload.matchup.left.rating ?? 1000).toFixed(0)} · Streak {Number(payload.matchup.left.current_streak ?? 0)}
                  </p>
                  {isLoggedIn && payload.season ? (
                    <button
                      type="button"
                      onClick={() => reportEntry(payload.matchup!.left.id, payload.season!.id, "matchup")}
                      className="mt-2 text-xs text-red-500"
                    >
                      Report
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
                    Rating {Number(payload.matchup.right.rating ?? 1000).toFixed(0)} · Streak {Number(payload.matchup.right.current_streak ?? 0)}
                  </p>
                  {isLoggedIn && payload.season ? (
                    <button
                      type="button"
                      onClick={() => reportEntry(payload.matchup!.right.id, payload.season!.id, "matchup")}
                      className="mt-2 text-xs text-red-500"
                    >
                      Report
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
                  Left wins
                </button>
                <button
                  type="button"
                  onClick={() => vote("draw")}
                  disabled={submitting}
                  className="min-h-[44px] rounded-lg bg-neutral-700 px-3 text-sm font-semibold text-white disabled:opacity-50"
                >
                  Similar
                </button>
                <button
                  type="button"
                  onClick={() => vote("right")}
                  disabled={submitting}
                  className="min-h-[44px] rounded-lg bg-blue-600 px-3 text-sm font-semibold text-white disabled:opacity-50"
                >
                  Right wins
                </button>
              </div>
            </section>
          ) : null}
        </>
      ) : (
        <section className="space-y-4">
          <article className="rounded-2xl border border-neutral-200 bg-white p-4">
            <p className="text-sm font-semibold text-neutral-900">
              {applicantsData?.season ? `${applicantsData.season.week_id} · ${applicantsData.season.theme_label}` : "No season"}
            </p>
            <p className="mt-1 text-xs text-neutral-500">이미지 URL을 줄바꿈으로 입력하세요. 최대 2장.</p>

            {!isLoggedIn ? (
              <p className="mt-3 text-sm text-neutral-500">
                Login required for apply/comment.{" "}
                <Link href="/login" className="text-blue-600 underline">
                  Login
                </Link>
              </p>
            ) : (
              <div className="mt-3 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setJoinForm((prev) => ({ ...prev, gender: "male" }))}
                    className={`min-h-[40px] rounded-lg border text-sm ${joinForm.gender === "male" ? "bg-blue-600 border-blue-600 text-white" : "border-neutral-300 text-neutral-700"}`}
                  >
                    Male
                  </button>
                  <button
                    type="button"
                    onClick={() => setJoinForm((prev) => ({ ...prev, gender: "female" }))}
                    className={`min-h-[40px] rounded-lg border text-sm ${joinForm.gender === "female" ? "bg-blue-600 border-blue-600 text-white" : "border-neutral-300 text-neutral-700"}`}
                  >
                    Female
                  </button>
                </div>
                <textarea
                  value={joinForm.image_urls_text}
                  onChange={(e) => setJoinForm((prev) => ({ ...prev, image_urls_text: e.target.value }))}
                  rows={2}
                  placeholder={"이미지 URL (한 줄에 1개)\nhttps://..."}
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
                />
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
                  disabled={joinSubmitting || !joinForm.consent_policy || !joinForm.consent_instagram_reels}
                  className="min-h-[44px] rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {joinSubmitting ? "Submitting..." : "Submit"}
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
                    <p className="mt-1 text-xs text-neutral-600">Status: {entry.moderation_status}</p>
                    {isLoggedIn && applicantsData?.season ? (
                      <button
                        type="button"
                        onClick={() => reportEntry(entry.id, applicantsData.season!.id, "applicant")}
                        className="mt-1 text-xs text-red-500"
                      >
                        Report
                      </button>
                    ) : null}
                  </div>
                </div>

                {entry.intro_text ? <p className="mt-3 whitespace-pre-wrap break-words text-sm text-neutral-700">{entry.intro_text}</p> : null}
                {entry.champion_comment ? <p className="mt-2 text-xs text-neutral-500">Quote: {entry.champion_comment}</p> : null}

                <section className="mt-3 rounded-xl border border-neutral-200 bg-neutral-50 p-3">
                  <p className="text-xs font-semibold text-neutral-700">Comments {entry.comments.length}</p>
                  <div className="mt-2 space-y-2">
                    {entry.comments.map((comment) => (
                      <div key={comment.id} className="rounded-lg bg-white p-2">
                        <div className="mb-1 flex items-center justify-between">
                          <p className="text-xs font-semibold text-neutral-700">{comment.nickname}</p>
                          {(comment.is_mine || userId === comment.user_id) && !comment.deleted_at ? (
                            <button type="button" onClick={() => deleteComment(comment.id)} className="text-xs text-red-500">
                              Delete
                            </button>
                          ) : null}
                        </div>
                        {comment.deleted_at ? (
                          <p className="text-xs text-neutral-400 italic">Deleted comment.</p>
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
                        placeholder="Write comment"
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
                          {commentSubmitting ? "Posting..." : "Post"}
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
                {applicantsLoading ? "Loading..." : "Load more"}
              </button>
            </div>
          ) : null}
        </section>
      )}
    </main>
  );
}


