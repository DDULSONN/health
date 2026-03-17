"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { timeAgo } from "@/lib/community";

type ModerationReport = {
  id: string;
  reason: string;
  resolved: boolean;
  created_at: string;
  reporter_id: string;
  reporter_nickname: string | null;
};

type ModerationPostItem = {
  post_id: string;
  title: string;
  type: string;
  created_at: string;
  is_hidden: boolean;
  is_deleted: boolean;
  total_report_count: number;
  unresolved_report_count: number;
  latest_reported_at: string | null;
  author: {
    user_id: string;
    nickname: string | null;
    is_banned: boolean;
    banned_reason: string | null;
  };
  reports: ModerationReport[];
};

type ModerationResponse = {
  items?: ModerationPostItem[];
  unresolved_total?: number;
  error?: string;
};

export default function AdminCommunityModerationPanel() {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<ModerationPostItem[]>([]);
  const [unresolvedTotal, setUnresolvedTotal] = useState(0);
  const [processingKey, setProcessingKey] = useState<string | null>(null);
  const [error, setError] = useState("");

  const loadModeration = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/community/reports", { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as ModerationResponse;
      if (!res.ok) {
        setError(data.error ?? "커뮤니티 신고 목록을 불러오지 못했습니다.");
        setItems([]);
        setUnresolvedTotal(0);
        return;
      }
      setItems(data.items ?? []);
      setUnresolvedTotal(Number(data.unresolved_total ?? 0));
      setError("");
    } catch {
      setError("커뮤니티 신고 목록을 불러오지 못했습니다.");
      setItems([]);
      setUnresolvedTotal(0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadModeration();
  }, [loadModeration]);

  const handleToggleBan = async (item: ModerationPostItem) => {
    const nextBanned = !item.author.is_banned;
    const reason = nextBanned
      ? window.prompt("밴 사유를 입력하세요.", item.author.banned_reason ?? "커뮤니티 운영 정책 위반")
      : "";

    if (nextBanned && reason === null) return;

    setProcessingKey(`ban:${item.author.user_id}`);
    try {
      const res = await fetch(`/api/admin/community/users/${item.author.user_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          is_banned: nextBanned,
          reason: nextBanned ? reason : null,
        }),
      });
      if (!res.ok) throw new Error();
      await loadModeration();
    } catch {
      window.alert("유저 밴 상태 변경에 실패했습니다.");
    } finally {
      setProcessingKey(null);
    }
  };

  const handleResolveReports = async (item: ModerationPostItem) => {
    setProcessingKey(`resolve:${item.post_id}`);
    try {
      const res = await fetch("/api/admin/community/reports", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target_id: item.post_id, resolved: true }),
      });
      if (!res.ok) throw new Error();
      await loadModeration();
    } catch {
      window.alert("신고 처리 완료에 실패했습니다.");
    } finally {
      setProcessingKey(null);
    }
  };

  const handleToggleHidden = async (item: ModerationPostItem) => {
    setProcessingKey(`hide:${item.post_id}`);
    try {
      const res = await fetch(`/api/admin/posts/${item.post_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          is_hidden: !item.is_hidden,
          resolve_reports: item.unresolved_report_count > 0,
        }),
      });
      if (!res.ok) throw new Error();
      await loadModeration();
    } catch {
      window.alert("글 숨김 상태 변경에 실패했습니다.");
    } finally {
      setProcessingKey(null);
    }
  };

  const handleDeletePost = async (item: ModerationPostItem) => {
    const ok = window.confirm("이 게시글을 삭제 처리할까요? 신고도 함께 처리됩니다.");
    if (!ok) return;

    setProcessingKey(`delete:${item.post_id}`);
    try {
      const res = await fetch(`/api/admin/posts/${item.post_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          is_deleted: true,
          is_hidden: true,
          resolve_reports: true,
        }),
      });
      if (!res.ok) throw new Error();
      await loadModeration();
    } catch {
      window.alert("글 삭제 처리에 실패했습니다.");
    } finally {
      setProcessingKey(null);
    }
  };

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-neutral-900">커뮤니티 신고 관리</h3>
          <p className="mt-1 text-xs text-neutral-500">신고가 많이 들어온 글을 보고 숨김, 삭제, 밴 처리를 할 수 있습니다.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-red-50 px-3 py-1 text-xs font-semibold text-red-700">
            미처리 신고 {unresolvedTotal}건
          </span>
          <button
            type="button"
            onClick={() => void loadModeration()}
            className="h-8 rounded-md border border-neutral-300 bg-white px-3 text-xs font-medium text-neutral-700"
          >
            새로고침
          </button>
        </div>
      </div>

      {loading ? (
        <p className="mt-4 text-sm text-neutral-500">신고 목록을 불러오는 중...</p>
      ) : error ? (
        <p className="mt-4 text-sm text-red-600">{error}</p>
      ) : items.length === 0 ? (
        <p className="mt-4 text-sm text-neutral-500">현재 신고가 많이 들어온 글이 없습니다.</p>
      ) : (
        <div className="mt-4 space-y-3">
          {items.map((item) => (
            <div key={item.post_id} className="rounded-2xl border border-neutral-200 bg-neutral-50/60 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-red-100 px-2.5 py-1 text-[11px] font-semibold text-red-700">
                      미처리 {item.unresolved_report_count}건 / 전체 {item.total_report_count}건
                    </span>
                    <span className="text-xs text-neutral-400">{timeAgo(item.created_at)}</span>
                    {item.is_hidden ? (
                      <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-700">
                        숨김
                      </span>
                    ) : null}
                    {item.is_deleted ? (
                      <span className="rounded-full bg-neutral-200 px-2.5 py-1 text-[11px] font-semibold text-neutral-700">
                        삭제됨
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-2 text-sm font-semibold text-neutral-900">{item.title}</p>
                  <p className="mt-1 text-xs text-neutral-500">
                    작성자 {item.author.nickname ?? item.author.user_id.slice(0, 8)} · 최근 신고{" "}
                    {item.latest_reported_at ? timeAgo(item.latest_reported_at) : "-"}
                  </p>
                  {item.author.is_banned ? (
                    <p className="mt-1 text-xs font-medium text-red-700">
                      밴 상태{item.author.banned_reason ? ` · ${item.author.banned_reason}` : ""}
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link
                    href={`/community/${item.post_id}`}
                    className="inline-flex h-8 items-center rounded-md border border-neutral-300 bg-white px-3 text-xs font-medium text-neutral-700"
                  >
                    글 보기
                  </Link>
                  <button
                    type="button"
                    disabled={processingKey !== null}
                    onClick={() => void handleResolveReports(item)}
                    className="h-8 rounded-md bg-sky-600 px-3 text-xs font-medium text-white disabled:opacity-50"
                  >
                    신고 처리
                  </button>
                  <button
                    type="button"
                    disabled={processingKey !== null}
                    onClick={() => void handleToggleHidden(item)}
                    className="h-8 rounded-md bg-amber-600 px-3 text-xs font-medium text-white disabled:opacity-50"
                  >
                    {item.is_hidden ? "공개" : "숨기기"}
                  </button>
                  <button
                    type="button"
                    disabled={processingKey !== null || item.is_deleted}
                    onClick={() => void handleDeletePost(item)}
                    className="h-8 rounded-md bg-red-600 px-3 text-xs font-medium text-white disabled:opacity-50"
                  >
                    삭제
                  </button>
                  <button
                    type="button"
                    disabled={processingKey !== null}
                    onClick={() => void handleToggleBan(item)}
                    className={`h-8 rounded-md px-3 text-xs font-medium text-white disabled:opacity-50 ${
                      item.author.is_banned ? "bg-neutral-700" : "bg-rose-700"
                    }`}
                  >
                    {item.author.is_banned ? "밴 해제" : "유저 밴"}
                  </button>
                </div>
              </div>

              {item.reports.length > 0 ? (
                <div className="mt-3 space-y-2">
                  {item.reports.slice(0, 4).map((report) => (
                    <div key={report.id} className="rounded-xl border border-neutral-200 bg-white px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-neutral-500">
                        <span>{report.reporter_nickname ?? report.reporter_id.slice(0, 8)}</span>
                        <span>{timeAgo(report.created_at)}</span>
                        <span className={report.resolved ? "text-emerald-700" : "text-red-600"}>
                          {report.resolved ? "처리완료" : "미처리"}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-neutral-700">{report.reason}</p>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
