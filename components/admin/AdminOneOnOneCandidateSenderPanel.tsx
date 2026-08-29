"use client";

import { useState, type FormEvent } from "react";

type CandidateSearchCard = {
  id: string;
  user_id: string;
  sex: "male" | "female";
  name: string;
  nickname: string | null;
  age: number | null;
  job: string | null;
  region: string | null;
  status: "submitted" | "reviewing" | "approved";
  phone_verified: boolean;
  created_at: string;
};

const MAX_SELECTED_CANDIDATES = 10;

function displayName(card: CandidateSearchCard) {
  const name = card.name?.trim() || "이름 없음";
  const nickname = card.nickname?.trim();
  return nickname && nickname !== name ? `${name} (${nickname})` : name;
}

function cardSummary(card: CandidateSearchCard) {
  return [
    card.sex === "male" ? "남" : "여",
    card.age == null ? null : `${card.age}세`,
    card.region,
    card.job,
    card.phone_verified ? "휴대폰 인증" : null,
  ].filter(Boolean).join(" · ");
}

export default function AdminOneOnOneCandidateSenderPanel() {
  const [sourceQuery, setSourceQuery] = useState("");
  const [sourceResults, setSourceResults] = useState<CandidateSearchCard[]>([]);
  const [selectedSource, setSelectedSource] = useState<CandidateSearchCard | null>(null);
  const [candidateQuery, setCandidateQuery] = useState("");
  const [candidateResults, setCandidateResults] = useState<CandidateSearchCard[]>([]);
  const [selectedCandidates, setSelectedCandidates] = useState<CandidateSearchCard[]>([]);
  const [sourceSearched, setSourceSearched] = useState(false);
  const [candidateSearched, setCandidateSearched] = useState(false);
  const [loadingRole, setLoadingRole] = useState<"source" | "candidate" | "">("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const runSearch = async (role: "source" | "candidate", event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (loadingRole || sending) return;
    const query = (role === "source" ? sourceQuery : candidateQuery).trim();
    if (query.length < 2) {
      setError("검색어를 2자 이상 입력해 주세요.");
      return;
    }
    if (role === "candidate" && !selectedSource) {
      setError("후보를 받을 기준 카드를 먼저 선택해 주세요.");
      return;
    }

    setLoadingRole(role);
    setError("");
    setInfo("");
    try {
      const params = new URLSearchParams({ role, q: query });
      if (role === "candidate" && selectedSource) {
        params.set("source_card_id", selectedSource.id);
      }
      const response = await fetch(`/api/admin/dating/1on1/candidate-search?${params.toString()}`, {
        cache: "no-store",
      });
      const body = (await response.json().catch(() => ({}))) as {
        items?: CandidateSearchCard[];
        error?: string;
      };
      if (!response.ok) throw new Error(body.error ?? "1:1 카드 검색에 실패했습니다.");
      if (role === "source") {
        setSourceResults(body.items ?? []);
        setSourceSearched(true);
      } else {
        setCandidateResults(body.items ?? []);
        setCandidateSearched(true);
      }
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : "1:1 카드 검색에 실패했습니다.");
    } finally {
      setLoadingRole("");
    }
  };

  const selectSource = (card: CandidateSearchCard) => {
    setSelectedSource(card);
    setSourceResults([]);
    setSourceSearched(false);
    setCandidateQuery("");
    setCandidateResults([]);
    setCandidateSearched(false);
    setSelectedCandidates([]);
    setError("");
    setInfo("");
  };

  const toggleCandidate = (card: CandidateSearchCard) => {
    setError("");
    setSelectedCandidates((current) => {
      if (current.some((item) => item.id === card.id)) {
        return current.filter((item) => item.id !== card.id);
      }
      if (current.length >= MAX_SELECTED_CANDIDATES) {
        setError(`한 번에 최대 ${MAX_SELECTED_CANDIDATES}명까지 선택할 수 있습니다.`);
        return current;
      }
      return [...current, card];
    });
  };

  const sendCandidates = async () => {
    if (!selectedSource || selectedCandidates.length === 0 || sending) return;
    if (!window.confirm(`${displayName(selectedSource)} 회원에게 후보 ${selectedCandidates.length}명을 보낼까요?`)) return;

    setSending(true);
    setError("");
    setInfo("");
    try {
      const response = await fetch("/api/dating/1on1/matches/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_card_id: selectedSource.id,
          candidate_card_ids: selectedCandidates.map((card) => card.id),
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        inserted_count?: number;
        skipped_count?: number;
      };
      if (!response.ok) throw new Error(body.error ?? "후보 발송에 실패했습니다.");

      const inserted = Math.max(0, Number(body.inserted_count ?? 0));
      const skipped = Math.max(0, Number(body.skipped_count ?? 0));
      setInfo(
        skipped > 0
          ? `${inserted}명 발송 완료 · 중복 또는 차단 관계 ${skipped}명 제외`
          : `${inserted}명 후보 발송을 완료했습니다.`
      );
      setSelectedCandidates([]);
      setCandidateResults([]);
      setCandidateSearched(false);
      setCandidateQuery("");
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "후보 발송에 실패했습니다.");
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="mb-3 rounded-xl border border-sky-200 bg-white p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-bold text-sky-950">1:1 후보 검색 발송</p>
          <p className="mt-1 text-[11px] leading-5 text-neutral-500">
            검색하기 전에는 카드 데이터를 불러오지 않습니다. 이름·닉네임·카드ID·회원ID·전화번호로 찾을 수 있어요.
          </p>
        </div>
        <span className="rounded-full bg-sky-50 px-2 py-1 text-[10px] font-semibold text-sky-700">검색당 최대 20건</span>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <div className="rounded-lg border border-neutral-200 p-3">
          <p className="text-xs font-bold text-neutral-800">1. 후보를 받을 회원</p>
          {selectedSource ? (
            <div className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-sky-50 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-xs font-bold text-sky-950">{displayName(selectedSource)}</p>
                <p className="mt-0.5 truncate text-[10px] text-sky-700">{cardSummary(selectedSource)}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedSource(null);
                  setCandidateResults([]);
                  setCandidateSearched(false);
                  setSelectedCandidates([]);
                }}
                className="shrink-0 rounded-md border border-sky-200 bg-white px-2 py-1 text-[10px] font-semibold text-sky-700"
              >
                변경
              </button>
            </div>
          ) : null}
          <form onSubmit={(event) => void runSearch("source", event)} className="mt-2 flex gap-2">
            <input
              value={sourceQuery}
              onChange={(event) => setSourceQuery(event.target.value)}
              placeholder="이름·닉네임·ID 검색"
              className="h-9 min-w-0 flex-1 rounded-lg border border-neutral-200 px-3 text-xs text-neutral-900 outline-none focus:border-sky-400"
            />
            <button
              type="submit"
              disabled={loadingRole !== "" || sourceQuery.trim().length < 2}
              className="h-9 shrink-0 rounded-lg bg-sky-700 px-3 text-xs font-bold text-white disabled:opacity-40"
            >
              {loadingRole === "source" ? "검색 중" : "검색"}
            </button>
          </form>
          {sourceResults.length > 0 ? (
            <div className="mt-2 max-h-64 space-y-1 overflow-y-auto">
              {sourceResults.map((card) => (
                <button
                  key={card.id}
                  type="button"
                  onClick={() => selectSource(card)}
                  className="block w-full rounded-lg border border-neutral-100 px-3 py-2 text-left hover:border-sky-300 hover:bg-sky-50"
                >
                  <span className="block truncate text-xs font-semibold text-neutral-900">{displayName(card)}</span>
                  <span className="mt-0.5 block truncate text-[10px] text-neutral-500">{cardSummary(card)} · {card.id.slice(0, 8)}</span>
                </button>
              ))}
            </div>
          ) : sourceSearched ? (
            <p className="mt-2 rounded-lg bg-neutral-50 px-3 py-3 text-center text-[11px] text-neutral-500">검색된 활성 1:1 카드가 없습니다.</p>
          ) : null}
        </div>

        <div className={`rounded-lg border p-3 ${selectedSource ? "border-neutral-200" : "border-neutral-100 bg-neutral-50/60"}`}>
          <p className="text-xs font-bold text-neutral-800">2. 보낼 후보 선택</p>
          <form onSubmit={(event) => void runSearch("candidate", event)} className="mt-2 flex gap-2">
            <input
              value={candidateQuery}
              onChange={(event) => setCandidateQuery(event.target.value)}
              disabled={!selectedSource}
              placeholder={selectedSource ? "상대 이름·닉네임·ID 검색" : "기준 카드를 먼저 선택"}
              className="h-9 min-w-0 flex-1 rounded-lg border border-neutral-200 bg-white px-3 text-xs text-neutral-900 outline-none focus:border-sky-400 disabled:bg-neutral-100"
            />
            <button
              type="submit"
              disabled={!selectedSource || loadingRole !== "" || candidateQuery.trim().length < 2}
              className="h-9 shrink-0 rounded-lg bg-sky-700 px-3 text-xs font-bold text-white disabled:opacity-40"
            >
              {loadingRole === "candidate" ? "검색 중" : "검색"}
            </button>
          </form>
          {candidateResults.length > 0 ? (
            <div className="mt-2 max-h-64 space-y-1 overflow-y-auto">
              {candidateResults.map((card) => {
                const selected = selectedCandidates.some((item) => item.id === card.id);
                return (
                  <button
                    key={card.id}
                    type="button"
                    onClick={() => toggleCandidate(card)}
                    className={`block w-full rounded-lg border px-3 py-2 text-left ${
                      selected ? "border-emerald-300 bg-emerald-50" : "border-neutral-100 bg-white hover:border-sky-300"
                    }`}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs font-semibold text-neutral-900">{displayName(card)}</span>
                      <span className={`shrink-0 text-[10px] font-bold ${selected ? "text-emerald-700" : "text-neutral-400"}`}>
                        {selected ? "선택됨" : "선택"}
                      </span>
                    </span>
                    <span className="mt-0.5 block truncate text-[10px] text-neutral-500">{cardSummary(card)} · {card.id.slice(0, 8)}</span>
                  </button>
                );
              })}
            </div>
          ) : candidateSearched ? (
            <p className="mt-2 rounded-lg bg-white px-3 py-3 text-center text-[11px] text-neutral-500">검색된 상대 후보가 없습니다.</p>
          ) : null}
        </div>
      </div>

      {selectedCandidates.length > 0 ? (
        <div className="mt-3 rounded-lg border border-emerald-100 bg-emerald-50/50 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-bold text-emerald-900">선택 후보 {selectedCandidates.length}/{MAX_SELECTED_CANDIDATES}명</p>
            <button
              type="button"
              onClick={() => setSelectedCandidates([])}
              className="text-[10px] font-semibold text-neutral-500 underline"
            >
              전체 해제
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {selectedCandidates.map((card) => (
              <button
                key={card.id}
                type="button"
                onClick={() => toggleCandidate(card)}
                className="rounded-full border border-emerald-200 bg-white px-2 py-1 text-[10px] font-semibold text-emerald-800"
              >
                {displayName(card)} ×
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {error ? <p role="alert" className="mt-2 text-xs font-semibold text-rose-700">{error}</p> : null}
      {info ? <p role="status" className="mt-2 text-xs font-semibold text-emerald-700">{info}</p> : null}

      <button
        type="button"
        disabled={!selectedSource || selectedCandidates.length === 0 || sending}
        onClick={() => void sendCandidates()}
        className="mt-3 h-10 w-full rounded-lg bg-emerald-700 text-xs font-bold text-white disabled:opacity-40"
      >
        {sending ? "후보 발송 중..." : `선택 후보 ${selectedCandidates.length}명 발송`}
      </button>
    </section>
  );
}
