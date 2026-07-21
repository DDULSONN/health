"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import AdminCommunityModerationPanel from "@/components/AdminCommunityModerationPanel";

type ReportStatus = "open" | "resolved" | "dismissed";
type ReportKind = "card" | "user" | "chat" | "community";
type StatusFilter = "open" | "all" | "closed";

type CardReport = {
  id: string;
  card_id: string;
  reporter_user_id: string;
  reporter_nickname: string | null;
  card_owner_user_id: string | null;
  owner_nickname: string | null;
  card_display_nickname: string | null;
  card_status: string | null;
  owner_is_banned: boolean;
  owner_banned_reason: string | null;
  reason: string;
  status: ReportStatus;
  created_at: string;
};

type UserReport = {
  id: string;
  reporter_user_id: string;
  reporter_nickname: string | null;
  reported_user_id: string;
  reported_nickname: string | null;
  reported_is_banned: boolean;
  reported_banned_reason: string | null;
  target_type: "open_card_application" | "paid_card_application" | "one_on_one_card" | "one_on_one_match";
  target_id: string;
  target_card_id: string | null;
  reason: string;
  evidence_snapshot: unknown;
  evidence_preserved_at: string | null;
  admin_note: string | null;
  action_note: string | null;
  status: ReportStatus;
  created_at: string;
};

type ChatMessage = {
  id?: string;
  sender_nickname?: string;
  receiver_nickname?: string;
  content?: string;
  created_at?: string;
};

type ChatReport = {
  id: string;
  thread_id: string;
  source_kind: string;
  reporter_user_id: string;
  reporter_nickname: string | null;
  reported_user_id: string;
  reported_nickname: string | null;
  reported_is_banned: boolean;
  reported_banned_reason: string | null;
  reason: string;
  details: string | null;
  conversation_excerpt: ChatMessage[] | null;
  status: ReportStatus;
  created_at: string;
};

type CommunitySummary = {
  unresolved_total?: number;
  items?: unknown[];
};

const KIND_LABELS: Record<ReportKind, string> = {
  card: "오픈카드",
  user: "지원·1:1",
  chat: "채팅",
  community: "커뮤니티",
};

function statusLabel(status: ReportStatus) {
  if (status === "resolved") return "처리 완료";
  if (status === "dismissed") return "기각";
  return "미처리";
}

function statusClass(status: ReportStatus) {
  if (status === "resolved") return "bg-emerald-50 text-emerald-700";
  if (status === "dismissed") return "bg-neutral-100 text-neutral-600";
  return "bg-rose-50 text-rose-700";
}

function targetTypeLabel(type: UserReport["target_type"]) {
  if (type === "open_card_application") return "오픈카드 지원";
  if (type === "paid_card_application") return "유료카드 지원";
  if (type === "one_on_one_card") return "1:1 신청서";
  return "1:1 매칭";
}

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString("ko-KR");
}

function matchesStatus(status: ReportStatus, filter: StatusFilter) {
  if (filter === "all") return true;
  if (filter === "closed") return status !== "open";
  return status === "open";
}

