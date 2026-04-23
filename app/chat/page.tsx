"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DATING_CHAT_REPORT_REASONS } from "@/lib/dating-chat-report-reasons";
import { createClient } from "@/lib/supabase/client";

type ChatSourceKind = "open" | "paid" | "swipe";

type InboxItem = {
  thread_id: string;
  source_kind: ChatSourceKind;
  source_id: string;
  peer_user_id: string;
  peer_nickname: string;
  status: "open" | "closed";
  unread_count: number;
  last_message: string;
  last_message_at: string;
  created_at: string;
};

type AvailableItem = {
  sourceKind: ChatSourceKind;
  sourceId: string;
  peerUserId: string;
  peerNickname: string;
  title: string;
  createdAt: string;
  thread_id?: string | null;
};

type ThreadDetail = {
  thread: {
    id: string;
    source_kind: ChatSourceKind;
    source_id: string;
    current_user_id: string;
    user_a_id: string;
    user_b_id: string;
    user_a_nickname: string;
    user_b_nickname: string;
    status: "open" | "closed";
    created_at: string;
  };
  messages: Array<{
    id: string;
    thread_id: string;
    sender_id: string;
    receiver_id: string;
    content: string;
    is_read: boolean;
    created_at: string;
  }>;
};

type ChatMessage = ThreadDetail["messages"][number];

type SelectedState =
  | { kind: "thread"; threadId: string }
  | {
      kind: "available";
      sourceKind: AvailableItem["sourceKind"];
      sourceId: string;
      peerNickname: string;
      title: string;
      threadId?: string | null;
    }
  | null;

