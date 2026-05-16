"use client";

import Link from "next/link";
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";

type FitRoomKind = "workout" | "diet" | "body";
type Reaction = "up" | "down" | null;

type FitRoomComment = {
  id: string;
  content: string;
  createdAt: string;
  canDelete: boolean;
  reportCount: number;
  reportedByMe: boolean;
  author: {
    userId: string;
    nickname: string;
    isBanned: boolean;
  };
};

type FitRoomEntry = {
  id: string;
  kind: FitRoomKind;
  caption: string;
  imageUrl: string;
  createdAt: string;
  expiresAt: string;
  canDelete: boolean;
  reportCount: number;
  reportedByMe: boolean;
  author: {
    userId: string;
    nickname: string;
    isBanned: boolean;
  };
  reactions: {
    up: number;
    down: number;
    score: number;
    mine: Reaction;
  };
  comments: FitRoomComment[];
};

type FitRoomResponse = {
  ok?: boolean;
  setupRequired?: boolean;
  viewer?: {
    loggedIn: boolean;
    userId: string | null;
    isAdmin: boolean;
  };
  items?: FitRoomEntry[];
  error?: string;
};

const KIND_LABEL: Record<FitRoomKind, string> = {
  workout: "운동",
  diet: "식단",
  body: "변화",
};

const KIND_ACTION: Record<FitRoomKind, string> = {
  workout: "운동 인증",
  diet: "식단 인증",
  body: "변화 기록",
};

const KIND_RING: Record<FitRoomKind, string> = {
  workout: "from-emerald-300 via-cyan-200 to-white",
  diet: "from-lime-300 via-emerald-200 to-white",
  body: "from-rose-300 via-fuchsia-200 to-white",
};

