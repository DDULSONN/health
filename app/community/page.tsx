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
type RankingGender = "male" | "female";

type WeeklyTopItem = {
  post_id: string;
  title: string;
  user_id: string;
  images: string[];
  created_at: string;
  score_sum: number;
  vote_count: number;
  score_avg: number;
  profiles?: { nickname: string } | null;
};

type WeeklyRankingResponse = {
  week_id: string;
  gender: RankingGender;
  min_votes: number;
  items: WeeklyTopItem[];
};

type FeedResponse = {
  posts?: Post[];
  total?: number;
  page?: number;
};

type FeedCacheEntry = {
  posts: Post[];
  total: number;
  page: number;
};

const POSTS_PER_PAGE = 20;

const PRIMARY_TABS: { value: CommunityTab; label: string; description: string }[] = [
  { value: "all", label: "전체글", description: "지금 올라오는 글 한눈에" },
  { value: "free", label: "자유 게시판", description: "잡담, 질문, 정보 공유" },
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
  const [page, setPage] = useState(1);
  const [posts, setPosts] = useState<Post[]>([]);
  const [totalPosts, setTotalPosts] = useState(0);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [rankingGender, setRankingGender] = useState<RankingGender>("male");
  const [ranking, setRanking] = useState<WeeklyRankingResponse | null>(null);
  const [rankingLoading, setRankingLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [tabReady, setTabReady] = useState(false);
  const feedCacheRef = useRef(new Map<string, FeedCacheEntry>());
  const feedRequestIdRef = useRef(0);
  const hasRenderedPostsRef = useRef(false);
  const searchInitRef = useRef(false);
  const feedKey = useMemo(() => `${tab}:${tab === "all" ? filterType : "all"}:${page}`, [filterType, page, tab]);
  const totalPages = Math.max(1, Math.ceil(totalPosts / POSTS_PER_PAGE));
  const visiblePagination = useMemo(() => {
    const start = Math.max(1, page - 2);
    const end = Math.min(totalPages, start + 4);
    const adjustedStart = Math.max(1, end - 4);
    return Array.from({ length: end - adjustedStart + 1 }, (_, index) => adjustedStart + index);
  }, [page, totalPages]);

  useEffect(() => {
    hasRenderedPostsRef.current = posts.length > 0;
  }, [posts.length]);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  useEffect(() => {
    if (searchInitRef.current) return;

    const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
    const requestedTab = params?.get("tab");
    if (requestedTab === "all" || requestedTab === "free" || requestedTab === "photo_bodycheck") {
      setTab(requestedTab);
      if (requestedTab !== "all") {
        setFilterType("all");
      }
    }

    searchInitRef.current = true;
    setTabReady(true);
  }, []);

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
      setPosts(cachedPosts.posts);
      setTotalPosts(cachedPosts.total);
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

    params.set("page", String(page));

    try {
      const res = await fetch(`/api/posts?${params.toString()}`, { cache: "no-store" });
      if (!res.ok) {
        console.error("Feed load failed:", res.status);
        return;
      }
      const data = (await res.json()) as FeedResponse;
      const nextPosts = Array.isArray(data.posts) ? data.posts : [];
      const nextTotal = typeof data.total === "number" ? data.total : 0;
      feedCacheRef.current.set(feedKey, { posts: nextPosts, total: nextTotal, page });
      if (feedRequestIdRef.current === requestId) {
        setPosts(nextPosts);
        setTotalPosts(nextTotal);
      }
    } catch (error) {
      console.error("Feed load error:", error);
    } finally {
      if (feedRequestIdRef.current === requestId) {
        setLoading(false);
        setIsRefreshing(false);
      }
    }
  }, [feedKey, filterType, page, tab]);

  useEffect(() => {
    if (!tabReady) return;
    void loadFeed();
  }, [loadFeed, tabReady]);

  const loadRanking = useCallback(async (gender: RankingGender) => {
    setRankingLoading(true);
    try {
      const res = await fetch(`/api/rankings/weekly-bodycheck?gender=${gender}&top=3`, {
        cache: "no-store",
      });
      if (!res.ok) {
        setRanking(null);
        return;
      }
      const data = (await res.json()) as WeeklyRankingResponse;
      setRanking(data);
    } catch (error) {
      console.error("Ranking load error:", error);
      setRanking(null);
    } finally {
      setRankingLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRanking(rankingGender);
  }, [loadRanking, rankingGender]);

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
  const topRankingItems = ranking?.items ?? [];

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-neutral-900">커뮤니티</h1>
          <p className="mt-2 text-sm text-neutral-500">
            운동 기록도 보고, 자유글도 보고, 몸평도 한 곳에서 편하게 둘러보세요.
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

      <section className="mt-5 rounded-[28px] border border-amber-200 bg-gradient-to-r from-amber-50 via-orange-50 to-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-700">Bodycheck Ranking</p>
            <h2 className="mt-1 text-2xl font-black text-neutral-900">이번 주 몸평 랭킹</h2>
            <p className="mt-2 text-sm text-neutral-600">지금 반응 좋은 몸평 글을 메인에서 바로 확인하세요.</p>
          </div>
          <div className="grid grid-cols-2 overflow-hidden rounded-2xl border border-amber-200 bg-white">
            <button
              type="button"
              onClick={() => setRankingGender("male")}
              className={`min-h-[42px] min-w-[72px] px-4 text-sm font-semibold transition ${
                rankingGender === "male" ? "bg-amber-500 text-white" : "text-amber-800 hover:bg-amber-50"
              }`}
            >
              남자
            </button>
            <button
              type="button"
              onClick={() => setRankingGender("female")}
              className={`min-h-[42px] min-w-[72px] px-4 text-sm font-semibold transition ${
                rankingGender === "female" ? "bg-amber-500 text-white" : "text-amber-800 hover:bg-amber-50"
              }`}
            >
              여자
            </button>
          </div>
        </div>

        {rankingLoading ? (
          <div className="mt-4 rounded-2xl border border-amber-200 bg-white px-4 py-8 text-center text-sm text-neutral-500">
            몸평 랭킹 불러오는 중...
          </div>
        ) : topRankingItems.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-amber-200 bg-white px-4 py-8 text-center text-sm text-neutral-500">
            랭킹 집계중입니다. 최소 {ranking?.min_votes ?? 5}표 이상부터 노출됩니다.
          </div>
        ) : (
          <div className="-mx-1 mt-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-2 md:mx-0 md:grid md:grid-cols-3 md:overflow-visible md:px-0 md:pb-0">
            {topRankingItems.map((item, index) => {
              const previewImage = item.images[0] ?? "";

              return (
                <Link
                  key={item.post_id}
                  href={`/community/${item.post_id}`}
                  className="min-w-[240px] snap-start overflow-hidden rounded-[22px] border border-amber-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md md:min-w-0"
                >
                  {previewImage ? (
                    <div className="aspect-[4/5] w-full overflow-hidden bg-amber-100">
                      <img src={previewImage} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                    </div>
                  ) : (
                    <div className="flex aspect-[4/5] w-full items-center justify-center bg-amber-50 text-sm text-amber-700">
                      사진 없음
                    </div>
                  )}
                  <div className="p-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-bold text-amber-700">
                        TOP {index + 1}
                      </span>
                      <span className="text-[11px] text-neutral-400">{timeAgo(item.created_at)}</span>
                    </div>
                    <p className="mt-3 line-clamp-1 text-sm font-semibold text-neutral-900">
                      {item.profiles?.nickname ?? "익명"}
                    </p>
                    <p className="mt-1 line-clamp-2 text-sm text-neutral-600">{item.title}</p>
                    <p className="mt-3 text-xs font-medium text-amber-700">
                      평균 {item.score_avg.toFixed(2)} · 투표 {item.vote_count}표
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        )}

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={() => {
              setTab("photo_bodycheck");
              setFilterType("all");
              setPage(1);
            }}
            className="inline-flex min-h-[42px] items-center rounded-xl bg-amber-500 px-4 text-sm font-semibold text-white transition hover:bg-amber-600"
          >
            몸평 글 모아보기
          </button>
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
                setPage(1);
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
                onClick={() => {
                  setFilterType(item.value);
                  setPage(1);
                }}
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
              <p className="text-sm font-semibold text-indigo-900">커뮤니티 몸평 탭</p>
              <p className="mt-1 text-sm text-indigo-700">
                전용 게시판 없이 이 탭에서 몸평 글과 주간 랭킹을 함께 볼 수 있어요.
              </p>
            </div>
            <Link
              href="/community?tab=photo_bodycheck"
              className="inline-flex min-h-[40px] items-center rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700"
            >
              몸평 탭 유지중
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
        <div className="mb-3 -mt-1 flex justify-end">
          <p className="text-xs font-medium text-neutral-400">
            {totalPosts > 0 ? `${page} / ${totalPages} 페이지 · 총 ${totalPosts}개` : "총 0개"}
          </p>
        </div>
        <PostList posts={posts} loading={loading} isRefreshing={isRefreshing} />
        {totalPosts > POSTS_PER_PAGE ? (
          <nav className="mt-4 flex flex-wrap items-center justify-center gap-2" aria-label="커뮤니티 페이지 이동">
            <button
              type="button"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={page === 1}
              className="rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm font-medium text-neutral-600 transition hover:border-neutral-300 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              이전
            </button>
            {visiblePagination.map((pageNumber) => (
              <button
                key={pageNumber}
                type="button"
                onClick={() => setPage(pageNumber)}
                aria-current={pageNumber === page ? "page" : undefined}
                className={`min-w-10 rounded-xl px-3 py-2 text-sm font-semibold transition ${
                  pageNumber === page
                    ? "bg-emerald-600 text-white"
                    : "border border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300 hover:bg-neutral-50"
                }`}
              >
                {pageNumber}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              disabled={page === totalPages}
              className="rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm font-medium text-neutral-600 transition hover:border-neutral-300 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              다음
            </button>
          </nav>
        ) : null}
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

              {post.type === "free" && post.reaction_summary ? (
                <p className="mt-1 text-xs font-medium text-emerald-700">
                  추천 {post.reaction_summary.up_count} · 비추천 {post.reaction_summary.down_count} · 점수 {post.reaction_summary.score}
                </p>
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