export default function AdminReportsPanel() {
  const [kind, setKind] = useState<ReportKind>("card");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("open");
  const [cardReports, setCardReports] = useState<CardReport[]>([]);
  const [userReports, setUserReports] = useState<UserReport[]>([]);
  const [chatReports, setChatReports] = useState<ChatReport[]>([]);
  const [communityOpenCount, setCommunityOpenCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [processingKey, setProcessingKey] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setErrors([]);
    const requests = await Promise.allSettled([
      fetch("/api/admin/dating/reports", { cache: "no-store" }),
      fetch("/api/admin/dating/user-reports", { cache: "no-store" }),
      fetch("/api/admin/dating/chat-reports", { cache: "no-store" }),
      fetch("/api/admin/community/reports", { cache: "no-store" }),
    ]);

    const nextErrors: string[] = [];
    const read = async <T,>(result: PromiseSettledResult<Response>, label: string): Promise<T | null> => {
      if (result.status === "rejected") {
        nextErrors.push(`${label} 신고를 불러오지 못했습니다.`);
        return null;
      }
      const body = (await result.value.json().catch(() => ({}))) as T & { error?: string };
      if (!result.value.ok) {
        nextErrors.push(body.error ?? `${label} 신고를 불러오지 못했습니다.`);
        return null;
      }
      return body;
    };

    const [cards, users, chats, community] = await Promise.all([
      read<{ items?: CardReport[] }>(requests[0], "오픈카드"),
      read<{ items?: UserReport[] }>(requests[1], "지원·1:1"),
      read<{ items?: ChatReport[] }>(requests[2], "채팅"),
      read<CommunitySummary>(requests[3], "커뮤니티"),
    ]);

    if (cards) setCardReports(cards.items ?? []);
    if (users) setUserReports(users.items ?? []);
    if (chats) setChatReports(chats.items ?? []);
    if (community) setCommunityOpenCount(Number(community.unresolved_total ?? 0));
    setErrors(nextErrors);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(
    () => ({
      card: cardReports.filter((item) => item.status === "open").length,
      user: userReports.filter((item) => item.status === "open").length,
      chat: chatReports.filter((item) => item.status === "open").length,
      community: communityOpenCount,
    }),
    [cardReports, chatReports, communityOpenCount, userReports]
  );

  const totalOpen = counts.card + counts.user + counts.chat + counts.community;
  const visibleCardReports = cardReports.filter((item) => matchesStatus(item.status, statusFilter));
  const visibleUserReports = userReports.filter((item) => matchesStatus(item.status, statusFilter));
  const visibleChatReports = chatReports.filter((item) => matchesStatus(item.status, statusFilter));

  const updateStatus = async (reportKind: Exclude<ReportKind, "community">, id: string, status: ReportStatus) => {
    const path =
      reportKind === "card"
        ? `/api/admin/dating/reports/${id}`
        : reportKind === "user"
          ? `/api/admin/dating/user-reports/${id}`
          : `/api/admin/dating/chat-reports/${id}`;
    setProcessingKey(`${reportKind}:${id}`);
    try {
      const res = await fetch(path, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "신고 상태 변경에 실패했습니다.");
      await load();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "신고 상태 변경에 실패했습니다.");
    } finally {
      setProcessingKey(null);
    }
  };

  const preserveEvidence = async (report: UserReport) => {
    setProcessingKey(`user:${report.id}`);
    try {
      const res = await fetch(`/api/admin/dating/user-reports/${report.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preserve_evidence: true, action_type: "evidence_preserved" }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "증거 보존에 실패했습니다.");
      await load();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "증거 보존에 실패했습니다.");
    } finally {
      setProcessingKey(null);
    }
  };

  const toggleBan = async (userId: string | null, nickname: string | null, isBanned: boolean) => {
    if (!userId) {
      window.alert("신고 대상 계정을 찾지 못했습니다.");
      return;
    }
    const reason = isBanned
      ? ""
      : window.prompt(`${nickname || userId.slice(0, 8)} 계정의 정지 사유를 입력하세요.`, "신고 검토 후 운영정책 위반");
    if (!isBanned && reason === null) return;
    const actionLabel = isBanned ? "정지를 해제" : "계정을 정지";
    if (!window.confirm(`${nickname || userId.slice(0, 8)} 계정의 ${actionLabel}할까요?`)) return;

    setProcessingKey(`ban:${userId}`);
    try {
      const res = await fetch("/api/admin/users/ban", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, banned: !isBanned, reason }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "계정 상태 변경에 실패했습니다.");
      await load();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "계정 상태 변경에 실패했습니다.");
    } finally {
      setProcessingKey(null);
    }
  };

  const actionButtons = (reportKind: Exclude<ReportKind, "community">, id: string, status: ReportStatus) => {
    const processing = processingKey === `${reportKind}:${id}`;
    return (
      <div className="flex flex-wrap gap-2">
        {status !== "resolved" ? (
          <button type="button" disabled={processingKey !== null} onClick={() => void updateStatus(reportKind, id, "resolved")} className="h-8 rounded-md bg-emerald-600 px-3 text-xs font-medium text-white disabled:opacity-50">
            {processing ? "처리 중..." : "처리 완료"}
          </button>
        ) : null}
        {status !== "dismissed" ? (
          <button type="button" disabled={processingKey !== null} onClick={() => void updateStatus(reportKind, id, "dismissed")} className="h-8 rounded-md bg-neutral-700 px-3 text-xs font-medium text-white disabled:opacity-50">
            기각
          </button>
        ) : null}
        {status !== "open" ? (
          <button type="button" disabled={processingKey !== null} onClick={() => void updateStatus(reportKind, id, "open")} className="h-8 rounded-md border border-amber-300 bg-white px-3 text-xs font-medium text-amber-700 disabled:opacity-50">
            다시 열기
          </button>
        ) : null}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-violet-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold text-neutral-950">신고 관리</h3>
              <span className="rounded-full bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700">미처리 {totalOpen}건</span>
            </div>
            <p className="mt-1 text-xs text-neutral-500">서비스에서 접수된 신고를 유형별로 확인하고 바로 조치합니다.</p>
          </div>
          <button type="button" onClick={() => void load()} disabled={loading} className="h-8 rounded-md border border-neutral-200 bg-white px-3 text-xs font-medium text-neutral-700 disabled:opacity-50">
            {loading ? "불러오는 중..." : "새로고침"}
          </button>
        </div>

        <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
          {(Object.keys(KIND_LABELS) as ReportKind[]).map((item) => (
            <button key={item} type="button" onClick={() => setKind(item)} className={`shrink-0 rounded-lg border px-3 py-2 text-xs font-medium ${kind === item ? "border-violet-600 bg-violet-600 text-white" : "border-neutral-200 bg-white text-neutral-700"}`}>
              {KIND_LABELS[item]} {counts[item] > 0 ? `${counts[item]}건` : ""}
            </button>
          ))}
        </div>

        {kind !== "community" ? (
          <div className="mt-3 flex gap-1 rounded-lg bg-neutral-100 p-1">
            {(["open", "all", "closed"] as StatusFilter[]).map((item) => (
              <button key={item} type="button" onClick={() => setStatusFilter(item)} className={`h-8 flex-1 rounded-md text-xs font-medium ${statusFilter === item ? "bg-white text-neutral-950 shadow-sm" : "text-neutral-500"}`}>
                {item === "open" ? "미처리" : item === "all" ? "전체" : "처리됨"}
              </button>
            ))}
          </div>
        ) : null}

        {errors.length > 0 ? (
          <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{errors.join(" ")}</div>
        ) : null}
      </div>

      {kind === "card" ? (
        <div className="space-y-3">
          {visibleCardReports.map((report) => (
            <article key={report.id} className="rounded-xl border border-neutral-200 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${statusClass(report.status)}`}>{statusLabel(report.status)}</span>
                    <span className="text-xs text-neutral-400">{formatDate(report.created_at)}</span>
                  </div>
                  <p className="mt-2 text-sm font-semibold text-neutral-950">{report.owner_nickname || report.card_display_nickname || "닉네임 없음"}의 오픈카드</p>
                  <p className="mt-1 text-xs text-neutral-500">신고자 {report.reporter_nickname || report.reporter_user_id.slice(0, 8)} · 카드 상태 {report.card_status || "-"}</p>
                </div>
                <button type="button" disabled={processingKey !== null} onClick={() => void toggleBan(report.card_owner_user_id, report.owner_nickname, report.owner_is_banned)} className={`h-8 rounded-md px-3 text-xs font-medium text-white disabled:opacity-50 ${report.owner_is_banned ? "bg-neutral-700" : "bg-rose-700"}`}>
                  {report.owner_is_banned ? "정지 해제" : "계정 정지"}
                </button>
              </div>
              <div className="mt-3 rounded-lg bg-rose-50/70 px-3 py-3">
                <p className="text-[11px] font-semibold text-rose-700">신고 사유</p>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm text-neutral-800">{report.reason}</p>
              </div>
              <div className="mt-3">{actionButtons("card", report.id, report.status)}</div>
            </article>
          ))}
          {!loading && visibleCardReports.length === 0 ? <p className="rounded-xl border border-neutral-200 bg-white p-5 text-sm text-neutral-500">해당하는 오픈카드 신고가 없습니다.</p> : null}
        </div>
      ) : null}

      {kind === "user" ? (
        <div className="space-y-3">
          {visibleUserReports.map((report) => (
            <article key={report.id} className="rounded-xl border border-neutral-200 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${statusClass(report.status)}`}>{statusLabel(report.status)}</span>
                    <span className="rounded-full bg-sky-50 px-2 py-1 text-[11px] font-medium text-sky-700">{targetTypeLabel(report.target_type)}</span>
                    <span className="text-xs text-neutral-400">{formatDate(report.created_at)}</span>
                  </div>
                  <p className="mt-2 text-sm font-semibold text-neutral-950">{report.reported_nickname || report.reported_user_id.slice(0, 8)} 신고</p>
                  <p className="mt-1 text-xs text-neutral-500">신고자 {report.reporter_nickname || report.reporter_user_id.slice(0, 8)}</p>
                </div>
                <button type="button" disabled={processingKey !== null} onClick={() => void toggleBan(report.reported_user_id, report.reported_nickname, report.reported_is_banned)} className={`h-8 rounded-md px-3 text-xs font-medium text-white disabled:opacity-50 ${report.reported_is_banned ? "bg-neutral-700" : "bg-rose-700"}`}>
                  {report.reported_is_banned ? "정지 해제" : "계정 정지"}
                </button>
              </div>
              <div className="mt-3 rounded-lg bg-rose-50/70 px-3 py-3">
                <p className="text-[11px] font-semibold text-rose-700">신고 사유</p>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm text-neutral-800">{report.reason}</p>
              </div>
              {(report.admin_note || report.action_note) ? <p className="mt-2 text-xs text-neutral-500">관리 기록: {report.admin_note || report.action_note}</p> : null}
              <div className="mt-3 flex flex-wrap gap-2">
                {actionButtons("user", report.id, report.status)}
                <button type="button" disabled={processingKey !== null} onClick={() => void preserveEvidence(report)} className="h-8 rounded-md border border-sky-200 bg-sky-50 px-3 text-xs font-medium text-sky-700 disabled:opacity-50">
                  {report.evidence_preserved_at ? "증거 다시 보존" : "증거 보존"}
                </button>
              </div>
            </article>
          ))}
          {!loading && visibleUserReports.length === 0 ? <p className="rounded-xl border border-neutral-200 bg-white p-5 text-sm text-neutral-500">해당하는 지원·1:1 신고가 없습니다.</p> : null}
        </div>
      ) : null}

      {kind === "chat" ? (
        <div className="space-y-3">
          {visibleChatReports.map((report) => (
            <article key={report.id} className="rounded-xl border border-neutral-200 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${statusClass(report.status)}`}>{statusLabel(report.status)}</span>
                    <span className="text-xs text-neutral-400">{formatDate(report.created_at)}</span>
                  </div>
                  <p className="mt-2 text-sm font-semibold text-neutral-950">{report.reported_nickname || report.reported_user_id.slice(0, 8)} 채팅 신고</p>
                  <p className="mt-1 text-xs text-neutral-500">신고자 {report.reporter_nickname || report.reporter_user_id.slice(0, 8)} · {report.source_kind}</p>
                </div>
                <button type="button" disabled={processingKey !== null} onClick={() => void toggleBan(report.reported_user_id, report.reported_nickname, report.reported_is_banned)} className={`h-8 rounded-md px-3 text-xs font-medium text-white disabled:opacity-50 ${report.reported_is_banned ? "bg-neutral-700" : "bg-rose-700"}`}>
                  {report.reported_is_banned ? "정지 해제" : "계정 정지"}
                </button>
              </div>
              <div className="mt-3 rounded-lg bg-rose-50/70 px-3 py-3">
                <p className="text-[11px] font-semibold text-rose-700">신고 사유</p>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm text-neutral-800">{report.reason}</p>
                {report.details ? <p className="mt-2 whitespace-pre-wrap break-words text-xs text-neutral-600">{report.details}</p> : null}
              </div>
              {Array.isArray(report.conversation_excerpt) && report.conversation_excerpt.length > 0 ? (
                <details className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
                  <summary className="cursor-pointer text-xs font-semibold text-neutral-700">신고 당시 대화 {report.conversation_excerpt.length}개 보기</summary>
                  <div className="mt-3 space-y-2">
                    {report.conversation_excerpt.map((message, index) => (
                      <div key={message.id ?? `${report.id}-${index}`} className="rounded-lg bg-white px-3 py-2">
                        <p className="text-[11px] text-neutral-500">{message.sender_nickname || "익명"} · {formatDate(message.created_at)}</p>
                        <p className="mt-1 whitespace-pre-wrap break-words text-sm text-neutral-800">{message.content || "(내용 없음)"}</p>
                      </div>
                    ))}
                  </div>
                </details>
              ) : null}
              <div className="mt-3">{actionButtons("chat", report.id, report.status)}</div>
            </article>
          ))}
          {!loading && visibleChatReports.length === 0 ? <p className="rounded-xl border border-neutral-200 bg-white p-5 text-sm text-neutral-500">해당하는 채팅 신고가 없습니다.</p> : null}
        </div>
      ) : null}

      {kind === "community" ? <AdminCommunityModerationPanel /> : null}
    </div>
  );
}
