"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import {
  POST_TYPE_LABELS,
  POST_TYPE_COLORS,
  POST_TYPE_ICONS,
  renderPayloadSummary,
  getBadgeFromPayload,
  timeAgo,
  type Post,
} from "@/lib/community";

type Tab = "records" | "posts" | "bodycheck" | "deleted";

interface DeletedLog {
  id: string;
  post_id: string;
  title_snapshot: string;
  content_snapshot: string | null;
  payload_snapshot: Record<string, unknown> | null;
  deleted_at: string;
}

interface BodycheckPost {
  id: string;
  title: string;
  content: string | null;
  images: string[] | null;
  created_at: string;
  gender: "male" | "female";
  score_sum: number;
  vote_count: number;
  average_score: number;
  weekly_rank: number | null;
}

const TAB_CONFIG: { key: Tab; label: string; icon: string }[] = [
  { key: "records", label: "내 기록", icon: "🏋️" },
  { key: "posts", label: "내 글", icon: "💬" },
  { key: "bodycheck", label: "내 몸평", icon: "📸" },
  { key: "deleted", label: "삭제 글", icon: "🗑️" },
];

export default function MyPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("records");
  const [nickname, setNickname] = useState("");
  const [loading, setLoading] = useState(true);
  const [authChecked, setAuthChecked] = useState(false);

  const [records, setRecords] = useState<Post[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [bodychecks, setBodychecks] = useState<BodycheckPost[]>([]);
  const [deletedLogs, setDeletedLogs] = useState<DeletedLog[]>([]);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) {
        router.replace("/login?redirect=/mypage");
        return;
      }
      const { data: profile } = await supabase
        .from("profiles")
        .select("nickname")
        .eq("user_id", user.id)
        .single();
      setNickname(profile?.nickname ?? "사용자");
      setAuthChecked(true);
    });
  }, [router]);

  const loadRecords = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/mypage/records");
      if (res.ok) {
        const data = await res.json();
        setRecords(data.posts);
      }
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  }, []);

  const loadPosts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/mypage/posts");
      if (res.ok) {
        const data = await res.json();
        setPosts(data.posts);
      }
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  }, []);

  const loadBodycheckPosts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/mypage/bodycheck");
      if (res.ok) {
        const data = await res.json();
        setBodychecks(data.posts ?? []);
      }
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  }, []);

  const loadDeleted = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/mypage/deleted");
      if (res.ok) {
        const data = await res.json();
        setDeletedLogs(data.logs);
      }
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!authChecked) return;
    if (tab === "records") loadRecords();
    else if (tab === "posts") loadPosts();
    else if (tab === "bodycheck") loadBodycheckPosts();
    else loadDeleted();
  }, [tab, authChecked, loadRecords, loadPosts, loadBodycheckPosts, loadDeleted]);

  if (!authChecked) {
    return (
      <main className="max-w-2xl mx-auto px-4 py-10">
        <p className="text-neutral-400 text-center">로딩 중...</p>
      </main>
    );
  }

  return (
    <main className="max-w-2xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">마이페이지</h1>
          <p className="text-sm text-neutral-500 mt-0.5">{nickname}</p>
        </div>
        <Link
          href="/community"
          className="px-4 min-h-[44px] rounded-xl border border-neutral-200 text-neutral-600 text-sm font-medium hover:bg-neutral-50 flex items-center"
        >
          커뮤니티
        </Link>
      </div>

      <div className="sticky top-14 z-40 bg-white/90 backdrop-blur-md -mx-4 px-4 pb-3 pt-1 border-b border-neutral-100">
        <div className="grid grid-cols-2 rounded-xl border border-neutral-300 overflow-hidden">
          {TAB_CONFIG.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`min-h-[44px] text-sm font-medium transition-colors flex items-center justify-center gap-1 ${
                tab === t.key
                  ? "bg-emerald-600 text-white"
                  : "bg-white text-neutral-600 hover:bg-neutral-50"
              }`}
            >
              <span className="text-xs">{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4">
        {loading ? (
          <p className="text-neutral-400 text-center py-10">로딩 중...</p>
        ) : tab === "records" ? (
          <RecordsList items={records} />
        ) : tab === "posts" ? (
          <PostsList items={posts} />
        ) : tab === "bodycheck" ? (
          <BodycheckList items={bodychecks} />
        ) : (
          <DeletedList items={deletedLogs} />
        )}
      </div>
    </main>
  );
}

