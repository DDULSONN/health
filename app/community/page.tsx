"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  POST_TYPE_LABELS,
  POST_TYPE_COLORS,
  renderPayloadSummary,
  timeAgo,
  type Post,
  type PostType,
} from "@/lib/community";

type Tab = "feed" | "ranking";
type RankingData = {
  lifts: { id: string; payload_json: Record<string, unknown>; profiles: { nickname: string } | null }[];
  oneRm: { id: string; payload_json: Record<string, unknown>; profiles: { nickname: string } | null }[];
};

const FEED_TYPES: (PostType | "all")[] = ["all", "1rm", "lifts", "helltest", "bodycheck", "free"];

export default function CommunityPage() {
  const [tab, setTab] = useState<Tab>("feed");
  const [posts, setPosts] = useState<Post[]>([]);
  const [filterType, setFilterType] = useState<PostType | "all">("all");
  const [loading, setLoading] = useState(true);
  const [rankings, setRankings] = useState<RankingData | null>(null);

  const loadFeed = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filterType !== "all") params.set("type", filterType);
    const res = await fetch(`/api/posts?${params}`);
    if (res.ok) {
      const data = await res.json();
      setPosts(data.posts);
    }
    setLoading(false);
  }, [filterType]);

  const loadRankings = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/rankings");
    if (res.ok) {
      setRankings(await res.json());
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (tab === "feed") loadFeed();
    else loadRankings();
  }, [tab, loadFeed, loadRankings]);

  return (
    <main className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-neutral-900 mb-4">커뮤니티</h1>

      {/* 탭 */}
      <div className="flex rounded-xl border border-neutral-300 overflow-hidden mb-5">
        {(["feed", "ranking"] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`flex-1 h-11 text-sm font-medium transition-colors ${
              tab === t ? "bg-emerald-600 text-white" : "bg-white text-neutral-600 hover:bg-neutral-50"
            }`}
          >
            {t === "feed" ? "기록 피드" : "랭킹"}
          </button>
        ))}
      </div>

      {/* Feed */}
      {tab === "feed" && (
        <>
          {/* 타입 필터 */}
          <div className="flex flex-wrap gap-2 mb-4">
            {FEED_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setFilterType(t)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  filterType === t
                    ? "bg-emerald-600 text-white"
                    : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
                }`}
              >
                {t === "all" ? "전체" : POST_TYPE_LABELS[t]}
              </button>
            ))}
          </div>

          {loading ? (
            <p className="text-neutral-400 text-center py-10">로딩 중...</p>
          ) : posts.length === 0 ? (
            <p className="text-neutral-400 text-center py-10">아직 기록이 없습니다.</p>
          ) : (
            <div className="space-y-3">
              {posts.map((post) => (
                <Link
                  key={post.id}
                  href={`/community/${post.id}`}
                  className="block rounded-2xl bg-white border border-neutral-200 p-4 hover:border-neutral-300 transition-colors"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${POST_TYPE_COLORS[post.type]}`}>
                      {POST_TYPE_LABELS[post.type]}
                    </span>
                    <span className="text-xs text-neutral-400">{timeAgo(post.created_at)}</span>
                  </div>
                  <h3 className="font-semibold text-neutral-900 text-sm">{post.title}</h3>
                  {post.payload_json && (
                    <p className="text-xs text-neutral-500 mt-1">
                      {renderPayloadSummary(post.type, post.payload_json)}
                    </p>
                  )}
                  <p className="text-xs text-neutral-400 mt-2">
                    {post.profiles?.nickname ?? "알 수 없음"}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </>
      )}

      {/* Rankings */}
      {tab === "ranking" && (
        <>
          {loading ? (
            <p className="text-neutral-400 text-center py-10">로딩 중...</p>
          ) : !rankings ? (
            <p className="text-neutral-400 text-center py-10">데이터를 불러올 수 없습니다.</p>
          ) : (
            <div className="space-y-8">
              {/* 3대 합계 */}
              <section>
                <h2 className="text-lg font-bold text-neutral-800 mb-3">3대 합계 TOP 10 (7일)</h2>
                {rankings.lifts.length === 0 ? (
                  <p className="text-sm text-neutral-400">아직 기록이 없습니다.</p>
                ) : (
                  <div className="space-y-2">
                    {rankings.lifts.map((item, i) => {
                      const pj = item.payload_json as Record<string, number>;
                      return (
                        <Link
                          key={item.id}
                          href={`/community/${item.id}`}
                          className="flex items-center gap-3 rounded-xl bg-white border border-neutral-200 p-3 hover:border-neutral-300"
                        >
                          <span className="w-8 h-8 flex items-center justify-center rounded-full bg-rose-100 text-rose-700 text-sm font-bold shrink-0">
                            {i + 1}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-neutral-900 truncate">
                              {item.profiles?.nickname ?? "?"}
                            </p>
                            <p className="text-xs text-neutral-500">{pj.totalKg ?? 0}kg</p>
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* 1RM */}
              <section>
                <h2 className="text-lg font-bold text-neutral-800 mb-3">1RM TOP 10 (7일)</h2>
                {rankings.oneRm.length === 0 ? (
                  <p className="text-sm text-neutral-400">아직 기록이 없습니다.</p>
                ) : (
                  <div className="space-y-2">
                    {rankings.oneRm.map((item, i) => {
                      const pj = item.payload_json as Record<string, unknown>;
                      return (
                        <Link
                          key={item.id}
                          href={`/community/${item.id}`}
                          className="flex items-center gap-3 rounded-xl bg-white border border-neutral-200 p-3 hover:border-neutral-300"
                        >
                          <span className="w-8 h-8 flex items-center justify-center rounded-full bg-emerald-100 text-emerald-700 text-sm font-bold shrink-0">
                            {i + 1}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-neutral-900 truncate">
                              {item.profiles?.nickname ?? "?"}
                            </p>
                            <p className="text-xs text-neutral-500">
                              {String(pj.lift ?? "")} {String(pj.oneRmKg ?? 0)}kg
                            </p>
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </section>
            </div>
          )}
        </>
      )}
    </main>
  );
}
