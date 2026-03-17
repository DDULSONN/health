"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  POST_TYPE_COLORS,
  POST_TYPE_ICONS,
  POST_TYPE_LABELS,
  getBadgeFromPayload,
  getBodycheckAverage,
  renderPayloadSummary,
  timeAgo,
  type Post,
} from "@/lib/community";
import VerifiedBadge from "@/components/VerifiedBadge";

type CommunityTab = "all" | "free" | "photo_bodycheck";
type FeedFilter = "all" | "1rm" | "lifts";

type RankingItem = {
  id: string;
  payload_json: Record<string, unknown>;
  profiles: { nickname: string } | null;
};

type RankingData = {
  lifts: RankingItem[];
  oneRm: RankingItem[];
};

type FeedResponse = {
  posts?: Post[];
};

const PRIMARY_TABS: { value: CommunityTab; label: string; description: string }[] = [
  { value: "all", label: "전체글", description: "자유글, 기록, 몸평을 한 번에" },
  { value: "free", label: "자유 게시판", description: "운동 얘기, 정보, 질문" },
  { value: "photo_bodycheck", label: "사진 몸평", description: "사진 평가와 주간 랭킹" },
];

const FEED_FILTERS: { value: FeedFilter; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "1rm", label: "🏋️ 1RM" },
  { value: "lifts", label: "🏆 3대 합계" },
];

