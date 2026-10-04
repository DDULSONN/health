"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createLatestRequest } from "@/lib/latest-request";
import { fetchClientJson } from "@/lib/client-json-request";
import { notificationHref, parseNotificationPage, type NotificationItem } from "@/lib/notification-view";
import { invalidateNotificationCount, publishNotificationCount } from "@/lib/notification-count";

export default function NotificationsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState<number | null>(null);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [markingAll, setMarkingAll] = useState(false);
  const [readingIds, setReadingIds] = useState<string[]>([]);
  const mounted = useRef(false);
  const reading = useRef(new Set<string>());
  const acknowledged = useRef(new Set<string>());
  const markingAllRef = useRef(false);
  const request = useMemo(() => createLatestRequest(), []);

  const load = useCallback(() => {
    if (markingAllRef.current || reading.current.size) return Promise.resolve();
    return request.run({
      start: () => { setLoading(true); setLoadError(""); },
      load: async (signal) => {
        const { response, body } = await fetchClientJson<unknown>("/api/notifications?limit=50", { cache: "no-store", signal });
        if (!response.ok) throw new Error(response.status === 401
          ? "로그인 상태를 확인하지 못했어요. 다시 로그인한 뒤 확인해 주세요."
          : "알림을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.");
        const data = parseNotificationPage(body);
        if (!data) throw new Error("알림 응답을 확인하지 못했어요. 다시 시도해 주세요.");
        return data;
      },
      commit: (data) => {
        setItems(data.items); setUnreadCount(data.unread_count);
        publishNotificationCount(data.unread_count);
        acknowledged.current = new Set(data.items.filter((item) => item.is_read).map((item) => item.id));
      },
      fail: (error) => setLoadError(error instanceof Error && error.name !== "AbortError" && !(error instanceof TypeError)
        ? error.message : "알림을 불러오지 못했어요. 인터넷 연결을 확인한 뒤 다시 시도해 주세요."),
      finish: () => setLoading(false),
    });
  }, [request]);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => { mounted.current = false; request.cancel(); };
  }, [load, request]);

  const markAllRead = async () => {
    if (markingAllRef.current || reading.current.size || !unreadCount) return;
    markingAllRef.current = true; setMarkingAll(true); setActionError("");
    // A pending GET must not later restore the pre-click unread state.
    request.cancel(); setLoading(false);
    try {
      const { response, body } = await fetchClientJson<{ ok?: boolean }>("/api/notifications", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mark_all: true }),
      });
      if (!response.ok || body?.ok !== true) throw new Error("READ_FAILED");
      invalidateNotificationCount();
      if (!mounted.current) return;
      request.cancel(); setLoading(false);
      items.forEach((item) => acknowledged.current.add(item.id));
      setItems((prev) => prev.map((item) => ({ ...item, is_read: true })));
      setUnreadCount(0);
    } catch {
      if (mounted.current) setActionError("읽음 처리 결과를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      markingAllRef.current = false;
      if (mounted.current) setMarkingAll(false);
    }
  };

  const markOneRead = async (item: NotificationItem) => {
    if (item.is_read || acknowledged.current.has(item.id) || reading.current.has(item.id) || markingAllRef.current) return;
    reading.current.add(item.id); setReadingIds([...reading.current]); setActionError("");
    request.cancel(); setLoading(false);
    try {
      const { response, body } = await fetchClientJson<{ ok?: boolean }>("/api/notifications", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, keepalive: true,
        body: JSON.stringify({ id: item.id }),
      });
      if (!response.ok || body?.ok !== true) throw new Error("READ_FAILED");
      invalidateNotificationCount();
      if (!mounted.current) return;
      request.cancel(); setLoading(false);
      if (!acknowledged.current.has(item.id)) {
        acknowledged.current.add(item.id);
        setItems((prev) => prev.map((current) => current.id === item.id ? { ...current, is_read: true } : current));
        setUnreadCount((prev) => prev === null ? null : Math.max(0, prev - 1));
      }
    } catch {
      if (mounted.current) setActionError("읽음 처리 결과를 확인하지 못했어요. 알림 내용은 계속 확인할 수 있어요.");
    } finally {
      reading.current.delete(item.id);
      if (mounted.current) setReadingIds([...reading.current]);
    }
  };

  const markReadAndGo = (item: NotificationItem) => {
    // Navigation never waits for read acknowledgement, and a late reply never navigates.
    void markOneRead(item);
    const href = notificationHref(item.link);
    if (href) router.push(href);
  };

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">알림</h1>
          <p className="text-sm text-neutral-500">{unreadCount === null ? loadError ? "알림 수 확인 불가" : "알림 수 확인 중" : `읽지 않은 알림 ${unreadCount}개`}</p>
        </div>
        <button
          type="button"
          onClick={() => void markAllRead()}
          disabled={markingAll || readingIds.length > 0 || !unreadCount || loading}
          className="min-h-[40px] rounded-lg border border-neutral-300 px-3 text-sm text-neutral-700 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {markingAll ? "처리 중..." : "모두 읽음"}
        </button>
      </div>

      <div className="flex items-center justify-between gap-3">
        <Link href="/" className="text-sm text-neutral-500 hover:text-neutral-700">홈으로</Link>
        <button type="button" disabled={loading || markingAll || readingIds.length > 0} onClick={() => void load()} className="min-h-10 rounded-lg border border-neutral-200 px-3 text-sm text-neutral-600 disabled:opacity-50">새로고침</button>
      </div>

      {loadError ? (
        <div role="alert" className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          <p>{loadError}</p>
          {items.length > 0 && <p className="mt-1 text-xs">아래는 마지막으로 불러온 알림입니다.</p>}
          <button type="button" disabled={loading || markingAll || readingIds.length > 0} onClick={() => void load()} className="mt-3 min-h-10 rounded-lg border border-rose-200 bg-white px-3 font-semibold disabled:opacity-50">다시 시도</button>
        </div>
      ) : null}
      {actionError ? <p role="alert" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{actionError}</p> : null}
      <section className="mt-4 space-y-2">
        {loading ? (
          <p className="py-8 text-center text-neutral-400">불러오는 중...</p>
        ) : !loadError && items.length === 0 ? (
          <p className="py-8 text-center text-neutral-400">새 알림이 없습니다.</p>
        ) : (
          items.map((item) => {
            const actorLabel = item.actor_profile?.nickname ?? "알림";
            const title = (item.title ?? "").trim() || actorLabel;
            const body = (item.body ?? "").trim();
            const busy = readingIds.includes(item.id);

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
                  {notificationHref(item.link) ? (
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
