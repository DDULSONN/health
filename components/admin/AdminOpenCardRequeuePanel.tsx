"use client";

import { useEffect, useState } from "react";

type OpenCard = Record<string, unknown>;

function statusLabel(status: string) {
  if (status === "public") return "공개 중";
  if (status === "pending") return "대기 중";
  if (status === "hidden") return "숨김";
  if (status === "expired") return "만료";
  return status || "상태 미확인";
}

export default function AdminOpenCardRequeuePanel({
  userId,
  cards,
  isBanned,
}: {
  userId: string;
  cards: OpenCard[];
  isBanned: boolean;
}) {
  const [items, setItems] = useState(cards);
  const [busyIds, setBusyIds] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  useEffect(() => setItems(cards), [cards]);

  const requeue = async (card: OpenCard) => {
    const cardId = String(card.id ?? "").trim();
    const cardName = String(card.display_nickname ?? "오픈카드").trim() || "오픈카드";
    const status = String(card.status ?? "");
    setError("");
    setInfo("");

    if (!userId || !cardId) {
      setError("회원 또는 오픈카드 정보를 찾지 못했습니다.");
      return;
    }
    if (!["hidden", "expired"].includes(status)) {
      setError("만료되었거나 숨김 처리된 오픈카드만 재등록할 수 있습니다.");
      return;
    }
    if (busyIds.includes(cardId)) return;
    if (!window.confirm(`${cardName} 카드를 기존 내용 그대로 대기열에 다시 등록할까요?`)) return;

    setBusyIds((current) => [...current, cardId]);
    try {
      const response = await fetch("/api/admin/dating/cards/requeue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, cardId }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        message?: string;
        card?: { id?: string; status?: string };
      };
      if (!response.ok || !body.ok || !body.card?.id) {
        throw new Error(body.error ?? "오픈카드 재등록에 실패했습니다.");
      }

      setItems((current) =>
        current.map((item) => (String(item.id ?? "") === cardId ? { ...item, status: "pending" } : item))
      );
      setInfo(body.message ?? "기존 오픈카드를 대기열에 다시 등록했습니다.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "오픈카드 재등록에 실패했습니다.");
    } finally {
      setBusyIds((current) => current.filter((id) => id !== cardId));
    }
  };

  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-emerald-900">오픈카드 재등록</p>
          <p className="mt-1 text-[11px] text-neutral-500">
            만료되었거나 숨김 처리된 기존 카드를 내용 변경 없이 대기열에 다시 등록합니다.
          </p>
        </div>
        <span className="rounded-full bg-white px-2 py-1 text-[11px] font-semibold text-emerald-800">
          {items.length.toLocaleString("ko-KR")}장
        </span>
      </div>

      {error ? <p className="mt-2 text-xs text-rose-600">{error}</p> : null}
      {info ? <p className="mt-2 text-xs text-emerald-700">{info}</p> : null}

      {items.length > 0 ? (
        <div className="mt-3 space-y-2">
          {items.slice(0, 10).map((card) => {
            const cardId = String(card.id ?? "");
            const status = String(card.status ?? "");
            const canRequeue = status === "hidden" || status === "expired";
            const busy = busyIds.includes(cardId);
            return (
              <div key={cardId} className="rounded-lg border border-emerald-100 bg-white px-3 py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-neutral-900">
                      {String(card.display_nickname ?? "오픈카드")} · {card.sex === "female" ? "여성" : "남성"}
                    </p>
                    <p className="mt-1 text-[11px] text-neutral-500">
                      {String(card.region ?? "지역 미입력")} · {statusLabel(status)}
                      {card.created_at ? ` · ${new Date(String(card.created_at)).toLocaleDateString("ko-KR")}` : ""}
                    </p>
                  </div>
                  {canRequeue ? (
                    <button
                      type="button"
                      disabled={busy || isBanned}
                      onClick={() => void requeue(card)}
                      className="h-8 rounded-lg bg-emerald-600 px-3 text-[11px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {busy ? "등록 중..." : "대기열 재등록"}
                    </button>
                  ) : (
                    <span className="rounded-full bg-neutral-100 px-2 py-1 text-[11px] font-semibold text-neutral-600">
                      {statusLabel(status)}
                    </span>
                  )}
                </div>
                <p className="mt-1 break-all text-[10px] text-neutral-400">카드 ID {cardId}</p>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="mt-3 text-xs text-neutral-500">
          재등록할 기존 오픈카드가 없습니다. 완전히 삭제된 카드는 복원할 수 없습니다.
        </p>
      )}

      {isBanned ? (
        <p className="mt-2 text-[11px] font-medium text-rose-600">벤 상태인 회원은 벤 해제 후 재등록할 수 있습니다.</p>
      ) : null}
    </div>
  );
}