const KIND_TEXT: Record<FitRoomKind, string> = {
  workout: "text-emerald-100",
  diet: "text-lime-100",
  body: "text-rose-100",
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function hashString(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function timeAgo(raw: string) {
  const diff = Date.now() - Date.parse(raw);
  if (!Number.isFinite(diff)) return "";
  const minutes = Math.max(0, Math.floor(diff / 60000));
  if (minutes < 1) return "방금";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  return `${Math.floor(hours / 24)}일 전`;
}

function remainingLabel(raw: string) {
  const diff = Date.parse(raw) - Date.now();
  if (!Number.isFinite(diff) || diff <= 0) return "곧 사라짐";
  const hours = Math.floor(diff / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  if (hours <= 0) return `${minutes}분 남음`;
  return `${hours}시간 ${minutes}분 남음`;
}

function getLoginUrl() {
  if (typeof window === "undefined") return "/login";
  return `/login?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`;
}

function requireLogin(loggedIn: boolean) {
  if (loggedIn) return true;
  if (window.confirm("로그인 후 이용할 수 있어요. 로그인하러 갈까요?")) {
    window.location.href = getLoginUrl();
  }
  return false;
}

function getDesktopOrbitStyle(entry: FitRoomEntry, index: number): CSSProperties {
  const hash = hashString(entry.id);
  const score = Math.max(0, entry.reactions.score);
  const size = clamp(116 + score * 20 + entry.comments.length * 7, 112, 310);
  const angle = ((index * 137.5 + (hash % 36)) * Math.PI) / 180;
  const ring = 170 + (index % 5) * 82 + ((hash >> 3) % 42);
  const gravity = clamp(score * 18, 0, 170);
  const radius = Math.max(80, ring - gravity);
  const centerX = 520;
  const centerY = 360;

  return {
    left: centerX + Math.cos(angle) * radius - size / 2,
    top: centerY + Math.sin(angle) * radius * 0.72 - size / 2,
    width: size,
    height: size,
    zIndex: 20 + score,
  };
}

function getMobileOrbitStyle(entry: FitRoomEntry, index: number): CSSProperties {
  const hash = hashString(entry.id);
  const score = Math.max(0, entry.reactions.score);
  const size = clamp(94 + score * 15 + entry.comments.length * 5, 88, 190);
  const lane = index % 3;
  const leftMap = [18, 50, 82];
  const top = 42 + index * 108 - Math.min(score * 10, 62) + ((hash >> 5) % 24);

  return {
    left: `${leftMap[lane]}%`,
    top,
    width: size,
    height: size,
    transform: "translateX(-50%)",
    zIndex: 20 + score,
  };
}

export default function FitRoomPage() {
  const [items, setItems] = useState<FitRoomEntry[]>([]);
  const [viewer, setViewer] = useState({ loggedIn: false, userId: null as string | null, isAdmin: false });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [setupRequired, setSetupRequired] = useState(false);
  const [kind, setKind] = useState<FitRoomKind>("workout");
  const [caption, setCaption] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState("");
  const [processingKey, setProcessingKey] = useState<string | null>(null);
  const [activePulseId, setActivePulseId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const sortedItems = useMemo(
    () => [...items].sort((a, b) => b.reactions.score - a.reactions.score || Date.parse(b.createdAt) - Date.parse(a.createdAt)),
    [items],
  );

  const selectedEntry = useMemo(
    () => items.find((entry) => entry.id === selectedEntryId) ?? sortedItems[0] ?? null,
    [items, selectedEntryId, sortedItems],
  );

  const desktopHeight = useMemo(() => clamp(720 + Math.floor(items.length / 9) * 180, 720, 1320), [items.length]);
  const mobileHeight = useMemo(() => Math.max(520, items.length * 108 + 240), [items.length]);

  const loadRoom = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    if (silent) setRefreshing(true);
    try {
      const res = await fetch("/api/community/fit-room", { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as FitRoomResponse;
      if (!res.ok || !body.ok) throw new Error(body.error ?? "인증방을 불러오지 못했습니다.");
      setItems(body.items ?? []);
      setSetupRequired(Boolean(body.setupRequired));
      setViewer({
        loggedIn: Boolean(body.viewer?.loggedIn),
        userId: body.viewer?.userId ?? null,
        isAdmin: Boolean(body.viewer?.isAdmin),
      });
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "인증방을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadRoom();
    const timer = window.setInterval(() => void loadRoom(true), 60_000);
    return () => window.clearInterval(timer);
  }, [loadRoom]);

  useEffect(() => {
    if (!file) {
      setPreviewUrl("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const selectEntry = (entryId: string) => {
    setSelectedEntryId(entryId);
    setCommentDraft("");
    setActivePulseId(entryId);
    window.setTimeout(() => setActivePulseId((current) => (current === entryId ? null : current)), 720);
  };

  const submitEntry = async () => {
    if (!requireLogin(viewer.loggedIn)) return;
    if (!file) {
      window.alert("사진을 먼저 선택해 주세요.");
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("kind", kind);
      form.append("caption", caption);
      const res = await fetch("/api/community/fit-room", {
        method: "POST",
        body: form,
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error ?? "인증 등록에 실패했습니다.");
      setCaption("");
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await loadRoom(true);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "인증 등록에 실패했습니다.");
    } finally {
      setUploading(false);
    }
  };

  const reactToEntry = async (entry: FitRoomEntry, reaction: "up" | "down") => {
    if (!requireLogin(viewer.loggedIn)) return;
    const nextReaction = entry.reactions.mine === reaction ? "none" : reaction;
    setActivePulseId(entry.id);
    setProcessingKey(`reaction:${entry.id}`);
    try {
      const res = await fetch(`/api/community/fit-room/${entry.id}/reaction`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reaction: nextReaction }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error ?? "반응 저장에 실패했습니다.");
      await loadRoom(true);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "반응 저장에 실패했습니다.");
    } finally {
      setProcessingKey(null);
    }
  };

  const submitComment = async () => {
    if (!requireLogin(viewer.loggedIn) || !selectedEntry) return;
    const content = commentDraft.trim();
    if (!content) return;
    setProcessingKey(`comment:${selectedEntry.id}`);
    try {
      const res = await fetch(`/api/community/fit-room/${selectedEntry.id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error ?? "댓글 등록에 실패했습니다.");
      setCommentDraft("");
      await loadRoom(true);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "댓글 등록에 실패했습니다.");
    } finally {
      setProcessingKey(null);
    }
  };

  const deleteEntry = async (entry: FitRoomEntry) => {
    if (!window.confirm("이 인증 사진을 삭제할까요?")) return;
    setProcessingKey(`delete:${entry.id}`);
    try {
      const res = await fetch(`/api/community/fit-room/${entry.id}`, { method: "DELETE" });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error ?? "삭제에 실패했습니다.");
      if (selectedEntryId === entry.id) setSelectedEntryId(null);
      await loadRoom(true);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "삭제에 실패했습니다.");
    } finally {
      setProcessingKey(null);
    }
  };

  const deleteComment = async (comment: FitRoomComment) => {
    setProcessingKey(`delete-comment:${comment.id}`);
    try {
      const res = await fetch(`/api/community/fit-room/comments/${comment.id}`, { method: "DELETE" });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error ?? "댓글 삭제에 실패했습니다.");
      await loadRoom(true);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "댓글 삭제에 실패했습니다.");
    } finally {
      setProcessingKey(null);
    }
  };

  const reportEntry = async (entry: FitRoomEntry) => {
    if (!requireLogin(viewer.loggedIn)) return;
    const detail = window.prompt("신고 사유를 간단히 입력해 주세요. 운영자가 확인합니다.");
    if (detail === null) return;
    const cleanDetail = detail.trim();
    if (!cleanDetail) {
      window.alert("신고 사유를 입력해 주세요.");
      return;
    }
    setProcessingKey(`report:${entry.id}`);
    try {
      const res = await fetch(`/api/community/fit-room/${entry.id}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "other", detail: cleanDetail }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; message?: string };
      if (!res.ok || !body.ok) throw new Error(body.error ?? "신고 접수에 실패했습니다.");
      window.alert(body.message ?? "신고가 접수되었습니다.");
      await loadRoom(true);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "신고 접수에 실패했습니다.");
    } finally {
      setProcessingKey(null);
    }
  };

  const reportComment = async (comment: FitRoomComment) => {
    if (!requireLogin(viewer.loggedIn)) return;
    const detail = window.prompt("댓글 신고 사유를 간단히 입력해 주세요. 운영자가 확인합니다.");
    if (detail === null) return;
    const cleanDetail = detail.trim();
    if (!cleanDetail) {
      window.alert("신고 사유를 입력해 주세요.");
      return;
    }
    setProcessingKey(`report-comment:${comment.id}`);
    try {
      const res = await fetch(`/api/community/fit-room/comments/${comment.id}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "other", detail: cleanDetail }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; message?: string };
      if (!res.ok || !body.ok) throw new Error(body.error ?? "신고 접수에 실패했습니다.");
      window.alert(body.message ?? "신고가 접수되었습니다.");
      await loadRoom(true);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "신고 접수에 실패했습니다.");
    } finally {
      setProcessingKey(null);
    }
  };

  const banUser = async (userId: string, nickname: string) => {
    const reason = window.prompt(`${nickname} 회원의 커뮤니티 이용을 제한할까요? 사유를 입력해 주세요.`, "커뮤니티 운영 정책 위반");
    if (reason === null) return;
    setProcessingKey(`ban:${userId}`);
    try {
      const res = await fetch(`/api/admin/community/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_banned: true, reason }),
      });
      if (!res.ok) throw new Error("유저 밴 처리에 실패했습니다.");
      await loadRoom(true);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "유저 밴 처리에 실패했습니다.");
    } finally {
      setProcessingKey(null);
    }
  };

  return (
    <main className="min-h-screen overflow-hidden bg-[#03040a] text-white">
      <div className="pointer-events-none fixed inset-0">
        <div className="fit-room-aurora absolute inset-0 bg-[radial-gradient(circle_at_50%_38%,rgba(255,255,255,0.08),transparent_18%),radial-gradient(circle_at_15%_20%,rgba(16,185,129,0.22),transparent_28%),radial-gradient(circle_at_85%_24%,rgba(217,70,239,0.20),transparent_30%),radial-gradient(circle_at_45%_90%,rgba(6,182,212,0.18),transparent_34%)]" />
        <div className="absolute inset-0 opacity-[0.23] [background-image:radial-gradient(rgba(255,255,255,.55)_1px,transparent_1px)] [background-size:38px_38px]" />
      </div>
      <style jsx global>{`
        @keyframes fit-room-drift {
          0%,
          100% {
            transform: translate3d(var(--float-x, 0px), 0, 0) rotate(-1.5deg);
          }
          50% {
            transform: translate3d(calc(var(--float-x, 0px) * -1), var(--float-y, -8px), 0) rotate(1.5deg);
          }
        }

        @keyframes fit-room-pop {
          0% {
            transform: scale(0.72);
            opacity: 0;
          }
          58% {
            transform: scale(1.13);
            opacity: 1;
          }
          100% {
            transform: scale(1);
            opacity: 1;
          }
        }

        @keyframes fit-room-pulse {
          0% {
            opacity: 0.9;
            transform: scale(0.84);
          }
          100% {
            opacity: 0;
            transform: scale(1.72);
          }
        }

        @keyframes fit-room-panel-in {
          0% {
            opacity: 0;
            transform: translateY(12px) scale(0.98);
          }
          100% {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }

        @keyframes fit-room-aurora {
          0% {
            background-position: 0% 50%;
          }
          50% {
            background-position: 100% 50%;
          }
          100% {
            background-position: 0% 50%;
          }
        }

        .fit-room-orb {
          animation: fit-room-drift 5.8s ease-in-out infinite;
          touch-action: manipulation;
          will-change: transform;
        }

        .fit-room-orb-inner {
          animation: fit-room-pop 420ms cubic-bezier(0.2, 0.9, 0.2, 1) both;
        }

        .fit-room-orb-selected .fit-room-orb-glow,
        .fit-room-orb-pulse .fit-room-orb-glow {
          animation: fit-room-pulse 760ms ease-out both;
        }

        .fit-room-panel {
          animation: fit-room-panel-in 220ms ease-out both;
        }

        .fit-room-aurora {
          background-size: 180% 180%;
          animation: fit-room-aurora 7s ease infinite;
        }

        @media (prefers-reduced-motion: reduce) {
          .fit-room-orb,
          .fit-room-orb-inner,
          .fit-room-orb-glow,
          .fit-room-panel,
          .fit-room-aurora {
            animation: none !important;
          }
        }
      `}</style>

      <header className="relative z-30 mx-auto flex max-w-7xl items-center justify-between gap-3 px-3 py-4 sm:px-4 sm:py-5">
        <Link href="/" className="rounded-full border border-white/10 bg-white/10 px-4 py-2 text-sm font-black text-white backdrop-blur">
          홈
        </Link>
        <button
          type="button"
          onClick={() => void loadRoom(true)}
          className="rounded-full border border-white/10 bg-white/10 px-4 py-2 text-sm font-bold text-white/80 backdrop-blur hover:bg-white/15"
        >
          {refreshing ? "동기화 중" : "새로고침"}
        </button>
      </header>

      <section className="relative z-10 mx-auto max-w-7xl px-3 pb-8 sm:px-4 sm:pb-10">
        <div className="mb-3 rounded-[28px] border border-white/10 bg-neutral-950/55 p-3 shadow-2xl shadow-black/25 backdrop-blur-2xl">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="flex shrink-0 items-center justify-between gap-3 lg:w-[190px]">
              <div>
                <p className="text-xs font-black text-emerald-300">24시간 인증</p>
                <p className="mt-0.5 text-sm font-black text-white">{viewer.loggedIn ? "가볍게 올려봐요" : "로그인하면 참여 가능"}</p>
              </div>
              <span className="rounded-full bg-emerald-300 px-3 py-1 text-xs font-black text-neutral-950">24H</span>
            </div>

            <div className="flex gap-2 lg:w-[300px]">
              {(["workout", "diet", "body"] as FitRoomKind[]).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setKind(item)}
                  className={`min-h-[38px] flex-1 rounded-full text-xs font-black transition ${
                    kind === item ? "bg-white text-neutral-950" : "bg-white/10 text-white/65 hover:bg-white/15"
                  }`}
                >
                  {KIND_ACTION[item]}
                </button>
              ))}
            </div>

            <div className="grid flex-1 grid-cols-[76px_1fr] gap-2 sm:grid-cols-[88px_1fr_auto]">
              <label
                className={`relative flex h-16 cursor-pointer items-center justify-center overflow-hidden rounded-[20px] border border-dashed text-center text-xs transition active:scale-[0.98] sm:h-[58px] ${
                  previewUrl
                    ? "border-emerald-300/55 bg-emerald-300/10 text-emerald-50 shadow-[0_0_24px_rgba(16,185,129,.18)]"
                    : "border-white/20 bg-black/30 text-white/45 hover:border-white/35 hover:bg-white/5"
                }`}
              >
                {previewUrl ? (
                  <>
                    <img src={previewUrl} alt="업로드 미리보기" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                    <span className="absolute inset-x-1 bottom-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-black text-white backdrop-blur">
                      변경
                    </span>
                  </>
                ) : (
                  <span className="grid gap-0.5 px-1">
                    <span className="text-[11px] font-black text-white/80">사진 선택</span>
                    <span className="text-[10px] font-semibold text-white/40">운동·식단</span>
                  </span>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                />
              </label>
              <input
                value={caption}
                onChange={(event) => setCaption(event.target.value.slice(0, 180))}
                placeholder="짧게 남기기"
                className="min-h-16 min-w-0 rounded-[20px] border border-white/10 bg-black/25 px-3 text-sm text-white outline-none placeholder:text-white/35 focus:border-emerald-300 sm:min-h-[58px] sm:px-4"
              />
              <button
                type="button"
                disabled={uploading || setupRequired}
                onClick={() => void submitEntry()}
                className="col-span-2 min-h-[42px] rounded-full bg-white px-5 text-sm font-black text-neutral-950 transition hover:scale-[1.01] active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 sm:col-span-1 sm:min-h-[58px]"
              >
                {setupRequired ? "DB 필요" : uploading ? "올리는 중" : "올리기"}
              </button>
            </div>
          </div>
          {setupRequired ? (
            <p className="mt-3 rounded-2xl border border-amber-300/30 bg-amber-400/10 p-3 text-xs leading-5 text-amber-100">
              Supabase에서 supabase/sql/community_fit_room.sql을 먼저 실행해야 합니다.
            </p>
          ) : null}
          {error ? <p className="mt-3 rounded-2xl border border-rose-400/30 bg-rose-500/10 p-3 text-xs leading-5 text-rose-100">{error}</p> : null}
        </div>

        <div className="grid gap-3 lg:grid-cols-[1fr_330px]">
          <div className="rounded-[32px] border border-white/10 bg-black/20 shadow-2xl shadow-black/25 backdrop-blur-xl sm:rounded-[42px] lg:overflow-x-auto">
            <div className="relative overflow-hidden lg:hidden" style={{ height: mobileHeight }}>
              <div className="pointer-events-none absolute left-1/2 top-16 h-[calc(100%-7rem)] w-px -translate-x-1/2 bg-gradient-to-b from-transparent via-white/20 to-transparent" />
              <div className="pointer-events-none absolute left-[15%] top-28 h-[calc(100%-12rem)] w-px bg-gradient-to-b from-transparent via-emerald-300/15 to-transparent" />
              <div className="pointer-events-none absolute right-[15%] top-20 h-[calc(100%-11rem)] w-px bg-gradient-to-b from-transparent via-fuchsia-300/15 to-transparent" />
              <RoomStatus loading={loading} count={items.length} mobile />
              {!loading
                ? sortedItems.map((entry, index) => (
                    <OrbitPhoto
                      key={entry.id}
                      entry={entry}
                      selected={selectedEntryId === entry.id}
                      pulsing={activePulseId === entry.id}
                      style={getMobileOrbitStyle(entry, index)}
                      onSelect={() => selectEntry(entry.id)}
                    />
                  ))
                : null}
            </div>

            <div className="relative hidden min-w-[1040px] lg:block" style={{ height: desktopHeight }}>
              <div className="pointer-events-none absolute left-1/2 top-[360px] h-40 w-40 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/10 blur-2xl" />
              <div className="pointer-events-none absolute left-1/2 top-[360px] h-[540px] w-[540px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/10" />
              <div className="pointer-events-none absolute left-1/2 top-[360px] h-[780px] w-[780px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/[0.07]" />
              <RoomStatus loading={loading} count={items.length} />
              {!loading
                ? sortedItems.map((entry, index) => (
                    <OrbitPhoto
                      key={entry.id}
                      entry={entry}
                      selected={selectedEntryId === entry.id}
                      pulsing={activePulseId === entry.id}
                      style={getDesktopOrbitStyle(entry, index)}
                      onSelect={() => selectEntry(entry.id)}
                    />
                  ))
                : null}
            </div>
          </div>

          <EntryPanel
            entry={selectedEntry}
            commentDraft={commentDraft}
            processingKey={processingKey}
            viewerIsAdmin={viewer.isAdmin}
            viewerUserId={viewer.userId}
            viewerLoggedIn={viewer.loggedIn}
            onClose={() => setSelectedEntryId(null)}
            onCommentDraftChange={setCommentDraft}
            onSubmitComment={() => void submitComment()}
            onReact={(entry, reaction) => void reactToEntry(entry, reaction)}
            onDeleteEntry={(entry) => void deleteEntry(entry)}
            onDeleteComment={(comment) => void deleteComment(comment)}
            onReportEntry={(entry) => void reportEntry(entry)}
            onReportComment={(comment) => void reportComment(comment)}
            onBanUser={(userId, nickname) => void banUser(userId, nickname)}
          />
        </div>
      </section>
    </main>
  );
}

