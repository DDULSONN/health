"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type FitRoomKind = "workout" | "diet" | "body";
type Reaction = "up" | "down" | null;

type FitRoomComment = {
  id: string;
  content: string;
  createdAt: string;
  canDelete: boolean;
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
  featured?: FitRoomEntry | null;
  items?: FitRoomEntry[];
  liveComments?: Array<{
    id: string;
    entryId: string;
    content: string;
    createdAt: string;
    entryKind: FitRoomKind;
    author: {
      userId: string;
      nickname: string;
      isBanned: boolean;
    };
  }>;
  error?: string;
};

const KIND_LABEL: Record<FitRoomKind, string> = {
  workout: "운동 인증",
  diet: "식단 인증",
  body: "몸 변화",
};

const KIND_GRADIENT: Record<FitRoomKind, string> = {
  workout: "from-emerald-300 via-cyan-300 to-sky-400",
  diet: "from-lime-300 via-emerald-300 to-teal-400",
  body: "from-rose-300 via-fuchsia-300 to-violet-400",
};

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

export default function FitRoomPage() {
  const [items, setItems] = useState<FitRoomEntry[]>([]);
  const [featured, setFeatured] = useState<FitRoomEntry | null>(null);
  const [liveComments, setLiveComments] = useState<FitRoomResponse["liveComments"]>([]);
  const [viewer, setViewer] = useState({ loggedIn: false, userId: null as string | null, isAdmin: false });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [setupRequired, setSetupRequired] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);
  const [kind, setKind] = useState<FitRoomKind>("workout");
  const [caption, setCaption] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [processingKey, setProcessingKey] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const hotItems = useMemo(
    () => [...items].sort((a, b) => b.reactions.score - a.reactions.score || Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 6),
    [items]
  );

  const loadRoom = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    if (silent) setRefreshing(true);
    try {
      const res = await fetch("/api/community/fit-room", { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as FitRoomResponse;
      if (res.status === 401 || res.status === 403) {
        setAccessDenied(true);
        setError(body.error ?? "관리자만 볼 수 있는 실험 기능입니다.");
        return;
      }
      if (!res.ok || !body.ok) throw new Error(body.error ?? "인증방을 불러오지 못했습니다.");
      setItems(body.items ?? []);
      setFeatured(body.featured ?? null);
      setLiveComments(body.liveComments ?? []);
      setSetupRequired(Boolean(body.setupRequired));
      setViewer({
        loggedIn: Boolean(body.viewer?.loggedIn),
        userId: body.viewer?.userId ?? null,
        isAdmin: Boolean(body.viewer?.isAdmin),
      });
      setAccessDenied(false);
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

  const submitEntry = async () => {
    if (!viewer.isAdmin) {
      window.alert("관리자만 등록할 수 있습니다.");
      return;
    }
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
    if (!viewer.isAdmin) return;
    const nextReaction = entry.reactions.mine === reaction ? "none" : reaction;
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

  const submitComment = async (entryId: string) => {
    if (!viewer.isAdmin) return;
    const content = (commentDrafts[entryId] ?? "").trim();
    if (!content) return;
    setProcessingKey(`comment:${entryId}`);
    try {
      const res = await fetch(`/api/community/fit-room/${entryId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error ?? "댓글 등록에 실패했습니다.");
      setCommentDrafts((prev) => ({ ...prev, [entryId]: "" }));
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

  const banUser = async (userId: string, nickname: string) => {
    const reason = window.prompt(`${nickname} 회원을 커뮤니티 이용 제한 처리할까요? 사유를 입력해 주세요.`, "인증방 운영 정책 위반");
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

  if (!loading && accessDenied) {
    return (
      <main className="min-h-screen bg-[#050712] px-4 py-8 text-white">
        <div className="mx-auto max-w-xl rounded-[32px] border border-white/10 bg-white/[0.08] p-6 text-center shadow-2xl shadow-black/20">
          <p className="text-sm font-black text-emerald-300">LIVE 인증방</p>
          <h1 className="mt-3 text-2xl font-black">관리자 전용 실험 기능입니다</h1>
          <p className="mt-3 text-sm leading-6 text-white/60">{error || "현재는 관리자만 확인할 수 있습니다."}</p>
          <Link href="/community" className="mt-5 inline-flex rounded-full bg-white px-5 py-3 text-sm font-black text-neutral-950">
            커뮤니티로 돌아가기
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen overflow-hidden bg-[#050712] text-white">
      <div className="pointer-events-none fixed inset-0 opacity-80">
        <div className="absolute left-[-120px] top-[-120px] h-80 w-80 rounded-full bg-emerald-400/25 blur-3xl" />
        <div className="absolute right-[-160px] top-24 h-96 w-96 rounded-full bg-fuchsia-500/20 blur-3xl" />
        <div className="absolute bottom-[-140px] left-1/3 h-96 w-96 rounded-full bg-sky-500/20 blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-6xl px-4 py-5 pb-20">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/community" className="rounded-full border border-white/10 bg-white/10 px-4 py-2 text-sm font-black text-white backdrop-blur">
            커뮤니티로
          </Link>
          <button
            type="button"
            onClick={() => void loadRoom(true)}
            className="rounded-full border border-white/10 bg-white/10 px-4 py-2 text-sm font-bold text-white/80 backdrop-blur hover:bg-white/15"
          >
            {refreshing ? "동기화 중" : "새로고침"}
          </button>
        </header>

        <section className="mt-8 grid gap-5 lg:grid-cols-[1.1fr_0.9fr] lg:items-end">
          <div>
            <p className="text-sm font-black text-emerald-300">ADMIN ONLY · 24시간 인증방</p>
            <h1 className="mt-3 max-w-2xl text-4xl font-black leading-tight tracking-tight sm:text-6xl">
              식단과 운동 인증이 흐르는 실시간 방
            </h1>
            <p className="mt-4 max-w-xl text-sm leading-7 text-white/60">
              현재는 관리자만 확인하는 실험 버전입니다. 사진은 24시간 뒤 자동으로 사라지고, 댓글과 추천 반응까지 한 화면에서 관리할 수 있어요.
            </p>
          </div>

          <div className="rounded-[32px] border border-white/10 bg-white/[0.08] p-4 shadow-2xl shadow-black/20 backdrop-blur-xl">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-black text-white">지금 인증 올리기</p>
                <p className="mt-1 text-xs text-white/50">운동, 식단, 몸 변화 기록을 사진으로 테스트해보세요.</p>
              </div>
              <span className="rounded-full bg-emerald-300 px-3 py-1 text-xs font-black text-neutral-950">24H</span>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2">
              {(["workout", "diet", "body"] as FitRoomKind[]).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setKind(item)}
                  className={`rounded-2xl px-3 py-3 text-xs font-black transition ${
                    kind === item ? "bg-white text-neutral-950" : "bg-white/10 text-white/70 hover:bg-white/15"
                  }`}
                >
                  {KIND_LABEL[item]}
                </button>
              ))}
            </div>
            <label className="mt-3 flex min-h-[150px] cursor-pointer items-center justify-center overflow-hidden rounded-[28px] border border-dashed border-white/20 bg-black/20 text-center text-sm text-white/50">
              {previewUrl ? (
                <img src={previewUrl} alt="업로드 미리보기" loading="lazy" decoding="async" className="h-full max-h-[260px] w-full object-cover" />
              ) : (
                <span>사진 선택</span>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            </label>
            <textarea
              value={caption}
              onChange={(event) => setCaption(event.target.value.slice(0, 180))}
              placeholder="짧게 남기기: 오늘 하체 완료, 식단 성공, 유산소 40분..."
              className="mt-3 min-h-[86px] w-full resize-none rounded-3xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-white outline-none placeholder:text-white/35 focus:border-emerald-300"
            />
            <button
              type="button"
              disabled={uploading || setupRequired}
              onClick={() => void submitEntry()}
              className="mt-3 min-h-[48px] w-full rounded-2xl bg-white text-sm font-black text-neutral-950 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {setupRequired ? "DB 적용 후 사용 가능" : uploading ? "업로드 중..." : "인증 올리기"}
            </button>
          </div>
        </section>

        {setupRequired ? (
          <p className="mt-5 rounded-2xl border border-amber-300/30 bg-amber-400/10 p-4 text-sm text-amber-100">
            Supabase에서 <span className="font-black">supabase/sql/community_fit_room.sql</span>을 먼저 실행하면 업로드가 활성화됩니다.
          </p>
        ) : null}
        {error ? <p className="mt-5 rounded-2xl border border-rose-400/30 bg-rose-500/10 p-4 text-sm text-rose-100">{error}</p> : null}

        {featured ? (
          <section className="mt-8 rounded-[36px] border border-white/10 bg-white/[0.07] p-4 backdrop-blur-xl md:p-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-black text-emerald-300">지금 가장 반응 좋은 인증</p>
                <p className="mt-1 text-lg font-black text-white">추천을 많이 받은 사진은 크게 보여줘요</p>
              </div>
              <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-neutral-950">
                점수 {featured.reactions.score}
              </span>
            </div>
            <FitRoomCard
              entry={featured}
              large
              viewerIsAdmin={viewer.isAdmin}
              processingKey={processingKey}
              commentDraft={commentDrafts[featured.id] ?? ""}
              onCommentChange={(value) => setCommentDrafts((prev) => ({ ...prev, [featured.id]: value }))}
              onReact={reactToEntry}
              onComment={submitComment}
              onDelete={deleteEntry}
              onDeleteComment={deleteComment}
              onBan={banUser}
            />
          </section>
        ) : null}

        <section className="mt-8 grid gap-5 lg:grid-cols-[1fr_320px]">
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-xl font-black">실시간 인증 흐름</h2>
              <p className="text-xs text-white/40">{loading ? "불러오는 중" : `${items.length}개 표시 중`}</p>
            </div>
            {loading ? (
              <p className="rounded-[28px] border border-white/10 bg-white/[0.06] p-5 text-sm text-white/55">인증 사진을 불러오는 중...</p>
            ) : items.length === 0 ? (
              <p className="rounded-[28px] border border-white/10 bg-white/[0.06] p-5 text-sm text-white/55">아직 올라온 인증이 없어요. 테스트 사진을 올려보세요.</p>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {items.map((entry) => (
                  <FitRoomCard
                    key={entry.id}
                    entry={entry}
                    viewerIsAdmin={viewer.isAdmin}
                    processingKey={processingKey}
                    commentDraft={commentDrafts[entry.id] ?? ""}
                    onCommentChange={(value) => setCommentDrafts((prev) => ({ ...prev, [entry.id]: value }))}
                    onReact={reactToEntry}
                    onComment={submitComment}
                    onDelete={deleteEntry}
                    onDeleteComment={deleteComment}
                    onBan={banUser}
                  />
                ))}
              </div>
            )}
          </div>

          <aside className="space-y-4">
            <div className="rounded-[30px] border border-white/10 bg-white/[0.07] p-4 backdrop-blur-xl">
              <p className="text-sm font-black">추천 많은 사진</p>
              <div className="mt-3 space-y-2">
                {hotItems.length === 0 ? (
                  <p className="text-sm text-white/45">아직 추천 데이터가 없어요.</p>
                ) : (
                  hotItems.map((entry, index) => (
                    <div key={entry.id} className="flex items-center gap-3 rounded-2xl bg-white/10 p-2">
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-xs font-black text-neutral-950">{index + 1}</span>
                      <img src={entry.imageUrl} alt="" loading="lazy" decoding="async" className="h-10 w-10 rounded-xl object-cover" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-black text-white">{entry.author.nickname}</p>
                        <p className="text-[11px] text-white/45">점수 {entry.reactions.score} · {KIND_LABEL[entry.kind]}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-[30px] border border-white/10 bg-white/[0.07] p-4 backdrop-blur-xl">
              <p className="text-sm font-black">실시간 댓글</p>
              <div className="mt-3 space-y-2">
                {(liveComments ?? []).length === 0 ? (
                  <p className="text-sm text-white/45">댓글이 올라오면 여기에 모입니다.</p>
                ) : (
                  (liveComments ?? []).map((comment) => (
                    <div key={comment.id} className="rounded-2xl bg-black/20 p-3">
                      <p className="text-[11px] font-bold text-emerald-200">{comment.author.nickname} · {KIND_LABEL[comment.entryKind]}</p>
                      <p className="mt-1 text-xs leading-5 text-white/75">{comment.content}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}

function FitRoomCard({
  entry,
  large = false,
  viewerIsAdmin,
  processingKey,
  commentDraft,
  onCommentChange,
  onReact,
  onComment,
  onDelete,
  onDeleteComment,
  onBan,
}: {
  entry: FitRoomEntry;
  large?: boolean;
  viewerIsAdmin: boolean;
  processingKey: string | null;
  commentDraft: string;
  onCommentChange: (value: string) => void;
  onReact: (entry: FitRoomEntry, reaction: "up" | "down") => void;
  onComment: (entryId: string) => void;
  onDelete: (entry: FitRoomEntry) => void;
  onDeleteComment: (comment: FitRoomComment) => void;
  onBan: (userId: string, nickname: string) => void;
}) {
  return (
    <article className="group overflow-hidden rounded-[32px] border border-white/10 bg-white/[0.075] shadow-2xl shadow-black/10 backdrop-blur-xl">
      <div className={`relative overflow-hidden ${large ? "min-h-[440px]" : "min-h-[310px]"}`}>
        <img
          src={entry.imageUrl}
          alt={entry.caption || KIND_LABEL[entry.kind]}
          loading="lazy"
          decoding="async"
          className={`h-full w-full object-cover ${large ? "max-h-[620px]" : "max-h-[420px]"}`}
        />
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full bg-gradient-to-r ${KIND_GRADIENT[entry.kind]} px-3 py-1 text-[11px] font-black text-neutral-950`}>
              {KIND_LABEL[entry.kind]}
            </span>
            <span className="rounded-full bg-white/15 px-3 py-1 text-[11px] font-bold text-white backdrop-blur">{remainingLabel(entry.expiresAt)}</span>
          </div>
          <p className="mt-2 text-sm font-black text-white">{entry.author.nickname}</p>
          {entry.caption ? <p className="mt-1 text-sm leading-6 text-white/85">{entry.caption}</p> : null}
        </div>
      </div>

      <div className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-white/45">{timeAgo(entry.createdAt)} · 24시간 뒤 자동 삭제</p>
          <div className="flex flex-wrap gap-2">
            {(entry.canDelete || viewerIsAdmin) && (
              <button
                type="button"
                disabled={processingKey !== null}
                onClick={() => onDelete(entry)}
                className="rounded-full border border-rose-300/30 bg-rose-500/10 px-3 py-1 text-[11px] font-bold text-rose-100 disabled:opacity-50"
              >
                사진 삭제
              </button>
            )}
            {viewerIsAdmin && (
              <button
                type="button"
                disabled={processingKey !== null || entry.author.isBanned}
                onClick={() => onBan(entry.author.userId, entry.author.nickname)}
                className="rounded-full border border-amber-300/30 bg-amber-500/10 px-3 py-1 text-[11px] font-bold text-amber-100 disabled:opacity-50"
              >
                유저 밴
              </button>
            )}
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={processingKey !== null}
            onClick={() => onReact(entry, "up")}
            className={`min-h-[42px] rounded-2xl text-sm font-black transition disabled:opacity-50 ${
              entry.reactions.mine === "up" ? "bg-emerald-300 text-neutral-950" : "bg-white/10 text-white hover:bg-white/15"
            }`}
          >
            추천 {entry.reactions.up}
          </button>
          <button
            type="button"
            disabled={processingKey !== null}
            onClick={() => onReact(entry, "down")}
            className={`min-h-[42px] rounded-2xl text-sm font-black transition disabled:opacity-50 ${
              entry.reactions.mine === "down" ? "bg-rose-300 text-neutral-950" : "bg-white/10 text-white hover:bg-white/15"
            }`}
          >
            비추천 {entry.reactions.down}
          </button>
        </div>

        <div className="mt-4 space-y-2">
          {entry.comments.length === 0 ? (
            <p className="rounded-2xl bg-black/20 p-3 text-xs text-white/40">아직 댓글이 없어요. 첫 반응을 남겨보세요.</p>
          ) : (
            entry.comments.map((comment) => (
              <div key={comment.id} className="rounded-2xl bg-black/20 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] font-black text-white/70">{comment.author.nickname} · {timeAgo(comment.createdAt)}</p>
                  {(comment.canDelete || viewerIsAdmin) && (
                    <button
                      type="button"
                      disabled={processingKey !== null}
                      onClick={() => onDeleteComment(comment)}
                      className="text-[11px] font-bold text-rose-200 disabled:opacity-50"
                    >
                      삭제
                    </button>
                  )}
                </div>
                <p className="mt-1 text-xs leading-5 text-white/80">{comment.content}</p>
              </div>
            ))
          )}
        </div>

        <div className="mt-3 flex gap-2">
          <input
            value={commentDraft}
            onChange={(event) => onCommentChange(event.target.value.slice(0, 220))}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void onComment(entry.id);
              }
            }}
            placeholder="댓글 쓰기"
            className="min-h-[42px] min-w-0 flex-1 rounded-2xl border border-white/10 bg-black/25 px-4 text-sm text-white outline-none placeholder:text-white/35 focus:border-emerald-300"
          />
          <button
            type="button"
            disabled={processingKey !== null || !commentDraft.trim()}
            onClick={() => void onComment(entry.id)}
            className="min-h-[42px] rounded-2xl bg-white px-4 text-xs font-black text-neutral-950 disabled:opacity-50"
          >
            전송
          </button>
        </div>
      </div>
    </article>
  );
}
