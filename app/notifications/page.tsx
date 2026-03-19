"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type NotificationItem = {
  id: string;
  actor_id: string | null;
  type: string;
  post_id: string | null;
  is_read: boolean;
  created_at: string;
  actor_profile: { nickname: string | null } | null;
  title?: string | null;
  body?: string | null;
  link?: string | null;
};

export default function NotificationsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [markingAll, setMarkingAll] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/notifications?limit=50", { cache: "no-store" });
      if (!res.ok) {
        setItems([]);
        setUnreadCount(0);
        return;
      }

      const data = (await res.json().catch(() => ({}))) as {
        items?: NotificationItem[];
        unread_count?: number;
      };

      setItems(Array.isArray(data.items) ? data.items : []);
      setUnreadCount(Number(data.unread_count ?? 0));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const markAllRead = async () => {
    if (markingAll) return;
    setMarkingAll(true);
    try {
      const res = await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mark_all: true }),
      });

      if (!res.ok) {
        alert("알림 읽음 처리에 실패했습니다.");
        return;
      }

      setItems((prev) => prev.map((item) => ({ ...item, is_read: true })));
      setUnreadCount(0);
    } finally {
      setMarkingAll(false);
    }
  };

  const markReadAndGo = async (item: NotificationItem) => {
    if (activeId === item.id) return;
    setActiveId(item.id);

    try {
      if (!item.is_read) {
        const res = await fetch("/api/notifications", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: item.id }),
        });

        if (!res.ok) {
          alert("알림 읽음 처리에 실패했습니다.");
          return;
        }

        setItems((prev) =>
          prev.map((current) => (current.id === item.id ? { ...current, is_read: true } : current))
        );
        setUnreadCount((prev) => Math.max(0, prev - 1));
      }

      if (item.link) {
        router.push(item.link);
        router.refresh();
      }
    } finally {
      setActiveId(null);
    }
  };

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">알림</h1>
          <p className="text-sm text-neutral-500">읽지 않은 알림 {unreadCount}개</p>
        </div>
        <button
          type="button"
          onClick={() => void markAllRead()}
          disabled={markingAll || unreadCount === 0}
          className="min-h-[40px] rounded-lg border border-neutral-300 px-3 text-sm text-neutral-700 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {markingAll ? "처리 중..." : "모두 읽음"}
        </button>
      </div>

      <Link href="/" className="text-sm text-neutral-500 hover:text-neutral-700">
        홈으로
      </Link>

      <section className="mt-4 space-y-2">
        {loading ? (
          <p className="py-8 text-center text-neutral-400">불러오는 중...</p>
        ) : items.length === 0 ? (
          <p className="py-8 text-center text-neutral-400">새 알림이 없습니다.</p>
        ) : (
          items.map((item) => {
            const actorLabel = item.actor_profile?.nickname ?? "알림";
            const title = (item.title ?? "").trim() || actorLabel;
            const body = (item.body ?? "").trim();
            const busy = activeId === item.id;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => void markReadAndGo(item)}
                disabled={busy}
                className={`w-full rounded-xl border p-4 text-left transition ${
                  item.is_read ? "border-neutral-200 bg-white" : "border-emerald-200 bg-emerald-50"
                } ${busy ? "opacity-70" : "hover:border-emerald-300 hover:bg-emerald-50/80"}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-neutral-900">{title}</p>
                    {body ? <p className="mt-1 text-sm text-neutral-700">{body}</p> : null}
                    <p className="mt-2 text-xs text-neutral-500">
                      {new Date(item.created_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}
                    </p>
                  </div>
                  {item.link ? (
                    <span className="shrink-0 text-xs font-medium text-emerald-700">바로가기</span>
                  ) : null}
                </div>
              </button>
            );
          })
        )}
      </section>
    </main>
  );
}
