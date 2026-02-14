"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type NotificationItem = {
  id: string;
  actor_id: string | null;
  type: "comment";
  post_id: string;
  is_read: boolean;
  created_at: string;
  actor_profile: { nickname: string | null } | null;
};

export default function NotificationsPage() {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/notifications?limit=50", { cache: "no-store" });
      if (!res.ok) {
        setItems([]);
        setUnreadCount(0);
        return;
      }
      const data = await res.json();
      setItems(data.items ?? []);
      setUnreadCount(Number(data.unread_count ?? 0));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const markAllRead = async () => {
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mark_all: true }),
    });
    load();
  };

  const markReadAndGo = async (id: string, postId: string) => {
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    window.location.href = `/community/${postId}`;
  };

  return (
    <main className="max-w-2xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">알림</h1>
          <p className="text-sm text-neutral-500">읽지 않음 {unreadCount}개</p>
        </div>
        <button
          type="button"
          onClick={markAllRead}
          className="min-h-[40px] px-3 rounded-lg border border-neutral-300 text-sm text-neutral-700 hover:bg-neutral-50"
        >
          모두 읽음
        </button>
      </div>

      <Link href="/" className="text-sm text-neutral-500 hover:text-neutral-700">
        ← 홈으로
      </Link>

      <section className="mt-4 space-y-2">
        {loading ? (
          <p className="text-neutral-400 py-8 text-center">불러오는 중...</p>
        ) : items.length === 0 ? (
          <p className="text-neutral-400 py-8 text-center">알림이 없습니다.</p>
        ) : (
          items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => markReadAndGo(item.id, item.post_id)}
              className={`w-full text-left rounded-xl border p-3 transition ${
                item.is_read
                  ? "border-neutral-200 bg-white"
                  : "border-emerald-200 bg-emerald-50"
              }`}
            >
              <p className="text-sm text-neutral-800">
                {(item.actor_profile?.nickname ?? "누군가")}님이 내 글에 댓글을 달았어요
              </p>
              <p className="text-xs text-neutral-500 mt-1">
                {new Date(item.created_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}
              </p>
            </button>
          ))
        )}
      </section>
    </main>
  );
}
