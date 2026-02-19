"use client";

import { useEffect, useMemo, useState } from "react";

type InboxItem = {
  thread_id: string;
  post_id: string;
  post_title: string;
  peer_user_id: string;
  peer_nickname: string;
  box_type: "received" | "sent";
  unread_count: number;
  last_message: string;
  last_message_at: string;
  status: "open" | "closed";
};

type ThreadMessage = {
  id: string;
  thread_id: string;
  sender_id: string;
  receiver_id: string;
  content: string;
  is_read: boolean;
  created_at: string;
};

type ThreadDetail = {
  id: string;
  post_id: string;
  post_title: string;
  author_id: string;
  sender_id: string;
  author_nickname: string;
  sender_nickname: string;
  status: "open" | "closed";
  created_at: string;
};

export default function BodyEvalMailbox() {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [activeType, setActiveType] = useState<"received" | "sent">("received");
  const [activeThreadId, setActiveThreadId] = useState<string>("");
  const [thread, setThread] = useState<ThreadDetail | null>(null);
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [reply, setReply] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  const loadInbox = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/body-eval/mail/inbox", { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as { items?: InboxItem[] };
      setItems(Array.isArray(data.items) ? data.items : []);
    } finally {
      setLoading(false);
    }
  };

  const loadThread = async (threadId: string) => {
    const res = await fetch(`/api/body-eval/mail/thread?thread_id=${encodeURIComponent(threadId)}`, {
      cache: "no-store",
    });
    const data = (await res.json().catch(() => ({}))) as {
      thread?: ThreadDetail;
      messages?: ThreadMessage[];
    };
    if (!res.ok || !data.thread) return;
    setThread(data.thread);
    setMessages(data.messages ?? []);
    setActiveThreadId(threadId);
    await fetch("/api/body-eval/mail/read", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ thread_id: threadId }),
    });
    await loadInbox();
  };

  const sendReply = async () => {
    const content = reply.trim();
    if (!activeThreadId || !content) return;
    setSending(true);
    try {
      const res = await fetch("/api/body-eval/mail/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ thread_id: activeThreadId, content }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
      if (!res.ok || !data.ok) {
        alert(data.message ?? "답장 전송에 실패했습니다.");
        return;
      }
      setReply("");
      await loadThread(activeThreadId);
      await loadInbox();
    } finally {
      setSending(false);
    }
  };

  useEffect(() => {
    void loadInbox();
  }, []);

  const filtered = useMemo(
    () => items.filter((item) => item.box_type === activeType),
    [items, activeType]
  );
  const unreadCount = useMemo(
    () => items.filter((item) => item.box_type === "received").reduce((acc, cur) => acc + cur.unread_count, 0),
    [items]
  );

  return (
    <section className="mb-5 rounded-2xl border border-neutral-200 bg-white p-5">
      <h2 className="text-lg font-bold text-neutral-900">몸평 메일함</h2>
      <p className="mt-1 text-xs text-neutral-500">안 읽은 메일 {unreadCount}개</p>

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => setActiveType("received")}
          className={`h-9 rounded-lg px-3 text-xs font-medium ${
            activeType === "received" ? "bg-emerald-600 text-white" : "bg-neutral-100 text-neutral-700"
          }`}
        >
          받은 메일
        </button>
        <button
          type="button"
          onClick={() => setActiveType("sent")}
          className={`h-9 rounded-lg px-3 text-xs font-medium ${
            activeType === "sent" ? "bg-emerald-600 text-white" : "bg-neutral-100 text-neutral-700"
          }`}
        >
          보낸 메일
        </button>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="space-y-2">
          {loading ? (
            <p className="text-sm text-neutral-500">불러오는 중...</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-neutral-500">메일이 없습니다.</p>
          ) : (
            filtered.map((item) => (
              <button
                key={item.thread_id}
                type="button"
                onClick={() => void loadThread(item.thread_id)}
                className={`w-full rounded-xl border p-3 text-left ${
                  activeThreadId === item.thread_id ? "border-emerald-400 bg-emerald-50" : "border-neutral-200 bg-white"
                }`}
              >
                <p className="text-xs text-neutral-500">{item.post_title}</p>
                <p className="mt-1 text-sm font-semibold text-neutral-900">{item.peer_nickname}</p>
                <p className="mt-1 truncate text-xs text-neutral-600">{item.last_message}</p>
                <p className="mt-1 text-[11px] text-neutral-400">{new Date(item.last_message_at).toLocaleString("ko-KR")}</p>
                {item.unread_count > 0 && (
                  <span className="mt-1 inline-flex rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-medium text-rose-700">
                    안 읽음 {item.unread_count}
                  </span>
                )}
              </button>
            ))
          )}
        </div>

        <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3">
          {!thread ? (
            <p className="text-sm text-neutral-500">스레드를 선택하세요.</p>
          ) : (
            <>
              <p className="text-xs text-neutral-500">{thread.post_title}</p>
              <div className="mt-2 max-h-72 space-y-2 overflow-y-auto">
                {messages.map((msg) => {
                  return (
                    <div key={msg.id} className="rounded-lg bg-white p-2 text-sm">
                      <p className="whitespace-pre-wrap break-words text-neutral-800">{msg.content}</p>
                      <p className="mt-1 text-[11px] text-neutral-400">{new Date(msg.created_at).toLocaleString("ko-KR")}</p>
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 flex gap-2">
                <input
                  type="text"
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  placeholder="답장을 입력하세요"
                  className="h-10 flex-1 rounded-lg border border-neutral-300 bg-white px-3 text-sm"
                />
                <button
                  type="button"
                  onClick={() => void sendReply()}
                  disabled={sending || !reply.trim()}
                  className="h-10 rounded-lg bg-emerald-600 px-3 text-xs font-medium text-white disabled:opacity-50"
                >
                  전송
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
