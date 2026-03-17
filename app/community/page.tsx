"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  POST_TYPE_LABELS,
  POST_TYPE_COLORS,
  POST_TYPE_ICONS,
  renderPayloadSummary,
  getBadgeFromPayload,
  timeAgo,
  getBodycheckAverage,
  type Post,
  type PostType,
} from "@/lib/community";
import VerifiedBadge from "@/components/VerifiedBadge";

type Tab = "records" | "photo_bodycheck" | "free" | "ranking";
type RankingData = {
  lifts: {
    id: string;
    payload_json: Record<string, unknown>;
    profiles: { nickname: string } | null;
  }[];
  oneRm: {
    id: string;
    payload_json: Record<string, unknown>;
    profiles: { nickname: string } | null;
  }[];
};

const TAB_LABELS: Record<Tab, string> = {
  records: "기록 피드",
  photo_bodycheck: "사진 몸평",
  free: "자유 게시판",
  ranking: "랭킹",
};

const RECORD_TYPES: (PostType | "all")[] = [
  "all",
  "1rm",
  "lifts",
  "helltest",
];

export default function CommunityPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("records");
  const [posts, setPosts] = useState<Post[]>([]);
  const [filterType, setFilterType] = useState<PostType | "all">("all");
  const [loading, setLoading] = useState(true);
  const [rankings, setRankings] = useState<RankingData | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    createClient()
      .auth.getUser()
      .then(({ data: { user } }) => {
        setUserId(user?.id ?? null);
      });
  }, []);

  const loadFeed = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (tab === "records") params.set("tab", "records");
    else if (tab === "photo_bodycheck") params.set("tab", "photo_bodycheck");
    else params.set("tab", "free");

    if (tab === "records" && filterType !== "all") params.set("type", filterType);
    if (tab === "photo_bodycheck") params.set("type", "photo_bodycheck");

    try {
      const res = await fetch(`/api/posts?${params}`, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setPosts(data.posts);
      } else {
        console.error("Feed load failed:", res.status);
      }
    } catch (e) {
      console.error("Feed load error:", e);
    }
    setLoading(false);
  }, [tab, filterType]);

  const loadRankings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/rankings");
      if (res.ok) {
        setRankings(await res.json());
      }
    } catch (e) {
      console.error("Rankings load error:", e);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      if (tab === "ranking") {
        void loadRankings();
      } else {
        void loadFeed();
      }
    });
  }, [tab, loadFeed, loadRankings]);

  const handleWrite = () => {
    if (!userId) {
      const redirect =
        tab === "photo_bodycheck"
          ? "/community/write?type=photo_bodycheck"
          : "/community/write";
      router.push(`/login?redirect=${encodeURIComponent(redirect)}`);
      return;
    }
    if (tab === "photo_bodycheck") {
      router.push("/community/write?type=photo_bodycheck");
      return;
    }
    router.push("/community/write");
  };

  return (
    <main className="max-w-2xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-neutral-900">커뮤니티</h1>
        <div className="flex items-center gap-2">
          {userId && (
            <Link
              href="/mypage"
              className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl border border-neutral-200 text-neutral-600 hover:bg-neutral-50"
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
          )}
          <button
            type="button"
            onClick={handleWrite}
            className="px-4 min-h-[44px] rounded-xl bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 active:scale-[0.98] transition-all"
          >
            글쓰기
          </button>
        </div>
      </div>

      <div className="sticky top-14 z-40 bg-white/90 backdrop-blur-md -mx-4 px-4 pb-3 pt-1 border-b border-neutral-100">
        <div className="grid grid-cols-2 rounded-xl border border-neutral-300 overflow-hidden">
          {(Object.keys(TAB_LABELS) as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`min-h-[44px] text-sm font-medium transition-colors ${
                tab === t
                  ? "bg-emerald-600 text-white"
                  : "bg-white text-neutral-600 hover:bg-neutral-50"
              }`}
            >
              {TAB_LABELS[t]}
            </button>
          ))}
        </div>
      </div>

      {tab === "records" && (
        <>
          <div className="flex flex-wrap gap-2 my-4">
            {RECORD_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setFilterType(t)}
                className={`px-3 min-h-[36px] rounded-full text-xs font-medium transition-colors ${
                  filterType === t
                    ? "bg-emerald-600 text-white"
                    : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
                }`}
              >
                {t === "all"
                  ? "전체"
                  : `${POST_TYPE_ICONS[t]} ${POST_TYPE_LABELS[t]}`}
              </button>
            ))}
          </div>
          <PostList posts={posts} loading={loading} />
        </>
      )}

      {tab === "photo_bodycheck" && (
        <div className="mt-4 space-y-3">
          <Link
            href="/community/bodycheck"
            className="block rounded-2xl border border-indigo-200 bg-indigo-50 p-4 text-sm text-indigo-700 font-medium"
          >
            이번주 몸짱 랭킹과 사진 몸평 전용 피드는 여기서 확인하세요 →
          </Link>
          <PostList posts={posts} loading={loading} />
        </div>
      )}

      {tab === "free" && (
        <div className="mt-4">
          <PostList posts={posts} loading={loading} />
        </div>
      )}

      {tab === "ranking" && (
        <div className="mt-4">
          {loading ? (
            <p className="text-neutral-400 text-center py-10">로딩 중...</p>
          ) : !rankings ? (
            <p className="text-neutral-400 text-center py-10">
              데이터를 불러오지 못했습니다.
            </p>
          ) : (
            <div className="space-y-8">
              <RankingSection
                title="🏋️ 3대 합계 TOP 10 (7일)"
                items={rankings.lifts}
                bgColor="bg-rose-100"
                textColor="text-rose-700"
                valueKey="totalKg"
                unit="kg"
              />
              <RankingSection
                title="💪 1RM TOP 10 (7일)"
                items={rankings.oneRm}
                bgColor="bg-emerald-100"
                textColor="text-emerald-700"
                valueKey="oneRmKg"
                unit="kg"
                labelKey="lift"
              />
            </div>
          )}
        </div>
      )}
    </main>
  );
}