export default function CommunityPage() {
  const router = useRouter();
  const [tab, setTab] = useState<CommunityTab>("all");
  const [filterType, setFilterType] = useState<FeedFilter>("all");
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [rankings, setRankings] = useState<RankingData | null>(null);
  const [rankingLoading, setRankingLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const feedCacheRef = useRef(new Map<string, Post[]>());
  const feedRequestIdRef = useRef(0);
  const hasRenderedPostsRef = useRef(false);
  const feedKey = useMemo(() => `${tab}:${tab === "all" ? filterType : "all"}`, [filterType, tab]);

  useEffect(() => {
    hasRenderedPostsRef.current = posts.length > 0;
  }, [posts.length]);

  useEffect(() => {
    createClient()
      .auth.getUser()
      .then(({ data: { user } }) => {
        setUserId(user?.id ?? null);
      });
  }, []);

  const loadFeed = useCallback(async () => {
    const requestId = ++feedRequestIdRef.current;
    const cachedPosts = feedCacheRef.current.get(feedKey);

    if (cachedPosts) {
      setPosts(cachedPosts);
      setLoading(false);
      setIsRefreshing(true);
    } else {
      setLoading(true);
      setIsRefreshing(hasRenderedPostsRef.current);
    }

    const params = new URLSearchParams();
    params.set("tab", tab);

    if (tab === "all" && filterType !== "all") {
      params.set("type", filterType);
    }

    if (tab === "photo_bodycheck") {
      params.set("type", "photo_bodycheck");
    }

    try {
      const res = await fetch(`/api/posts?${params.toString()}`, { cache: "no-store" });
      if (!res.ok) {
        console.error("Feed load failed:", res.status);
        return;
      }
      const data = (await res.json()) as FeedResponse;
      const nextPosts = Array.isArray(data.posts) ? data.posts : [];
      feedCacheRef.current.set(feedKey, nextPosts);
      if (feedRequestIdRef.current === requestId) {
        setPosts(nextPosts);
      }
    } catch (error) {
      console.error("Feed load error:", error);
    } finally {
      if (feedRequestIdRef.current === requestId) {
        setLoading(false);
        setIsRefreshing(false);
      }
    }
  }, [feedKey, filterType, tab]);

  const loadRankings = useCallback(async () => {
    setRankingLoading(true);
    try {
      const res = await fetch("/api/rankings", { cache: "no-store" });
      if (!res.ok) {
        console.error("Rankings load failed:", res.status);
        setRankings(null);
        return;
      }
      setRankings((await res.json()) as RankingData);
    } catch (error) {
      console.error("Rankings load error:", error);
      setRankings(null);
    } finally {
      setRankingLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFeed();
  }, [loadFeed]);

  useEffect(() => {
    void loadRankings();
  }, [loadRankings]);

  const handleWrite = () => {
    const redirect =
      tab === "photo_bodycheck" ? "/community/write?type=photo_bodycheck" : "/community/write";

    if (!userId) {
      router.push(`/login?redirect=${encodeURIComponent(redirect)}`);
      return;
    }

    router.push(redirect);
  };

  const feedHeading = useMemo(() => {
    if (tab === "free") return "자유 게시판";
    if (tab === "photo_bodycheck") return "사진 몸평 피드";
    if (filterType === "1rm") return "1RM 피드";
    if (filterType === "lifts") return "3대 합계 피드";
    return "전체 피드";
  }, [filterType, tab]);

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-neutral-900">커뮤니티</h1>
          <p className="mt-2 text-sm text-neutral-500">
            기록만 따로, 자유글만 따로 흩어지지 않게 메인 피드에서 한 번에 보세요.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {userId ? (
            <Link
              href="/mypage"
              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-2xl border border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50"
              title="마이페이지"
            >
              <svg
                width="20"
                height="20"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                viewBox="0 0 24 24"
              >
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            </Link>
          ) : null}
          <button
            type="button"
            onClick={handleWrite}
            className="inline-flex min-h-[44px] items-center rounded-2xl bg-emerald-600 px-5 text-sm font-semibold text-white transition hover:bg-emerald-700"
          >
            글쓰기
          </button>
        </div>
      </div>

      <section className="mt-5 overflow-hidden rounded-[28px] border border-neutral-200 bg-[linear-gradient(135deg,#0f9f6e_0%,#0d7c73_45%,#f6fbf9_45%,#f8fbff_100%)] p-5 text-white">
        <div className="grid gap-4 md:grid-cols-[1.3fr_0.9fr]">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-100">
              Main Feed
            </p>
            <h2 className="mt-2 text-2xl font-black leading-tight">
              전체글 중심으로
              <br />
              더 활발하게 보이게
            </h2>
            <p className="mt-3 max-w-md text-sm text-emerald-50/90">
              자유글, 1RM, 3대 합계, 사진 몸평을 메인에서 함께 보여주고 몸평은 별도 피드로도 바로 이동할 수 있게
              정리했습니다.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setTab("all");
                  setFilterType("all");
                }}
                className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-emerald-700"
              >
                전체글 보기
              </button>
              <button
                type="button"
                onClick={() => setTab("free")}
                className="rounded-full border border-white/30 bg-white/10 px-4 py-2 text-sm font-medium text-white"
              >
                자유 게시판
              </button>
              <button
                type="button"
                onClick={() => setTab("photo_bodycheck")}
                className="rounded-full border border-white/30 bg-white/10 px-4 py-2 text-sm font-medium text-white"
              >
                사진 몸평
              </button>
            </div>
          </div>

          <div className="rounded-[24px] border border-white/20 bg-white/90 p-4 text-neutral-900 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">
                  Weekly Ranking
                </p>
                <h3 className="mt-1 text-lg font-bold">이번 주 기록 하이라이트</h3>
              </div>
              <Link href="/community/bodycheck" className="text-xs font-semibold text-emerald-700">
                몸평 랭킹 →
              </Link>
            </div>
            <div className="mt-4 space-y-3">
              <MiniRankingCard
                title="3대 합계 TOP"
                item={rankings?.lifts?.[0] ?? null}
                loading={rankingLoading}
                valueKey="totalKg"
                unit="kg"
              />
              <MiniRankingCard
                title="1RM TOP"
                item={rankings?.oneRm?.[0] ?? null}
                loading={rankingLoading}
                valueKey="oneRmKg"
                unit="kg"
                labelKey="lift"
              />
            </div>
          </div>
        </div>
      </section>

      <div className="sticky top-14 z-30 mt-5 border-b border-neutral-200 bg-white/92 pb-4 pt-1 backdrop-blur">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {PRIMARY_TABS.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => {
                setTab(item.value);
                if (item.value !== "all") {
                  setFilterType("all");
                }
              }}
              className={`rounded-2xl border px-4 py-3 text-left transition ${
                tab === item.value
                  ? "border-emerald-600 bg-emerald-600 text-white shadow-sm"
                  : "border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300 hover:bg-neutral-50"
              }`}
            >
              <p className="text-sm font-semibold">{item.label}</p>
              <p className={`mt-1 text-xs ${tab === item.value ? "text-emerald-50" : "text-neutral-400"}`}>
                {item.description}
              </p>
            </button>
          ))}
        </div>

        {tab === "all" ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {FEED_FILTERS.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => setFilterType(item.value)}
                className={`rounded-full px-4 py-2 text-xs font-semibold transition ${
                  filterType === item.value
                    ? "bg-neutral-900 text-white"
                    : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {tab === "photo_bodycheck" ? (
        <div className="mt-5 rounded-2xl border border-indigo-200 bg-indigo-50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-indigo-900">사진 몸평 전용 동선</p>
              <p className="mt-1 text-sm text-indigo-700">
                사진 몸평은 전용 게시판과 주간 랭킹에서 더 빠르게 볼 수 있어요.
              </p>
            </div>
            <Link
              href="/community/bodycheck"
              className="inline-flex min-h-[40px] items-center rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700"
            >
              전용 게시판 보기
            </Link>
          </div>
        </div>
      ) : null}

      <section className="mt-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-neutral-900">{feedHeading}</h2>
            <p className="mt-1 text-xs text-neutral-400">
              헬창 판독기 글은 메인 커뮤니티 피드에서 제외하고, 기록과 자유글 중심으로 보여줍니다.
            </p>
          </div>
        </div>
        <PostList posts={posts} loading={loading} isRefreshing={isRefreshing} />
      </section>
    </main>
  );
}

function PostList({
  posts,
  loading,
  isRefreshing,
}: {
  posts: Post[];
  loading: boolean;
  isRefreshing: boolean;
}) {
  if (loading && posts.length === 0) {
    return (
      <div className="rounded-3xl border border-neutral-200 bg-white p-10 text-center text-sm text-neutral-400">
        글을 불러오는 중입니다.
      </div>
    );
  }

  if (posts.length === 0) {
    return (
      <div className="rounded-3xl border border-dashed border-neutral-300 bg-neutral-50 p-10 text-center text-sm text-neutral-500">
        아직 올라온 글이 없습니다. 첫 글을 남겨서 분위기를 만들어보세요.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-3xl border border-neutral-200 bg-white">
      {isRefreshing ? (
        <div className="border-b border-neutral-100 bg-neutral-50 px-4 py-2 text-right text-[11px] font-medium text-neutral-400">
          새 글 불러오는 중...
        </div>
      ) : null}
      {posts.map((post, index) => {
        const badge = getBadgeFromPayload(post.type, post.payload_json);
        const thumbnailCandidates = [...(post.thumb_images ?? []), ...(post.images ?? [])].filter(
          (url): url is string => typeof url === "string" && url.length > 0
        );
        const previewImage = thumbnailCandidates[0] ?? "";
        const avg = post.type === "photo_bodycheck" ? getBodycheckAverage(post) : null;
        const voteCount = Number(post.vote_count ?? 0);

        return (
          <Link
            key={post.id}
            href={`/community/${post.id}`}
            className={`flex gap-4 px-4 py-4 transition hover:bg-neutral-50 ${
              index > 0 ? "border-t border-neutral-100" : ""
            }`}
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${POST_TYPE_COLORS[post.type]}`}>
                  {POST_TYPE_ICONS[post.type]} {POST_TYPE_LABELS[post.type]}
                </span>
                <span className="text-xs text-neutral-400">{timeAgo(post.created_at)}</span>
              </div>

              <h3 className="mt-2 truncate text-sm font-semibold text-neutral-900 sm:text-[15px]">
                {post.title}
              </h3>

              {post.payload_json && post.type !== "free" ? (
                <p className="mt-1 truncate text-xs text-neutral-500">
                  {renderPayloadSummary(post.type, post.payload_json)}
                </p>
              ) : null}

              {post.content && post.type === "free" ? (
                <p className="mt-1 line-clamp-2 text-xs text-neutral-500">{post.content}</p>
              ) : null}

              {post.type === "photo_bodycheck" ? (
                <p className="mt-1 text-xs font-medium text-indigo-700">
                  평균 {avg?.toFixed(2) ?? "0.00"} · 투표 {voteCount}
                </p>
              ) : null}

              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                <span title={badge.label}>{badge.emoji}</span>
                <span>{post.profiles?.nickname ?? "닉네임 없음"}</span>
                <VerifiedBadge total={post.cert_summary?.total} />
              </div>
            </div>

            {previewImage ? (
              <div className="h-16 w-16 shrink-0 overflow-hidden rounded-2xl border border-neutral-100 sm:h-[72px] sm:w-[72px]">
                <img
                  src={previewImage}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  data-candidates={thumbnailCandidates.join("\n")}
                  data-candidate-index="0"
                  onError={(event) => {
                    const candidates = (event.currentTarget.dataset.candidates ?? "").split("\n").filter(Boolean);
                    const currentIdx = Number(event.currentTarget.dataset.candidateIndex ?? "0");
                    const nextIdx = currentIdx + 1;
                    if (nextIdx < candidates.length) {
                      event.currentTarget.dataset.candidateIndex = String(nextIdx);
                      event.currentTarget.src = candidates[nextIdx] as string;
                    }
                  }}
                  className="h-full w-full object-cover"
                />
              </div>
            ) : null}
          </Link>
        );
      })}
    </div>
  );
}