function RecordsList({ items }: { items: Post[] }) {
  if (items.length === 0)
    return <p className="text-neutral-400 text-center py-10">공유한 기록이 없습니다.</p>;

  return (
    <div className="space-y-3">
      {items.map((post) => {
        const icon = POST_TYPE_ICONS[post.type];
        const badge = getBadgeFromPayload(post.type, post.payload_json);

        return (
          <Link
            key={post.id}
            href={`/community/${post.id}`}
            className="block rounded-2xl bg-white border border-neutral-200 p-4 hover:border-emerald-300 transition-all active:scale-[0.99]"
          >
            <div className="flex items-center gap-2 mb-1.5">
              <span
                className={`px-2 py-0.5 rounded-full text-xs font-medium ${POST_TYPE_COLORS[post.type]}`}
              >
                {icon} {POST_TYPE_LABELS[post.type]}
              </span>
              <span className="text-xs text-neutral-400">
                {timeAgo(post.created_at)}
              </span>
              <span className="ml-auto text-sm" title={badge.label}>
                {badge.emoji}
              </span>
            </div>
            <h3 className="font-semibold text-neutral-900 text-sm truncate">
              {post.title}
            </h3>
            {post.payload_json && (
              <p className="text-xs text-neutral-500 mt-1">
                {renderPayloadSummary(post.type, post.payload_json)}
              </p>
            )}
          </Link>
        );
      })}
    </div>
  );
}

function PostsList({ items }: { items: Post[] }) {
  if (items.length === 0)
    return <p className="text-neutral-400 text-center py-10">작성한 글이 없습니다.</p>;

  return (
    <div className="space-y-3">
      {items.map((post) => (
        <Link
          key={post.id}
          href={`/community/${post.id}`}
          className="block rounded-2xl bg-white border border-neutral-200 p-4 hover:border-emerald-300 transition-all active:scale-[0.99]"
        >
          <div className="flex gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1.5">
                <span
                  className={`px-2 py-0.5 rounded-full text-xs font-medium ${POST_TYPE_COLORS[post.type]}`}
                >
                  {POST_TYPE_ICONS[post.type]} {POST_TYPE_LABELS[post.type]}
                </span>
                <span className="text-xs text-neutral-400">
                  {timeAgo(post.created_at)}
                </span>
              </div>
              <h3 className="font-semibold text-neutral-900 text-sm truncate">
                {post.title}
              </h3>
              {post.content && (
                <p className="text-xs text-neutral-500 mt-1 line-clamp-2">
                  {post.content}
                </p>
              )}
            </div>
            {(post.images?.length ?? 0) > 0 && (
              <img
                src={post.images?.[0]}
                alt=""
                className="shrink-0 w-16 h-16 rounded-lg object-cover border border-neutral-100"
              />
            )}
          </div>
        </Link>
      ))}
    </div>
  );
}

function BodycheckList({ items }: { items: BodycheckPost[] }) {
  if (items.length === 0) {
    return (
      <p className="text-neutral-400 text-center py-10">
        내가 올린 몸평 게시글이 없습니다.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((post) => (
        <Link
          key={post.id}
          href={`/community/${post.id}`}
          className="block rounded-2xl bg-white border border-neutral-200 p-4 hover:border-indigo-300 transition-all active:scale-[0.99]"
        >
          <div className="flex gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700">
                  사진 몸평 · {post.gender === "female" ? "여성" : "남성"}
                </span>
                <span className="text-xs text-neutral-400">
                  {timeAgo(post.created_at)}
                </span>
              </div>
              <h3 className="font-semibold text-neutral-900 text-sm truncate">
                {post.title}
              </h3>
              {post.content && (
                <p className="text-xs text-neutral-500 mt-1 line-clamp-2">
                  {post.content}
                </p>
              )}
              <p className="text-xs text-indigo-700 mt-1">
                평균 {post.average_score.toFixed(2)} / 투표 {post.vote_count}
              </p>
              <p className="text-xs text-neutral-500 mt-1">
                현재 주간 등수: {post.weekly_rank ? `${post.weekly_rank}위` : "집계 외"}
              </p>
            </div>
            {(post.images?.length ?? 0) > 0 && (
              <img
                src={post.images?.[0]}
                alt=""
                className="shrink-0 w-16 h-16 rounded-lg object-cover border border-neutral-100"
              />
            )}
          </div>
        </Link>
      ))}
    </div>
  );
}

function DeletedList({ items }: { items: DeletedLog[] }) {
  if (items.length === 0)
    return <p className="text-neutral-400 text-center py-10">삭제한 글이 없습니다.</p>;

  return (
    <div className="space-y-3">
      {items.map((log) => (
        <div
          key={log.id}
          className="rounded-2xl bg-neutral-50 border border-neutral-200 p-4"
        >
          <div className="flex items-center gap-2 mb-1.5">
            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
              삭제됨
            </span>
            <span className="text-xs text-neutral-400">
              {timeAgo(log.deleted_at)}
            </span>
          </div>
          <h3 className="font-semibold text-neutral-700 text-sm">
            {log.title_snapshot}
          </h3>
          {log.content_snapshot && (
            <p className="text-xs text-neutral-500 mt-1 line-clamp-3">
              {log.content_snapshot}
            </p>
          )}
          {log.payload_snapshot && (
            <p className="text-xs text-neutral-400 mt-1">
              기록 데이터 보존됨
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
