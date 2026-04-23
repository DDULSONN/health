"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { DATING_CHAT_REPORT_REASONS } from "@/lib/dating-chat-report-reasons";

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

function sourceLabel(kind: ChatSourceKind) {
  if (kind === "open") return "오픈카드";
  if (kind === "paid") return "유료카드";
  return "빠른매칭";
}

export default function ChatPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [available, setAvailable] = useState<AvailableItem[]>([]);
  const [selected, setSelected] = useState<SelectedState>(null);
  const [threadDetail, setThreadDetail] = useState<ThreadDetail | null>(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const [compose, setCompose] = useState("");
  const [sending, setSending] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reportReason, setReportReason] = useState<(typeof DATING_CHAT_REPORT_REASONS)[number]>(
    DATING_CHAT_REPORT_REASONS[0]
  );
  const [reportDetails, setReportDetails] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
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
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!selected || selected.kind !== "thread") {
      setThreadDetail(null);
      return;
    }

    let cancelled = false;

    const run = async () => {
      setThreadLoading(true);
      try {
        const res = await fetch(`/api/dating/chat/thread?thread_id=${encodeURIComponent(selected.threadId)}`, {
          cache: "no-store",
        });
        const body = (await res.json().catch(() => ({}))) as ThreadDetail & { message?: string };

        if (!res.ok) {
          throw new Error(body.message ?? "채팅 내용을 불러오지 못했습니다.");
        }

        if (!cancelled) {
          setThreadDetail(body);
          await fetch("/api/dating/chat/read", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ thread_id: selected.threadId }),
          });
          setInbox((prev) =>
            prev.map((item) => (item.thread_id === selected.threadId ? { ...item, unread_count: 0 } : item))
          );
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
  }, [selected]);

  const availableWithoutThread = useMemo(() => {
    const existing = new Set(inbox.map((item) => `${item.source_kind}:${item.source_id}`));
    return available.filter((item) => !existing.has(`${item.sourceKind}:${item.sourceId}`));
  }, [available, inbox]);

  const selectedTitle = useMemo(() => {
    if (!selected) return "";
    if (selected.kind === "available") {
      return `${selected.peerNickname} · ${selected.title}`;
    }
    const thread = inbox.find((item) => item.thread_id === selected.threadId);
    return thread ? `${thread.peer_nickname} · ${sourceLabel(thread.source_kind)}` : "채팅";
  }, [selected, inbox]);

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
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string; thread_id?: string };

      if (!res.ok || !body.ok) {
        throw new Error(body.message ?? "메시지 전송에 실패했습니다.");
      }

      setCompose("");
      await load();
      if (body.thread_id) {
        setSelected({ kind: "thread", threadId: body.thread_id });
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
      await load();
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
      alert("채팅 신고가 접수되었습니다. 운영진이 확인할게요.");
    } catch (e) {
      alert(e instanceof Error ? e.message : "채팅 신고에 실패했습니다.");
    } finally {
      setReporting(false);
    }
  };

  return (
    <main className="mx-auto max-w-6xl px-4 py-5 md:px-6 md:py-8">
      <section className="mb-5 rounded-[28px] border border-black/5 bg-white p-5 shadow-[0_14px_40px_rgba(15,23,42,0.06)]">
        <h1 className="text-2xl font-black tracking-tight text-neutral-950 md:text-3xl">채팅</h1>
        <p className="mt-2 text-sm leading-6 text-neutral-500">
          오픈카드, 유료카드, 빠른매칭에서 연결된 상대와 가볍게 대화를 이어갈 수 있어요.
        </p>
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
                  onClick={() => void load()}
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
                    return (
                      <button
                        key={item.thread_id}
                        type="button"
                        onClick={() => setSelected({ kind: "thread", threadId: item.thread_id })}
                        className={`w-full rounded-[20px] border px-3 py-3 text-left transition ${
                          active ? "border-rose-200 bg-rose-50" : "border-neutral-200 bg-white hover:bg-neutral-50"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-bold text-neutral-900">{item.peer_nickname}</p>
                          {item.unread_count > 0 ? (
                            <span className="rounded-full bg-rose-600 px-2 py-0.5 text-[11px] font-bold text-white">
                              {item.unread_count}
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-1 text-xs font-medium text-neutral-500">{sourceLabel(item.source_kind)}</p>
                        <p className="mt-2 line-clamp-1 text-sm text-neutral-600">
                          {item.last_message || "대화를 시작해 보세요"}
                        </p>
                        <p className="mt-2 text-[11px] text-neutral-400">{formatDateTime(item.last_message_at)}</p>
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
                  <p className="rounded-2xl bg-neutral-50 px-3 py-4 text-sm text-neutral-500">
                    새로 시작할 수 있는 연결이 아직 없습니다.
                  </p>
                ) : (
                  availableWithoutThread.map((item) => {
                    const active =
                      selected?.kind === "available" &&
                      selected.sourceId === item.sourceId &&
                      selected.sourceKind === item.sourceKind;

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
                        className={`w-full rounded-[20px] border px-3 py-3 text-left transition ${
                          active ? "border-sky-200 bg-sky-50" : "border-neutral-200 bg-white hover:bg-neutral-50"
                        }`}
                      >
                        <p className="text-sm font-bold text-neutral-900">{item.peerNickname}</p>
                        <p className="mt-1 text-xs font-medium text-neutral-500">{item.title}</p>
                        <p className="mt-2 text-[11px] text-neutral-400">{formatDateTime(item.createdAt)}</p>
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
                      첫 메시지를 직접 보내야 대화가 시작되는 구조입니다.
                    </p>
                  </div>
                  {selected.kind === "thread" ? (
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => void handleReport()}
                        disabled={reporting}
                        className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50"
                      >
                        {reporting ? "신고 중..." : "신고"}
                      </button>
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

                {selected.kind === "thread" ? (
                  <div className="mt-3 rounded-[18px] border border-rose-100 bg-rose-50/60 p-3">
                    <div className="grid gap-2 sm:grid-cols-[180px_minmax(0,1fr)]">
                      <select
                        value={reportReason}
                        onChange={(e) => setReportReason(e.target.value as (typeof DATING_CHAT_REPORT_REASONS)[number])}
                        className="h-10 rounded-xl border border-rose-100 bg-white px-3 text-sm text-neutral-900"
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
                        className="h-10 rounded-xl border border-rose-100 bg-white px-3 text-sm text-neutral-900 placeholder:text-neutral-400"
                      />
                    </div>
                    <p className="mt-2 text-[11px] leading-5 text-neutral-500">
                      신고 시 최근 대화 일부가 함께 저장되어 운영진이 admin 페이지에서 바로 확인할 수 있습니다.
                    </p>
                  </div>
                ) : null}

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
                  <div className="flex gap-2">
                    <textarea
                      value={compose}
                      onChange={(e) => setCompose(e.target.value)}
                      rows={2}
                      placeholder="메시지를 입력해 주세요"
                      className="min-h-[56px] flex-1 resize-none rounded-[18px] border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-900 outline-none placeholder:text-neutral-400"
                    />
                    <button
                      type="button"
                      disabled={sending || !compose.trim()}
                      onClick={() => void handleSend()}
                      className="min-w-[92px] rounded-[18px] bg-rose-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
                    >
                      {sending ? "전송 중..." : "보내기"}
                    </button>
                  </div>
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
    </main>
  );
}