function MiniRankingCard({
  title,
  item,
  loading,
  valueKey,
  unit,
  labelKey,
}: {
  title: string;
  item: RankingItem | null;
  loading: boolean;
  valueKey: string;
  unit: string;
  labelKey?: string;
}) {
  if (loading) {
    return (
      <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-3">
        <p className="text-xs font-semibold text-neutral-500">{title}</p>
        <p className="mt-2 text-sm text-neutral-400">불러오는 중...</p>
      </div>
    );
  }

  if (!item) {
    return (
      <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-3">
        <p className="text-xs font-semibold text-neutral-500">{title}</p>
        <p className="mt-2 text-sm text-neutral-400">아직 집계된 기록이 없습니다.</p>
      </div>
    );
  }

  const payload = item.payload_json as Record<string, unknown>;
  const prefix = labelKey ? `${String(payload[labelKey] ?? "")} ` : "";
  const value = `${String(payload[valueKey] ?? 0)}${unit}`;

  return (
    <Link
      href={`/community/${item.id}`}
      className="block rounded-2xl border border-neutral-200 bg-neutral-50 p-3 transition hover:border-neutral-300 hover:bg-white"
    >
      <p className="text-xs font-semibold text-neutral-500">{title}</p>
      <p className="mt-2 truncate text-sm font-semibold text-neutral-900">
        {item.profiles?.nickname ?? "익명"}
      </p>
      <p className="mt-1 text-xs text-neutral-500">
        {prefix}
        {value}
      </p>
    </Link>
  );
}
