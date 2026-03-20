"use client";

import Link from "next/link";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
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
type FeedSort = "latest" | "popular" | "comments";
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
  { value: "all", label: "전체글", description: "자유글과 기록, 몸평을 한 번에" },
  { value: "free", label: "자유 게시판", description: "잡담, 질문, 정보 공유" },
  { value: "photo_bodycheck", label: "사진 몸평", description: "사진 평가와 주간 랭킹" },
];

const FEED_FILTERS: { value: FeedFilter; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "1rm", label: "1RM" },
  { value: "lifts", label: "3대 합계" },
];

const SORT_OPTIONS: { value: FeedSort; label: string }[] = [
  { value: "latest", label: "최신순" },
  { value: "popular", label: "인기순" },
  { value: "comments", label: "댓글순" },
];

export default function CommunityPage() {
  const router = useRouter();
  const [tab, setTab] = useState<CommunityTab>("all");
  const [filterType, setFilterType] = useState<FeedFilter>("all");
  const [sort, setSort] = useState<FeedSort>("latest");
  const [searchInput, setSearchInput] = useState("");
  const searchQuery = useDeferredValue(searchInput.trim());
  const [page, setPage] = useState(1);
  const [posts, setPosts] = useState<Post[]>([]);
  const [totalPosts, setTotalPosts] = useState(0);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [popularPosts, setPopularPosts] = useState<Post[]>([]);
  const [popularLoading, setPopularLoading] = useState(true);
  const [rankingGender, setRankingGender] = useState<RankingGender>("male");
  const [ranking, setRanking] = useState<WeeklyRankingResponse | null>(null);
  const [rankingLoading, setRankingLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [tabReady, setTabReady] = useState(false);
  const feedCacheRef = useRef(new Map<string, FeedCacheEntry>());
  const feedRequestIdRef = useRef(0);
  const hasRenderedPostsRef = useRef(false);
  const searchInitRef = useRef(false);

  const activeType = useMemo(() => {
    if (tab === "photo_bodycheck") return "photo_bodycheck";
    if (tab === "all" && filterType !== "all") return filterType;
    return "all";
  }, [filterType, tab]);

  const feedKey = useMemo(
    () => `${tab}:${activeType}:${sort}:${searchQuery.toLowerCase()}:${page}`,
    [activeType, page, searchQuery, sort, tab]
  );
  const totalPages = Math.max(1, Math.ceil(totalPosts / POSTS_PER_PAGE));
  const visiblePagination = useMemo(() => {
    const start = Math.max(1, page - 2);
    const end = Math.min(totalPages, start + 4);
    const adjustedStart = Math.max(1, end - 4);
    return Array.from({ length: end - adjustedStart + 1 }, (_, index) => adjustedStart + index);
  }, [page, totalPages]);
  const topRankingItems = ranking?.items ?? [];
  const showPopularSection = searchQuery.length === 0;

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
    const requestedType = params?.get("type");
    const requestedSort = params?.get("sort");
    const requestedSearch = params?.get("q");

    if (requestedTab === "all" || requestedTab === "free" || requestedTab === "photo_bodycheck") {
      setTab(requestedTab);
      if (requestedTab !== "all") {
        setFilterType("all");
      }
    }

    if (requestedType === "1rm" || requestedType === "lifts") {
      setFilterType(requestedType);
    }

    if (requestedSort === "latest" || requestedSort === "popular" || requestedSort === "comments") {
      setSort(requestedSort);
    }

    if (requestedSearch) {
      setSearchInput(requestedSearch.slice(0, 40));
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

  useEffect(() => {
    if (!tabReady) return;
    const params = new URLSearchParams();
    if (tab !== "all") params.set("tab", tab);
    if (tab === "all" && filterType !== "all") params.set("type", filterType);
    if (sort !== "latest") params.set("sort", sort);
    if (searchQuery) params.set("q", searchQuery);
    const nextUrl = params.toString() ? `/community?${params.toString()}` : "/community";
    router.replace(nextUrl, { scroll: false });
  }, [filterType, router, searchQuery, sort, tab, tabReady]);

  useEffect(() => {
    setPage(1);
  }, [searchQuery]);

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
    params.set("page", String(page));
    params.set("sort", sort);

    if (activeType !== "all") {
      params.set("type", activeType);
    }

    if (searchQuery) {
      params.set("q", searchQuery);
    }

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
  }, [activeType, feedKey, page, searchQuery, sort, tab]);

  useEffect(() => {
    if (!tabReady) return;
    void loadFeed();
  }, [loadFeed, tabReady]);

  const loadPopularPosts = useCallback(async () => {
    if (!showPopularSection) {
      setPopularPosts([]);
      setPopularLoading(false);
      return;
    }

    setPopularLoading(true);
    const params = new URLSearchParams();
    params.set("tab", tab);
    params.set("sort", "popular");
    params.set("limit", "3");
    params.set("fresh", "1");

    if (activeType !== "all") {
      params.set("type", activeType);
    }

    try {
      const res = await fetch(`/api/posts?${params.toString()}`, { cache: "no-store" });
      if (!res.ok) {
        setPopularPosts([]);
        return;
      }
      const data = (await res.json()) as FeedResponse;
      setPopularPosts(Array.isArray(data.posts) ? data.posts.slice(0, 3) : []);
    } catch (error) {
      console.error("Popular posts load error:", error);
      setPopularPosts([]);
    } finally {
      setPopularLoading(false);
    }
  }, [activeType, showPopularSection, tab]);

  useEffect(() => {
    if (!tabReady) return;
    void loadPopularPosts();
  }, [loadPopularPosts, tabReady]);

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
    if (searchQuery) return `"${searchQuery}" 검색 결과`;
    if (tab === "free") return "자유 게시판";
    if (tab === "photo_bodycheck") return "사진 몸평 피드";
    if (filterType === "1rm") return "1RM 피드";
    if (filterType === "lifts") return "3대 합계 피드";
    return "전체 피드";
  }, [filterType, searchQuery, tab]);

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
            <p className="mt-2 text-sm text-neutral-600">지금 반응 좋은 몸평 글을 메인에서 바로 확인해보세요.</p>
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
            몸평 랭킹을 불러오는 중입니다.
          </div>
        ) : topRankingItems.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-amber-200 bg-white px-4 py-8 text-center text-sm text-neutral-500">
            랭킹 집계 중입니다. 최소 {ranking?.min_votes ?? 5}표 이상부터 노출됩니다.
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

      <div className="sticky top-14 z-30 mt-4 border-b border-neutral-200 bg-white/92 pb-3 pt-1 backdrop-blur">
        <div className="-mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0">
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
              className={`min-w-[160px] shrink-0 rounded-2xl border px-4 py-3 text-left transition sm:min-w-0 ${
                tab === item.value
                  ? "border-emerald-600 bg-emerald-600 text-white shadow-sm"
                  : "border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300 hover:bg-neutral-50"
              }`}
            >
              <p className="text-sm font-semibold">{item.label}</p>
              <p className={`mt-1 hidden text-xs sm:block ${tab === item.value ? "text-emerald-50" : "text-neutral-400"}`}>
                {item.description}
              </p>
            </button>
          ))}
        </div>

        <div className="mt-3 flex flex-col gap-2">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <input
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value.slice(0, 40))}
                placeholder="제목이나 내용으로 검색"
                className="min-h-[44px] w-full rounded-2xl border border-neutral-200 bg-white px-4 pr-20 text-sm text-neutral-700 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
              />
              {searchInput ? (
                <button
                  type="button"
                  onClick={() => setSearchInput("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full px-3 py-1 text-xs font-medium text-neutral-500 hover:bg-neutral-100"
                >
                  지우기
                </button>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              {SORT_OPTIONS.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => {
                    setSort(item.value);
                    setPage(1);
                  }}
                  className={`rounded-full px-3 py-2 text-xs font-semibold transition ${
                    sort === item.value
                      ? "bg-neutral-900 text-white"
                      : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {tab === "all" ? (
            <div className="flex flex-wrap gap-2">
              {FEED_FILTERS.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => {
                    setFilterType(item.value);
                    setPage(1);
                  }}
                  className={`rounded-full px-3 py-2 text-xs font-semibold transition ${
                    filterType === item.value
                      ? "bg-emerald-600 text-white"
                      : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {showPopularSection ? (
        <section className="mt-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-neutral-900">지금 인기 있는 글</h2>
              <p className="mt-1 text-xs text-neutral-400">추천, 댓글, 몸평 반응이 좋은 글을 먼저 보여드려요.</p>
            </div>
          </div>
          <PopularPosts posts={popularPosts} loading={popularLoading} />
        </section>
      ) : null}

      {tab === "photo_bodycheck" ? (
        <div className="mt-5 rounded-2xl border border-indigo-200 bg-indigo-50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-indigo-900">커뮤니티 몸평 탭</p>
              <p className="mt-1 text-sm text-indigo-700">
                별도 게시판 없이 여기에서 몸평 글과 주간 랭킹을 함께 볼 수 있어요.
              </p>
            </div>
            <Link
              href="/community?tab=photo_bodycheck"
              className="inline-flex min-h-[40px] items-center rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700"
            >
              몸평 탭 링크 복사
            </Link>
          </div>
        </div>
      ) : null}

      <section className="mt-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-neutral-900">{feedHeading}</h2>
            <p className="mt-1 text-xs text-neutral-400">
              {searchQuery
                ? "검색어에 맞는 글만 추려서 보여드립니다."
                : "최신 글부터 인기글, 댓글 많은 글까지 원하는 방식으로 둘러보세요."}
            </p>
          </div>
        </div>
        <div className="mb-3 -mt-1 flex justify-between gap-3">
          <p className="text-xs text-neutral-400">
            {searchQuery ? `검색어: ${searchQuery}` : "탭과 정렬을 바꾸면 바로 다시 불러옵니다."}
          </p>
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

function PopularPosts({ posts, loading }: { posts: Post[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="rounded-3xl border border-neutral-200 bg-white p-6 text-center text-sm text-neutral-400">
        인기글을 정리하는 중입니다.
      </div>
    );
  }

  if (posts.length === 0) {
    return null;
  }

  return (
    <div className="grid gap-3 md:grid-cols-3">
      {posts.map((post, index) => {
        const badge = getBadgeFromPayload(post.type, post.payload_json);
        const avg = post.type === "photo_bodycheck" ? getBodycheckAverage(post) : null;

        return (
          <Link
            key={post.id}
            href={`/community/${post.id}`}
            className="rounded-[24px] border border-neutral-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700">
                HOT {index + 1}
              </span>
              <span className="text-[11px] text-neutral-400">{timeAgo(post.created_at)}</span>
            </div>
            <p className="mt-3 flex items-center gap-2 text-xs text-neutral-500">
              <span className={`rounded-full px-2 py-1 font-semibold ${POST_TYPE_COLORS[post.type]}`}>
                {POST_TYPE_ICONS[post.type]} {POST_TYPE_LABELS[post.type]}
              </span>
              <span title={badge.label}>{badge.emoji}</span>
            </p>
            <h3 className="mt-3 line-clamp-2 text-sm font-semibold text-neutral-900">{post.title}</h3>
            <p className="mt-2 line-clamp-2 text-xs text-neutral-500">
              {post.type === "free"
                ? post.content ?? "커뮤니티 반응이 빠르게 쌓이고 있는 글입니다."
                : renderPayloadSummary(post.type, post.payload_json)}
            </p>
            <div className="mt-4 flex flex-wrap gap-3 text-xs font-medium text-neutral-500">
              <span>댓글 {post.comment_count ?? 0}</span>
              {post.type === "free" && post.reaction_summary ? <span>점수 {post.reaction_summary.score}</span> : null}
              {post.type === "photo_bodycheck" ? <span>평균 {avg?.toFixed(2) ?? "0.00"}</span> : null}
            </div>
          </Link>
        );
      })}
    </div>
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
        아직 올라온 글이 없습니다. 첫 글로 분위기를 만들어보세요.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-3xl border border-neutral-200 bg-white">
      {isRefreshing ? (
        <div className="border-b border-neutral-100 bg-neutral-50 px-4 py-2 text-right text-[11px] font-medium text-neutral-400">
          새 글을 불러오는 중입니다.
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

              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs font-medium">
                <span className="text-neutral-500">댓글 {post.comment_count ?? 0}</span>
                {post.type === "free" && post.reaction_summary ? (
                  <span className="text-emerald-700">
                    추천 {post.reaction_summary.up_count} · 비추천 {post.reaction_summary.down_count} · 점수 {post.reaction_summary.score}
                  </span>
                ) : null}
                {post.type === "photo_bodycheck" ? (
                  <span className="text-indigo-700">평균 {avg?.toFixed(2) ?? "0.00"} · 투표 {voteCount}</span>
                ) : null}
              </div>

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
