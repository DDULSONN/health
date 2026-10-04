"use client";

import { useRef, useState } from "react";
import { fetchClientJson } from "@/lib/client-json-request";

type Props = {
  swipeId: string;
  createdAt: string;
  canLike: boolean;
  canDelete: boolean;
  unavailableReason?: string | null;
  onLike: () => Promise<void>;
  onDeleted: (swipeId: string) => void;
  onRefresh: () => Promise<void>;
};

export default function IncomingSwipeLikeActions({
  swipeId, createdAt, canLike, canDelete, unavailableReason, onLike, onDeleted, onRefresh,
}: Props) {
  const lock = useRef(false);
  const [busy, setBusy] = useState<"like" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const act = async (action: "like" | "delete") => {
    if (lock.current || (action === "like" ? !canLike : !canDelete)) return;
    lock.current = true;
    try {
      if (action === "delete" && !window.confirm(
        "받은 라이크를 삭제할까요?\n내 받은 라이크 목록에서만 삭제됩니다. 상대방 차단이나 기존 매칭 취소는 되지 않습니다."
      )) return;
      setError(null);
      setBusy(action);
      if (action === "like") {
        await onLike();
        return;
      }
      const { response: res, body } = await fetchClientJson<{ ok?: boolean; error?: string }>(`/api/dating/cards/my/incoming-swipes/${encodeURIComponent(swipeId)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ created_at: createdAt }),
      }, 12000);
      if (!res.ok || body?.ok !== true) {
        if (res.status === 404) await onRefresh().catch(() => undefined);
        throw new Error(body?.error ?? "삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      }
      onDeleted(swipeId);
    } catch (cause) {
      setError(cause instanceof Error && cause.name !== "AbortError" && cause.name !== "TypeError" && cause.message
        ? cause.message : "처리하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      lock.current = false;
      setBusy(null);
    }
  };

  return (
    <div className="mt-3">
      <div className="flex flex-wrap gap-2">
        {canLike && (
          <button type="button" disabled={busy !== null} onClick={() => void act("like")}
            className="min-h-11 rounded-md bg-pink-500 px-3 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-50">
            {busy === "like" ? "처리 중..." : "바로 라이크"}
          </button>
        )}
        {canDelete && (
          <button type="button" disabled={busy !== null} onClick={() => void act("delete")}
            className="min-h-11 min-w-11 rounded-md border border-neutral-300 bg-white px-3 text-xs font-medium text-neutral-600 hover:bg-neutral-50 disabled:opacity-50">
            {busy === "delete" ? "삭제 중..." : "삭제"}
          </button>
        )}
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-neutral-500">
        {unavailableReason || (canLike ? "맞라이크하면 쌍방 매칭이 될 수 있어요." : "지금은 맞라이크를 진행할 수 없어요.")}
      </p>
      {error && <p role="alert" className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}