function formatDateTime(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function avatarTone(seed: string) {
  const tones = [
    "border-violet-200 bg-violet-50 text-violet-500",
    "border-rose-200 bg-rose-50 text-rose-500",
    "border-sky-200 bg-sky-50 text-sky-500",
    "border-emerald-200 bg-emerald-50 text-emerald-500",
    "border-amber-200 bg-amber-50 text-amber-500",
  ];
  const sum = seed.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return tones[sum % tones.length];
}

export default function ChatPage() {
  const supabase = useMemo(() => createClient(), []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [available, setAvailable] = useState<AvailableItem[]>([]);
  const [selected, setSelected] = useState<SelectedState>(null);
  const [threadDetail, setThreadDetail] = useState<ThreadDetail | null>(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const [compose, setCompose] = useState("");
  const [sending, setSending] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reportPanelOpen, setReportPanelOpen] = useState(false);
  const [reportReason, setReportReason] = useState<(typeof DATING_CHAT_REPORT_REASONS)[number]>(
    DATING_CHAT_REPORT_REASONS[0]
  );
  const [reportDetails, setReportDetails] = useState("");

  const loadInboxAndAvailable = useCallback(
    async (options?: { withLoading?: boolean }) => {
      const withLoading = options?.withLoading ?? false;
      if (withLoading) {
        setLoading(true);
        setError("");
      }
      try {
        const [inboxRes, availableRes] = await Promise.all([
          fetch("/api/dating/chat/inbox", { cache: "no-store" }),
          fetch("/api/dating/chat/available", { cache: "no-store" }),
        ]);

        const inboxBody = (await inboxRes.json().catch(() => ({}))) as { items?: InboxItem[]; message?: string };
        const availableBody = (await availableRes.json().catch(() => ({}))) as {
          items?: AvailableItem[];
          message?: string;
        };

        if (!inboxRes.ok) {
          throw new Error(inboxBody.message ?? "채팅 목록을 불러오지 못했습니다.");
        }
        if (!availableRes.ok) {
          throw new Error(availableBody.message ?? "채팅 가능한 연결을 불러오지 못했습니다.");
        }

        const inboxItems = inboxBody.items ?? [];
        const availableItems = availableBody.items ?? [];

        setInbox(inboxItems);
        setAvailable(availableItems);
        setSelected((prev) => {
          if (prev?.kind === "thread") {
            return inboxItems.some((item) => item.thread_id === prev.threadId) ? prev : null;
          }
          if (prev?.kind === "available") {
            return availableItems.some(
              (item) => item.sourceKind === prev.sourceKind && item.sourceId === prev.sourceId
            )
              ? prev
              : null;
          }
          if (inboxItems.length > 0) {
            return { kind: "thread", threadId: inboxItems[0].thread_id };
          }
          if (availableItems.length > 0) {
            return {
              kind: "available",
              sourceKind: availableItems[0].sourceKind,
              sourceId: availableItems[0].sourceId,
              peerNickname: availableItems[0].peerNickname,
              title: availableItems[0].title,
              threadId: availableItems[0].thread_id ?? null,
            };
          }
          return null;
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "채팅을 불러오지 못했습니다.");
      } finally {
        if (withLoading) {
          setLoading(false);
        }
      }
    },
    []
  );

  const syncThreadSilently = useCallback(async (threadId: string) => {
    const res = await fetch(`/api/dating/chat/thread?thread_id=${encodeURIComponent(threadId)}`, {
      cache: "no-store",
    });
    const body = (await res.json().catch(() => ({}))) as ThreadDetail & { message?: string };

    if (!res.ok) {
      throw new Error(body.message ?? "채팅 내용을 불러오지 못했습니다.");
    }

    const latestMessage = body.messages[body.messages.length - 1] ?? null;

    setThreadDetail((prev) => {
      if (!prev || prev.thread.id !== threadId) return body;
      const prevLastId = prev.messages[prev.messages.length - 1]?.id ?? "";
      const nextLastId = body.messages[body.messages.length - 1]?.id ?? "";
      const prevCount = prev.messages.length;
      const nextCount = body.messages.length;
      if (prevLastId === nextLastId && prevCount === nextCount) {
        return prev;
      }
      return body;
    });

    if (latestMessage) {
      setInbox((prev) => {
        const current = prev.find((item) => item.thread_id === threadId);
        if (!current) return prev;
        const updated: InboxItem = {
          ...current,
          last_message: latestMessage.content,
          last_message_at: latestMessage.created_at,
          unread_count: 0,
        };
        const rest = prev.filter((item) => item.thread_id !== threadId);
        return [updated, ...rest];
      });
    }

    await fetch("/api/dating/chat/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ thread_id: threadId }),
    });

    setInbox((prev) =>
      prev.map((item) => (item.thread_id === threadId ? { ...item, unread_count: 0 } : item))
    );
  }, []);

  useEffect(() => {
    let active = true;

    void supabase.auth.getUser().then(({ data }) => {
      if (!active) return;
      setCurrentUserId(data.user?.id ?? null);
    });

    return () => {
      active = false;
    };
  }, [supabase]);

  useEffect(() => {
    void loadInboxAndAvailable({ withLoading: true });
  }, [loadInboxAndAvailable]);

  useEffect(() => {
    if (!selected || selected.kind !== "thread") {
      setThreadDetail(null);
      setReportPanelOpen(false);
      return;
    }

    let cancelled = false;

    const run = async () => {
      setThreadLoading(true);
      try {
        if (!cancelled) {
          await syncThreadSilently(selected.threadId);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "채팅 내용을 불러오지 못했습니다.");
        }
      } finally {
        if (!cancelled) {
          setThreadLoading(false);
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [selected, syncThreadSilently]);

  useEffect(() => {
    if (!selected || selected.kind !== "thread") return;

    const threadId = selected.threadId;
    const channel = supabase
      .channel(`dating-chat-thread:${threadId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "dating_chat_messages",
          filter: `thread_id=eq.${threadId}`,
        },
        async (payload) => {
          const newMessage = payload.new as ChatMessage;

          setThreadDetail((prev) => {
            if (!prev || prev.thread.id !== threadId) return prev;
            if (prev.messages.some((message) => message.id === newMessage.id)) return prev;
            return {
              ...prev,
              messages: [...prev.messages, newMessage],
            };
          });

          setInbox((prev) => {
            const current = prev.find((item) => item.thread_id === threadId);
            if (!current) return prev;
            const shouldCountUnread = !!currentUserId && newMessage.receiver_id === currentUserId;
            const updated: InboxItem = {
              ...current,
              last_message: newMessage.content,
              last_message_at: newMessage.created_at,
              unread_count: shouldCountUnread ? current.unread_count + 1 : current.unread_count,
            };
            const rest = prev.filter((item) => item.thread_id !== threadId);
            return [updated, ...rest];
          });

          if (currentUserId && newMessage.receiver_id === currentUserId && document.visibilityState === "visible") {
            await fetch("/api/dating/chat/read", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ thread_id: threadId }),
            });
            setInbox((prev) =>
              prev.map((item) => (item.thread_id === threadId ? { ...item, unread_count: 0 } : item))
            );
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "dating_chat_threads",
          filter: `id=eq.${threadId}`,
        },
        (payload) => {
          const nextThread = payload.new as { status?: "open" | "closed" };
          const nextStatus = nextThread.status;
          if (!nextStatus) return;
          setThreadDetail((prev) => {
            if (!prev || prev.thread.id !== threadId) return prev;
            return {
              ...prev,
              thread: {
                ...prev.thread,
                status: nextStatus,
              },
            };
          });
          setInbox((prev) =>
            prev.map((item) => (item.thread_id === threadId ? { ...item, status: nextStatus } : item))
          );
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [selected, supabase, currentUserId]);

  useEffect(() => {
    if (!currentUserId) return;

    const channel = supabase
      .channel(`dating-chat-incoming:${currentUserId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "dating_chat_messages",
          filter: `receiver_id=eq.${currentUserId}`,
        },
        async (payload) => {
          const newMessage = payload.new as ChatMessage;

          setInbox((prev) => {
            const current = prev.find((item) => item.thread_id === newMessage.thread_id);
            if (!current) return prev;
            const isOpenThread = selected?.kind === "thread" && selected.threadId === newMessage.thread_id;
            const updated: InboxItem = {
              ...current,
              last_message: newMessage.content,
              last_message_at: newMessage.created_at,
              unread_count: isOpenThread && document.visibilityState === "visible" ? 0 : current.unread_count + 1,
            };
            const rest = prev.filter((item) => item.thread_id !== newMessage.thread_id);
            return [updated, ...rest];
          });

          if (selected?.kind === "thread" && selected.threadId === newMessage.thread_id && document.visibilityState === "visible") {
            await syncThreadSilently(newMessage.thread_id);
          } else {
            await loadInboxAndAvailable();
          }
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [currentUserId, supabase, selected, syncThreadSilently, loadInboxAndAvailable]);

  useEffect(() => {
    const onFocus = () => {
      if (document.visibilityState !== "visible") return;
      void loadInboxAndAvailable();
      if (selected?.kind === "thread") {
        void syncThreadSilently(selected.threadId);
      }
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [loadInboxAndAvailable, selected, syncThreadSilently]);

  const availableWithoutThread = useMemo(() => {
    const existing = new Set(inbox.map((item) => `${item.source_kind}:${item.source_id}`));
    return available.filter((item) => !existing.has(`${item.sourceKind}:${item.sourceId}`));
  }, [available, inbox]);

  const selectedTitle = useMemo(() => {
    if (!selected) return "";
    if (selected.kind === "available") {
      return selected.peerNickname;
    }
    const thread = inbox.find((item) => item.thread_id === selected.threadId);
    return thread ? thread.peer_nickname : "채팅";
  }, [selected, inbox]);

  const isClosedThread = selected?.kind === "thread" && threadDetail?.thread.status === "closed";

  const handleSend = async () => {
    const content = compose.trim();
    if (!content || sending || !selected) return;

    setSending(true);
    try {
      const payload =
        selected.kind === "thread"
          ? { thread_id: selected.threadId, content }
          : { source_kind: selected.sourceKind, source_id: selected.sourceId, content };

      const res = await fetch("/api/dating/chat/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        thread_id?: string;
        message_id?: string;
        created_at?: string;
      };

      if (!res.ok || !body.ok) {
        throw new Error(body.message ?? "메시지 전송에 실패했습니다.");
      }

      const nextThreadId = body.thread_id ?? (selected.kind === "thread" ? selected.threadId : "");
      const createdAt = body.created_at ?? new Date().toISOString();

      setCompose("");

      setInbox((prev) => {
        const nextItem: InboxItem | null =
          selected.kind === "thread"
            ? (() => {
                const current = prev.find((item) => item.thread_id === selected.threadId);
                if (!current) return null;
                return {
                  ...current,
                  last_message: content,
                  last_message_at: createdAt,
                  unread_count: 0,
                };
              })()
            : {
                thread_id: nextThreadId,
                source_kind: selected.sourceKind,
                source_id: selected.sourceId,
                peer_user_id:
                  available.find(
                    (item) => item.sourceKind === selected.sourceKind && item.sourceId === selected.sourceId
                  )?.peerUserId ?? "",
                peer_nickname: selected.peerNickname,
                status: "open",
                unread_count: 0,
                last_message: content,
                last_message_at: createdAt,
                created_at: createdAt,
              };

        if (!nextItem) return prev;

        const rest = prev.filter((item) => item.thread_id !== nextItem.thread_id);
        return [nextItem, ...rest];
      });

      if (selected.kind === "thread" && threadDetail?.thread.id === selected.threadId) {
        const receiverId =
          threadDetail.thread.user_a_id === threadDetail.thread.current_user_id
            ? threadDetail.thread.user_b_id
            : threadDetail.thread.user_a_id;
        const optimisticMessage: ChatMessage = {
          id: body.message_id ?? `local-${Date.now()}`,
          thread_id: selected.threadId,
          sender_id: threadDetail.thread.current_user_id,
          receiver_id: receiverId,
          content,
          is_read: true,
          created_at: createdAt,
        };

        setThreadDetail({
          ...threadDetail,
          messages: [...threadDetail.messages, optimisticMessage],
        });
      } else if (selected.kind === "available") {
        setAvailable((prev) =>
          prev.filter((item) => !(item.sourceKind === selected.sourceKind && item.sourceId === selected.sourceId))
        );
        setThreadDetail(null);
      }

      if (nextThreadId) {
        setSelected({ kind: "thread", threadId: nextThreadId });
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : "메시지 전송에 실패했습니다.");
    } finally {
      setSending(false);
    }
  };

  const handleLeave = async () => {
    if (!selected || selected.kind !== "thread" || leaving) return;
    if (!confirm("이 채팅방에서 나갈까요? 내 목록에서만 숨겨집니다.")) return;

    setLeaving(true);
    try {
      const res = await fetch("/api/dating/chat/leave", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ thread_id: selected.threadId }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };

      if (!res.ok || !body.ok) {
        throw new Error(body.message ?? "채팅 나가기에 실패했습니다.");
      }

      setThreadDetail(null);
      setSelected(null);
      await loadInboxAndAvailable({ withLoading: true });
    } catch (e) {
      alert(e instanceof Error ? e.message : "채팅 나가기에 실패했습니다.");
    } finally {
      setLeaving(false);
    }
  };

  const handleReport = async () => {
    if (!selected || selected.kind !== "thread" || reporting) return;
    if (!confirm("이 채팅을 신고할까요? 최근 대화 내용이 함께 운영진에게 전달됩니다.")) return;

    setReporting(true);
    try {
      const res = await fetch("/api/dating/chat/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          thread_id: selected.threadId,
          reason: reportReason,
          details: reportDetails,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };

      if (!res.ok || !body.ok) {
        throw new Error(body.message ?? "채팅 신고에 실패했습니다.");
      }

      setReportDetails("");
      setReportPanelOpen(false);
      alert("채팅 신고가 접수되었습니다. 운영진이 확인할게요.");
    } catch (e) {
      alert(e instanceof Error ? e.message : "채팅 신고에 실패했습니다.");
    } finally {
      setReporting(false);
    }
  };

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#fffefe_0%,#faf7ff_100%)]">
      <div className="mx-auto max-w-6xl px-4 py-5 md:px-6 md:py-8">
        <section className="mb-5 rounded-[28px] border border-rose-100 bg-[linear-gradient(135deg,#f54f7a_0%,#ff8ca6_100%)] px-5 py-4 text-white shadow-[0_18px_36px_rgba(244,63,94,0.18)]">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-black tracking-tight md:text-3xl">채팅</h1>
              <p className="mt-1 text-sm text-white/85">매칭된 상대와 편하게 대화해요</p>
            </div>
            <div className="rounded-full bg-white/18 px-3 py-1 text-xs font-semibold text-white/90">
              새 연결 알림
            </div>
          </div>
        </section>

      {loading ? <p className="text-sm text-neutral-500">채팅을 불러오는 중...</p> : null}
      {error ? <p className="mb-4 rounded-2xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}

      {!loading ? (
        <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
          <aside className="space-y-4">
            <section className="rounded-[24px] border border-black/5 bg-white p-4 shadow-[0_10px_24px_rgba(15,23,42,0.05)]">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-bold text-neutral-900">채팅방</h2>
                <button
                  type="button"
                  onClick={() => void loadInboxAndAvailable({ withLoading: true })}
                  className="rounded-full border border-neutral-200 px-3 py-1 text-xs font-semibold text-neutral-600 hover:bg-neutral-50"
                >
                  새로고침
                </button>
              </div>
              <div className="mt-3 space-y-2">
                {inbox.length === 0 ? (
                  <p className="rounded-2xl bg-neutral-50 px-3 py-4 text-sm text-neutral-500">
                    아직 열린 채팅방이 없습니다.
                  </p>
                ) : (
                  inbox.map((item) => {
                    const active = selected?.kind === "thread" && selected.threadId === item.thread_id;
                    const initial = item.peer_nickname.trim().charAt(0) || "?";
                    return (
                      <button
                        key={item.thread_id}
                        type="button"
                        onClick={() => setSelected({ kind: "thread", threadId: item.thread_id })}
                        className={`w-full rounded-[22px] border px-3 py-3 text-left transition ${
                          active ? "border-rose-200 bg-rose-50/80" : "border-neutral-200 bg-white hover:bg-neutral-50"
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div className="relative shrink-0">
                            <div
                              className={`flex h-12 w-12 items-center justify-center rounded-full border text-lg font-black ${avatarTone(
                                item.peer_nickname
                              )}`}
                            >
                              {initial}
                            </div>
                            <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white bg-emerald-400" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-3">
                              <p className="truncate text-base font-black text-neutral-900">{item.peer_nickname}</p>
                              <div className="flex shrink-0 items-center gap-2">
                                <span className="text-[11px] text-neutral-400">{formatDateTime(item.last_message_at)}</span>
                                {item.unread_count > 0 ? (
                                  <span className="inline-flex h-6 min-w-[24px] items-center justify-center rounded-full bg-rose-500 px-2 text-[11px] font-bold text-white">
                                    {item.unread_count}
                                  </span>
                                ) : null}
                              </div>
                            </div>
                            <p className="mt-1 line-clamp-1 text-sm text-neutral-500">
                              {item.last_message || "대화를 시작해 보세요"}
                            </p>
                          </div>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </section>

            <section className="rounded-[24px] border border-black/5 bg-white p-4 shadow-[0_10px_24px_rgba(15,23,42,0.05)]">
              <h2 className="text-sm font-bold text-neutral-900">채팅 가능한 연결</h2>
              <div className="mt-3 space-y-2">
                {availableWithoutThread.length === 0 ? (
                  <div className="rounded-[22px] border border-neutral-200 bg-neutral-50 px-4 py-8 text-center">
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-violet-50 text-violet-300">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-6 w-6">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM3 20a5 5 0 0 1 10 0M11 20a5 5 0 0 1 10 0" />
                      </svg>
                    </div>
                    <p className="mt-4 text-sm text-neutral-400">새로 시작할 수 있는 연결이 아직 없어요</p>
                    <Link
                      href="/community/dating/cards"
                      className="mt-4 inline-flex h-11 items-center justify-center rounded-full border border-rose-200 bg-white px-5 text-sm font-semibold text-rose-500"
                    >
                      매칭 찾기
                    </Link>
                  </div>
                ) : (
                  availableWithoutThread.map((item) => {
                    const active =
                      selected?.kind === "available" &&
                      selected.sourceId === item.sourceId &&
                      selected.sourceKind === item.sourceKind;
                    const initial = item.peerNickname.trim().charAt(0) || "?";

                    return (
                      <button
                        key={`${item.sourceKind}:${item.sourceId}`}
                        type="button"
                        onClick={() =>
                          setSelected({
                            kind: "available",
                            sourceKind: item.sourceKind,
                            sourceId: item.sourceId,
                            peerNickname: item.peerNickname,
                            title: item.title,
                            threadId: item.thread_id ?? null,
                          })
                        }
                        className={`w-full rounded-[22px] border px-3 py-3 text-left transition ${
                          active ? "border-sky-200 bg-sky-50" : "border-neutral-200 bg-white hover:bg-neutral-50"
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border text-lg font-black ${avatarTone(
                              item.peerNickname
                            )}`}
                          >
                            {initial}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-3">
                              <p className="truncate text-sm font-bold text-neutral-900">{item.peerNickname}</p>
                              <span className="text-[11px] text-neutral-400">{formatDateTime(item.createdAt)}</span>
                            </div>
                            <p className="mt-1 line-clamp-1 text-sm text-neutral-500">{item.title}</p>
                          </div>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </section>
          </aside>

          <section className="rounded-[24px] border border-black/5 bg-white p-4 shadow-[0_10px_24px_rgba(15,23,42,0.05)]">
            {!selected ? (
              <div className="flex min-h-[420px] items-center justify-center rounded-[20px] bg-neutral-50 text-sm text-neutral-500">
                채팅방이나 연결을 선택해 주세요.
              </div>
            ) : (
              <div className="flex min-h-[420px] flex-col">
                <div className="flex items-start justify-between gap-3 border-b border-neutral-100 pb-3">
                  <div>
                    <p className="text-lg font-black text-neutral-950">{selectedTitle}</p>
                    <p className="mt-1 text-xs text-neutral-500">
                      {isClosedThread ? "상대 또는 내가 채팅을 종료했어요" : "편하게 대화를 이어가 보세요"}
                    </p>
                  </div>
                  {selected.kind === "thread" ? (
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => void handleLeave()}
                        disabled={leaving}
                        className="rounded-full border border-neutral-200 px-3 py-1.5 text-xs font-semibold text-neutral-600 hover:bg-neutral-50 disabled:opacity-50"
                      >
                        {leaving ? "처리 중..." : "나가기"}
                      </button>
                    </div>
                  ) : null}
                </div>

                <div className="flex-1 space-y-3 overflow-y-auto py-4">
                  {selected.kind === "available" ? (
                    <div className="rounded-[20px] bg-neutral-50 px-4 py-5 text-sm text-neutral-600">
                      아직 시작된 채팅은 없습니다. 아래에서 첫 메시지를 보내면 채팅방이 바로 열립니다.
                    </div>
                  ) : threadLoading ? (
                    <div className="rounded-[20px] bg-neutral-50 px-4 py-5 text-sm text-neutral-500">
                      대화를 불러오는 중...
                    </div>
                  ) : (threadDetail?.messages ?? []).length === 0 ? (
                    <div className="rounded-[20px] bg-neutral-50 px-4 py-5 text-sm text-neutral-500">
                      아직 메시지가 없습니다.
                    </div>
                  ) : (
                    threadDetail?.messages.map((message) => {
                      const mine = message.sender_id === threadDetail?.thread.current_user_id;
                      return (
                        <div key={message.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                          <div
                            className={`max-w-[80%] rounded-[20px] px-4 py-3 text-sm leading-6 ${
                              mine ? "bg-rose-600 text-white" : "bg-neutral-100 text-neutral-800"
                            }`}
                          >
                            <p className="whitespace-pre-wrap break-words">{message.content}</p>
                            <p className={`mt-1 text-[11px] ${mine ? "text-white/75" : "text-neutral-400"}`}>
                              {formatDateTime(message.created_at)}
                            </p>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                <div className="border-t border-neutral-100 pt-3">
                  {isClosedThread ? (
                    <div className="mb-3 rounded-[18px] border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-500">
                      이 채팅방은 종료되어 더 이상 메시지를 보낼 수 없습니다.
                    </div>
                  ) : null}
                  <div className="flex gap-2">
                    <textarea
                      value={compose}
                      onChange={(e) => setCompose(e.target.value)}
                      rows={2}
                      placeholder="메시지를 입력해 주세요"
                      disabled={!!isClosedThread}
                      className="min-h-[56px] flex-1 resize-none rounded-[18px] border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-900 outline-none placeholder:text-neutral-400"
                    />
                    <button
                      type="button"
                      disabled={sending || !compose.trim() || !!isClosedThread}
                      onClick={() => void handleSend()}
                      className="min-w-[92px] rounded-[18px] bg-rose-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
                    >
                      {sending ? "전송 중..." : "보내기"}
                    </button>
                  </div>
                  {selected.kind === "thread" ? (
                    <div className="mt-3 rounded-[18px] border border-neutral-200 bg-neutral-50 px-3 py-2.5">
                      <button
                        type="button"
                        onClick={() => setReportPanelOpen((prev) => !prev)}
                        className="flex w-full items-center justify-between text-left"
                      >
                        <span className="text-xs font-semibold text-neutral-600">문제가 있으면 신고하기</span>
                        <span className="text-[11px] text-neutral-400">{reportPanelOpen ? "접기" : "열기"}</span>
                      </button>
                      {reportPanelOpen ? (
                        <div className="mt-3 space-y-2 border-t border-neutral-200 pt-3">
                          <div className="grid gap-2 sm:grid-cols-[180px_minmax(0,1fr)]">
                            <select
                              value={reportReason}
                              onChange={(e) =>
                                setReportReason(e.target.value as (typeof DATING_CHAT_REPORT_REASONS)[number])
                              }
                              className="h-10 rounded-xl border border-neutral-200 bg-white px-3 text-sm text-neutral-900"
                            >
                              {DATING_CHAT_REPORT_REASONS.map((reason) => (
                                <option key={reason} value={reason}>
                                  {reason}
                                </option>
                              ))}
                            </select>
                            <input
                              value={reportDetails}
                              onChange={(e) => setReportDetails(e.target.value)}
                              maxLength={300}
                              placeholder="추가 설명이 있으면 적어 주세요 (선택)"
                              className="h-10 rounded-xl border border-neutral-200 bg-white px-3 text-sm text-neutral-900 placeholder:text-neutral-400"
                            />
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-[11px] leading-5 text-neutral-500">
                              신고 시 최근 대화 일부가 함께 저장되어 운영진이 확인합니다.
                            </p>
                            <button
                              type="button"
                              onClick={() => void handleReport()}
                              disabled={reporting}
                              className="shrink-0 rounded-full border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                            >
                              {reporting ? "신고 중..." : "신고 접수"}
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            )}
          </section>
        </div>
      ) : null}

      {!loading && inbox.length === 0 && available.length === 0 ? (
        <section className="mt-4 rounded-[24px] border border-black/5 bg-white p-5 text-sm text-neutral-600 shadow-[0_10px_24px_rgba(15,23,42,0.05)]">
          아직 채팅 가능한 연결이 없습니다.{" "}
          <Link href="/community/dating/cards" className="font-semibold text-rose-600">
            오픈카드
          </Link>
          에서 연결이 생기면 여기서 바로 대화를 시작할 수 있어요.
        </section>
      ) : null}
      </div>
    </main>
  );
}