function PostList({ posts, loading }: { posts: Post[]; loading: boolean }) {
  if (loading) return <p className="text-neutral-400 text-center py-10">로딩 중...</p>;
  if (posts.length === 0) return <p className="text-neutral-400 text-center py-10">아직 글이 없습니다.</p>;

  return (
    <div className="space-y-3">
      {posts.map((post) => {
        const badge = getBadgeFromPayload(post.type, post.payload_json);
        const icon = POST_TYPE_ICONS[post.type];
        const thumbnailCandidates = [...(post.thumb_images ?? []), ...(post.images ?? [])].filter(
          (url): url is string => typeof url === "string" && url.length > 0
        );
        const previewImage = thumbnailCandidates[0] ?? "";
        const hasImages = thumbnailCandidates.length > 0;
        const avg =
          post.type === "photo_bodycheck" ? getBodycheckAverage(post) : null;
        const voteCount = Number(post.vote_count ?? 0);

        return (
          <Link
            key={post.id}
            href={`/community/${post.id}`}
            className="block rounded-2xl bg-white border border-neutral-200 p-4 hover:border-emerald-300 hover:shadow-sm transition-all active:scale-[0.99]"
          >
            <div className="flex gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1.5">
                  <span
                    className={`px-2 py-0.5 rounded-full text-xs font-medium ${POST_TYPE_COLORS[post.type]}`}
                  >
                    {icon} {POST_TYPE_LABELS[post.type]}
                  </span>
                  <span className="text-xs text-neutral-400">
                    {timeAgo(post.created_at)}
                  </span>
                </div>
                <h3 className="font-semibold text-neutral-900 text-sm truncate">
                  {post.title}
                </h3>
                {post.payload_json && post.type !== "free" && (
                  <p className="text-xs text-neutral-500 mt-1 truncate">
                    {renderPayloadSummary(post.type, post.payload_json)}
                  </p>
                )}
                {post.content && post.type === "free" && (
                  <p className="text-xs text-neutral-500 mt-1 line-clamp-2">
                    {post.content}
                  </p>
                )}
                {post.type === "photo_bodycheck" && (
                  <p className="text-xs text-indigo-700 mt-1">
                    평균 {avg?.toFixed(2) ?? "0.00"} / 투표 {voteCount}
                  </p>
                )}
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-xs" title={badge.label}>
                    {badge.emoji}
                  </span>
                  <span className="text-xs text-neutral-500">
                    {post.profiles?.nickname ?? "알 수 없음"}
                  </span>
                  <VerifiedBadge total={post.cert_summary?.total} />
                </div>
              </div>

              {hasImages && (
                <div className="shrink-0 w-16 h-16 rounded-lg overflow-hidden border border-neutral-100">
                  <img
                    src={previewImage}
                    loading="lazy"
                    decoding="async"
                    data-candidates={thumbnailCandidates.join("\n")}
                    data-candidate-index="0"
                    onError={(e) => {
                      const candidates = (e.currentTarget.dataset.candidates ?? "")
                        .split("\n")
                        .filter(Boolean);
                      const currentIdx = Number(e.currentTarget.dataset.candidateIndex ?? "0");
                      const nextIdx = currentIdx + 1;
                      if (nextIdx < candidates.length) {
                        e.currentTarget.dataset.candidateIndex = String(nextIdx);
                        e.currentTarget.src = candidates[nextIdx] as string;
                      }
                    }}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                </div>
              )}
            </div>
          </Link>
        );
      })}
    </div>
  );
}

function RankingSection({
  title,
  items,
  bgColor,
  textColor,
  valueKey,
  unit,
  labelKey,
}: {
  title: string;
  items: {
    id: string;
    payload_json: Record<string, unknown>;
    profiles: { nickname: string } | null;
  }[];
  bgColor: string;
  textColor: string;
  valueKey: string;
  unit: string;
  labelKey?: string;
}) {
  const medals = ["🥇", "🥈", "🥉"];
  return (
    <section>
      <h2 className="text-lg font-bold text-neutral-800 mb-3">{title}</h2>
      {items.length === 0 ? (
        <p className="text-sm text-neutral-400">아직 기록이 없습니다.</p>
      ) : (
        <div className="space-y-2">
          {items.map((item, i) => {
            const pj = item.payload_json as Record<string, unknown>;
            return (
              <Link
                key={item.id}
                href={`/community/${item.id}`}
                className="flex items-center gap-3 rounded-xl bg-white border border-neutral-200 p-3 min-h-[52px] hover:border-neutral-300 active:scale-[0.99] transition-all"
              >
                <span
                  className={`w-8 h-8 flex items-center justify-center rounded-full ${bgColor} ${textColor} text-sm font-bold shrink-0`}
                >
                  {i < 3 ? medals[i] : i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-neutral-900 truncate">
                    {item.profiles?.nickname ?? "?"}
                  </p>
                  <p className="text-xs text-neutral-500">
                    {labelKey ? `${String(pj[labelKey] ?? "")} ` : ""}
                    {String(pj[valueKey] ?? 0)}
                    {unit}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