function RoomStatus({ loading, count, mobile = false }: { loading: boolean; count: number; mobile?: boolean }) {
  const label = loading ? "로딩" : count === 0 ? "아직 사진 없음" : `${count}개`;
  return <p className={`absolute ${mobile ? "left-4 top-4" : "left-8 top-8"} rounded-full bg-white/10 px-4 py-2 text-xs font-bold text-white/55`}>{label}</p>;
}

function OrbitPhoto({
  entry,
  selected,
  pulsing,
  style,
  onSelect,
}: {
  entry: FitRoomEntry;
  selected: boolean;
  pulsing: boolean;
  style: CSSProperties;
  onSelect: () => void;
}) {
  const hash = hashString(entry.id);
  const driftStyle = {
    ...style,
    "--float-x": `${(hash % 9) - 4}px`,
    "--float-y": `${-6 - (hash % 7)}px`,
    animationDelay: `${hash % 900}ms`,
  } as CSSProperties;

  return (
    <button
      type="button"
      style={driftStyle}
      onClick={onSelect}
      className={`fit-room-orb group absolute rounded-full text-left transition duration-500 hover:z-50 hover:scale-[1.08] active:scale-95 ${
        selected ? "fit-room-orb-selected z-50 scale-[1.08]" : ""
      } ${pulsing ? "fit-room-orb-pulse" : ""}`}
      aria-label={`${entry.author.nickname} ${KIND_LABEL[entry.kind]} 인증 보기`}
    >
      <span className="fit-room-orb-glow pointer-events-none absolute inset-[-18px] rounded-full bg-white/25" />
      <span
        className={`absolute inset-[-5px] rounded-full bg-gradient-to-br ${KIND_RING[entry.kind]} opacity-80 blur-[1px] transition duration-300 group-hover:opacity-100 ${
          selected ? "opacity-100 shadow-[0_0_46px_rgba(255,255,255,.28)]" : ""
        }`}
      />
      <span className="absolute inset-0 rounded-full bg-white/10 shadow-[0_0_44px_rgba(255,255,255,.18)]" />
      <span
        className={`fit-room-orb-inner relative block h-full w-full overflow-hidden rounded-full border bg-neutral-950 p-1.5 shadow-2xl shadow-black/45 transition duration-300 sm:p-2 ${
          selected ? "border-white/80" : "border-white/40"
        }`}
      >
        <img src={entry.imageUrl} alt={entry.caption || KIND_LABEL[entry.kind]} loading="lazy" decoding="async" className="h-full w-full rounded-full object-cover" />
        <span className="absolute inset-x-2 bottom-2 rounded-full bg-black/60 px-2 py-1 text-center text-[10px] font-black text-white backdrop-blur transition group-hover:bg-white group-hover:text-neutral-950 sm:inset-x-3 sm:bottom-3 sm:text-[11px]">
          추천 {entry.reactions.up}
        </span>
      </span>
    </button>
  );
}

function EntryPanel({
  entry,
  commentDraft,
  processingKey,
  viewerIsAdmin,
  viewerUserId,
  viewerLoggedIn,
  onClose,
  onCommentDraftChange,
  onSubmitComment,
  onReact,
  onDeleteEntry,
  onDeleteComment,
  onReportEntry,
  onReportComment,
  onBanUser,
}: {
  entry: FitRoomEntry | null;
  commentDraft: string;
  processingKey: string | null;
  viewerIsAdmin: boolean;
  viewerUserId: string | null;
  viewerLoggedIn: boolean;
  onClose: () => void;
  onCommentDraftChange: (value: string) => void;
  onSubmitComment: () => void;
  onReact: (entry: FitRoomEntry, reaction: "up" | "down") => void;
  onDeleteEntry: (entry: FitRoomEntry) => void;
  onDeleteComment: (comment: FitRoomComment) => void;
  onReportEntry: (entry: FitRoomEntry) => void;
  onReportComment: (comment: FitRoomComment) => void;
  onBanUser: (userId: string, nickname: string) => void;
}) {
  return (
    <aside className="fit-room-panel rounded-[28px] border border-white/10 bg-neutral-950/75 p-3 shadow-2xl shadow-black/30 backdrop-blur-2xl sm:rounded-[34px] sm:p-4 lg:sticky lg:top-5 lg:self-start">
      {entry ? (
        <>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className={`text-xs font-black ${KIND_TEXT[entry.kind]}`}>{KIND_LABEL[entry.kind]}</p>
              <h2 className="mt-1 text-xl font-black">{entry.author.nickname}</h2>
              <p className="mt-1 text-[11px] text-white/40">
                {remainingLabel(entry.expiresAt)} · {timeAgo(entry.createdAt)}
              </p>
              {viewerIsAdmin && entry.reportCount > 0 ? (
                <p className="mt-1 inline-flex rounded-full bg-rose-400/15 px-2 py-0.5 text-[11px] font-black text-rose-100">
                  신고 {entry.reportCount}건
                </p>
              ) : null}
            </div>
            <button type="button" onClick={onClose} className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold text-white/70">
              접기
            </button>
          </div>

          <a
            href={entry.imageUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-3 flex h-36 items-center justify-center overflow-hidden rounded-[24px] border border-white/10 bg-black/35 transition hover:border-white/25 sm:h-44"
            aria-label="인증 사진 원본 보기"
          >
            <img
              src={entry.imageUrl}
              alt={entry.caption || `${entry.author.nickname} ${KIND_LABEL[entry.kind]} 인증`}
              loading="lazy"
              decoding="async"
              className="max-h-full max-w-full object-contain"
            />
          </a>

          {entry.caption ? <p className="mt-3 rounded-2xl bg-white/5 p-3 text-sm leading-6 text-white/80">{entry.caption}</p> : null}

          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={processingKey !== null}
              onClick={() => onReact(entry, "up")}
              className={`min-h-[42px] rounded-2xl text-sm font-black transition active:scale-[0.96] disabled:opacity-50 ${
                entry.reactions.mine === "up" ? "bg-emerald-300 text-neutral-950" : "bg-white/10 text-white"
              }`}
            >
              추천 {entry.reactions.up}
            </button>
            <button
              type="button"
              disabled={processingKey !== null}
              onClick={() => onReact(entry, "down")}
              className={`min-h-[42px] rounded-2xl text-sm font-black transition active:scale-[0.96] disabled:opacity-50 ${
                entry.reactions.mine === "down" ? "bg-rose-300 text-neutral-950" : "bg-white/10 text-white"
              }`}
            >
              비추천 {entry.reactions.down}
            </button>
          </div>

          {viewerLoggedIn && entry.author.userId !== viewerUserId ? (
            <button
              type="button"
              disabled={processingKey !== null || entry.reportedByMe}
              onClick={() => onReportEntry(entry)}
              className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-bold text-white/55 transition hover:bg-white/10 disabled:opacity-45"
            >
              {entry.reportedByMe ? "신고 접수됨" : "문제 있는 사진 신고"}
            </button>
          ) : null}

          <div className="mt-3 max-h-56 space-y-2 overflow-y-auto pr-1">
            {entry.comments.length === 0 ? (
              <p className="rounded-2xl bg-white/5 p-3 text-xs text-white/40">댓글 없음</p>
            ) : (
              entry.comments.map((comment) => (
                <div key={comment.id} className="rounded-2xl bg-white/5 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] font-black text-white/60">
                      {comment.author.nickname}
                      {viewerIsAdmin && comment.reportCount > 0 ? <span className="ml-2 text-rose-200">신고 {comment.reportCount}</span> : null}
                    </p>
                    <div className="flex items-center gap-2">
                      {viewerLoggedIn && comment.author.userId !== viewerUserId ? (
                        <button
                          type="button"
                          disabled={processingKey !== null || comment.reportedByMe}
                          onClick={() => onReportComment(comment)}
                          className="text-[11px] font-bold text-white/45 disabled:opacity-40"
                        >
                          {comment.reportedByMe ? "신고됨" : "신고"}
                        </button>
                      ) : null}
                      {(comment.canDelete || viewerIsAdmin) && (
                        <button type="button" disabled={processingKey !== null} onClick={() => onDeleteComment(comment)} className="text-[11px] font-bold text-rose-200 disabled:opacity-50">
                          삭제
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-white/80">{comment.content}</p>
                </div>
              ))
            )}
          </div>

          <div className="mt-3 flex gap-2">
            <input
              value={commentDraft}
              onChange={(event) => onCommentDraftChange(event.target.value.slice(0, 220))}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  onSubmitComment();
                }
              }}
              placeholder={viewerLoggedIn ? "댓글" : "로그인 후 댓글"}
              className="min-h-[42px] min-w-0 flex-1 rounded-2xl border border-white/10 bg-black/25 px-4 text-sm text-white outline-none placeholder:text-white/35 focus:border-emerald-300"
            />
            <button
              type="button"
              disabled={processingKey !== null || !commentDraft.trim()}
              onClick={onSubmitComment}
              className="min-h-[42px] rounded-2xl bg-white px-4 text-xs font-black text-neutral-950 disabled:opacity-50"
            >
              전송
            </button>
          </div>

          {(entry.canDelete || viewerIsAdmin) && (
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                disabled={processingKey !== null}
                onClick={() => onDeleteEntry(entry)}
                className="min-h-[38px] flex-1 rounded-2xl border border-rose-300/30 bg-rose-500/10 text-xs font-bold text-rose-100 transition active:scale-[0.97] disabled:opacity-50"
              >
                {viewerIsAdmin && entry.author.userId !== viewerUserId ? "사진 삭제" : "내 사진 삭제"}
              </button>
              {viewerIsAdmin ? (
                <button
                  type="button"
                  disabled={processingKey !== null || entry.author.isBanned}
                  onClick={() => onBanUser(entry.author.userId, entry.author.nickname)}
                  className="min-h-[38px] flex-1 rounded-2xl border border-amber-300/30 bg-amber-500/10 text-xs font-bold text-amber-100 transition active:scale-[0.97] disabled:opacity-50"
                >
                  유저 밴
                </button>
              ) : null}
            </div>
          )}
        </>
      ) : (
        <div className="py-10 text-center">
          <p className="text-sm font-black text-white">사진 선택</p>
          <p className="mt-2 text-xs text-white/45">사진을 누르면 댓글과 추천을 볼 수 있어요.</p>
        </div>
      )}
    </aside>
  );
}
