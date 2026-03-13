"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type CardItem = {
  id: string;
  user_id: string;
  sex: "male" | "female";
  name: string;
  age: number | null;
  birth_year: number;
  height_cm: number;
  job: string;
  region: string;
  phone: string;
  intro_text: string;
  strengths_text: string;
  preferred_partner_text: string;
  smoking: "non_smoker" | "occasional" | "smoker";
  workout_frequency: "none" | "1_2" | "3_4" | "5_plus" | null;
  status: "submitted" | "reviewing" | "approved" | "rejected";
  admin_note?: string | null;
  admin_tags?: string[] | null;
  reviewed_by_user_id?: string | null;
  reviewed_at?: string | null;
  created_at: string;
  photo_signed_urls: string[];
};

type SortKey = "created_desc" | "age_asc" | "age_desc" | "region_asc" | "region_desc";
type StatusFilter = "" | "submitted" | "reviewing" | "approved" | "rejected";
type StatusValue = "submitted" | "reviewing" | "approved" | "rejected";
type Counts = { total: number; submitted: number; reviewing: number; approved: number; rejected: number };

type MatchCard = {
  id: string;
  user_id: string;
  sex: "male" | "female";
  name: string;
  age: number | null;
  birth_year: number;
  height_cm: number;
  job: string;
  region: string;
  intro_text: string;
  strengths_text: string;
  preferred_partner_text: string;
  smoking: "non_smoker" | "occasional" | "smoker";
  workout_frequency: "none" | "1_2" | "3_4" | "5_plus" | null;
  status: "submitted" | "reviewing" | "approved" | "rejected";
  created_at: string;
  photo_signed_urls?: string[];
};

type AdminMatchItem = {
  id: string;
  state:
    | "proposed"
    | "source_selected"
    | "source_skipped"
    | "candidate_accepted"
    | "candidate_rejected"
    | "source_declined"
    | "admin_canceled"
    | "mutual_accepted";
  source_card_id: string;
  candidate_card_id: string;
  source_selected_at: string | null;
  candidate_responded_at: string | null;
  source_final_responded_at: string | null;
  created_at: string;
  updated_at: string;
  source_card: MatchCard | null;
  candidate_card: MatchCard | null;
};

function statusBadgeClass(status: StatusValue): string {
  if (status === "submitted") return "bg-neutral-100 text-neutral-700";
  if (status === "reviewing") return "bg-amber-100 text-amber-700";
  if (status === "approved") return "bg-emerald-100 text-emerald-700";
  return "bg-rose-100 text-rose-700";
}

function statusLabel(status: StatusValue): string {
  if (status === "submitted") return "접수";
  if (status === "reviewing") return "검토 중";
  if (status === "approved") return "승인";
  return "거절";
}

function sexLabel(sex: CardItem["sex"]): string {
  return sex === "male" ? "남성" : "여성";
}

function smokingLabel(value: CardItem["smoking"]): string {
  if (value === "non_smoker") return "비흡연";
  if (value === "occasional") return "가끔";
  return "흡연";
}

function workoutLabel(value: CardItem["workout_frequency"]): string {
  if (value === "none") return "안함";
  if (value === "1_2") return "주 1-2회";
  if (value === "3_4") return "주 3-4회";
  if (value === "5_plus") return "주 5회 이상";
  return "-";
}

function matchStateLabel(state: AdminMatchItem["state"]): string {
  if (state === "proposed") return "후보 발송";
  if (state === "source_selected") return "상대 응답 대기";
  if (state === "source_skipped") return "미선택";
  if (state === "candidate_accepted") return "최종 수락 대기";
  if (state === "candidate_rejected") return "후보 거절";
  if (state === "source_declined") return "최종 거절";
  if (state === "admin_canceled") return "관리자 종료";
  return "쌍방 수락 완료";
}

function matchStateBadgeClass(state: AdminMatchItem["state"]): string {
  if (state === "proposed") return "bg-sky-100 text-sky-700";
  if (state === "source_selected") return "bg-amber-100 text-amber-700";
  if (state === "candidate_accepted") return "bg-violet-100 text-violet-700";
  if (state === "mutual_accepted") return "bg-emerald-100 text-emerald-700";
  if (state === "candidate_rejected" || state === "source_declined") return "bg-rose-100 text-rose-700";
  return "bg-neutral-100 text-neutral-700";
}

export default function AdminDatingOneOnOnePage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [items, setItems] = useState<CardItem[]>([]);
  const [countsTotal, setCountsTotal] = useState<Counts>({
    total: 0,
    submitted: 0,
    reviewing: 0,
    approved: 0,
    rejected: 0,
  });
  const [countsFiltered, setCountsFiltered] = useState<Counts>({
    total: 0,
    submitted: 0,
    reviewing: 0,
    approved: 0,
    rejected: 0,
  });
  const [matchItems, setMatchItems] = useState<AdminMatchItem[]>([]);
  const [selectedSourceCardId, setSelectedSourceCardId] = useState("");
  const [selectedCandidateCardIds, setSelectedCandidateCardIds] = useState<string[]>([]);
  const [sendingCandidates, setSendingCandidates] = useState(false);
  const [matchStateFilter, setMatchStateFilter] = useState<"" | AdminMatchItem["state"] | "mutual_only">("mutual_only");

  const [sex, setSex] = useState<"" | "male" | "female">("");
  const [region, setRegion] = useState("");
  const [minAge, setMinAge] = useState("");
  const [maxAge, setMaxAge] = useState("");
  const [status, setStatus] = useState<StatusFilter>("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortKey>("created_desc");

  const [savingIds, setSavingIds] = useState<string[]>([]);
  const [editStatusById, setEditStatusById] = useState<Record<string, StatusValue>>({});
  const [editNoteById, setEditNoteById] = useState<Record<string, string>>({});
  const [editTagsById, setEditTagsById] = useState<Record<string, string>>({});

  const buildQuery = () => {
    const qs = new URLSearchParams();
    if (sex) qs.set("sex", sex);
    if (region.trim()) qs.set("region", region.trim());
    if (minAge.trim()) qs.set("minAge", minAge.trim());
    if (maxAge.trim()) qs.set("maxAge", maxAge.trim());
    if (status) qs.set("status", status);
    if (q.trim()) qs.set("q", q.trim());
    qs.set("sort", sort);
    return qs.toString();
  };

  const hydrateEditors = (rows: CardItem[]) => {
    const nextStatus: Record<string, StatusValue> = {};
    const nextNote: Record<string, string> = {};
    const nextTags: Record<string, string> = {};

    for (const row of rows) {
      nextStatus[row.id] = row.status;
      nextNote[row.id] = row.admin_note ?? "";
      nextTags[row.id] = Array.isArray(row.admin_tags) ? row.admin_tags.join(", ") : "";
    }

    setEditStatusById(nextStatus);
    setEditNoteById(nextNote);
    setEditTagsById(nextTags);
  };

  const load = async () => {
    setError("");
    const matchQuery =
      matchStateFilter && matchStateFilter !== "mutual_only"
        ? `?state=${encodeURIComponent(matchStateFilter)}`
        : matchStateFilter === "mutual_only"
        ? "?state=mutual_accepted"
        : "";
    const [cardsRes, matchesRes] = await Promise.all([
      fetch(`/api/dating/1on1/cards?${buildQuery()}`, { cache: "no-store" }),
      fetch(`/api/dating/1on1/matches/admin${matchQuery}`, { cache: "no-store" }),
    ]);
    const body = (await cardsRes.json().catch(() => ({}))) as {
      items?: CardItem[];
      counts_total?: Counts;
      counts_filtered?: Counts;
      error?: string;
    };
    const matchesBody = (await matchesRes.json().catch(() => ({}))) as {
      items?: AdminMatchItem[];
      error?: string;
    };
    if (!cardsRes.ok) {
      throw new Error(body.error ?? "목록을 불러오지 못했습니다.");
    }
    if (!matchesRes.ok) {
      throw new Error(matchesBody.error ?? "매칭 목록을 불러오지 못했습니다.");
    }
    const rows = body.items ?? [];
    setItems(rows);
    setMatchItems(matchesBody.items ?? []);
    setCountsTotal(
      body.counts_total ?? {
        total: rows.length,
        submitted: rows.filter((r) => r.status === "submitted").length,
        reviewing: rows.filter((r) => r.status === "reviewing").length,
        approved: rows.filter((r) => r.status === "approved").length,
        rejected: rows.filter((r) => r.status === "rejected").length,
      }
    );
    setCountsFiltered(
      body.counts_filtered ?? {
        total: rows.length,
        submitted: rows.filter((r) => r.status === "submitted").length,
        reviewing: rows.filter((r) => r.status === "reviewing").length,
        approved: rows.filter((r) => r.status === "approved").length,
        rejected: rows.filter((r) => r.status === "rejected").length,
      }
    );
    hydrateEditors(rows);
    if (!selectedSourceCardId) {
      const firstRow = rows[0];
      if (firstRow) {
        setSelectedSourceCardId(firstRow.id);
      }
    } else if (!rows.some((row) => row.id === selectedSourceCardId)) {
      setSelectedSourceCardId("");
      setSelectedCandidateCardIds([]);
    }
  };

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
          router.replace("/login?redirect=/admin/dating/1on1");
          return;
        }

        const adminRes = await fetch("/api/admin/me", { cache: "no-store" });
        const adminBody = (await adminRes.json().catch(() => ({}))) as { isAdmin?: boolean };
        if (!adminBody.isAdmin) {
          router.replace("/mypage");
          return;
        }

        await load();
      } catch (e) {
        if (!mounted) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [router, supabase]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (id: string) => {
    if (savingIds.includes(id)) return;
    setSavingIds((prev) => [...prev, id]);
    try {
      const tags = (editTagsById[id] ?? "")
        .split(",")
        .map((v) => v.trim())
        .filter((v) => v.length > 0);

      const res = await fetch(`/api/dating/1on1/cards/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: editStatusById[id],
          admin_note: (editNoteById[id] ?? "").trim(),
          admin_tags: tags,
        }),
      });

      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(body.error ?? "저장에 실패했습니다.");
      }

      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingIds((prev) => prev.filter((v) => v !== id));
    }
  };

  const selectedSourceCard = items.find((item) => item.id === selectedSourceCardId) ?? null;
  const selectableCandidateCards = selectedSourceCard
    ? items.filter(
        (item) =>
          item.id !== selectedSourceCard.id &&
          item.user_id !== selectedSourceCard.user_id &&
          item.sex !== selectedSourceCard.sex
      )
    : [];
  const visibleMatches =
    matchStateFilter === "mutual_only"
      ? matchItems.filter((item) => item.state === "mutual_accepted")
      : matchStateFilter
      ? matchItems.filter((item) => item.state === matchStateFilter)
      : matchItems;

  const toggleCandidateSelection = (candidateCardId: string) => {
    setSelectedCandidateCardIds((prev) =>
      prev.includes(candidateCardId) ? prev.filter((id) => id !== candidateCardId) : [...prev, candidateCardId]
    );
  };

  const handleSendCandidates = async () => {
    if (!selectedSourceCardId) {
      setError("후보를 받을 기준 카드를 먼저 선택해주세요.");
      return;
    }
    if (selectedCandidateCardIds.length === 0) {
      setError("보낼 후보 카드를 한 명 이상 선택해주세요.");
      return;
    }

    setSendingCandidates(true);
    setError("");
    try {
      const res = await fetch("/api/dating/1on1/matches/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_card_id: selectedSourceCardId,
          candidate_card_ids: selectedCandidateCardIds,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; inserted_count?: number };
      if (!res.ok) {
        throw new Error(body.error ?? "후보 발송에 실패했습니다.");
      }
      setSelectedCandidateCardIds([]);
      await load();
      if ((body.inserted_count ?? 0) > 0) {
        alert(`${body.inserted_count}명 후보를 보냈습니다.`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSendingCandidates(false);
    }
  };

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-neutral-900">1:1 이상형 관리</h1>
        <Link href="/mypage" className="text-sm text-neutral-600 hover:text-neutral-800">
          마이페이지
        </Link>
      </div>

      <section className="mb-4 rounded-2xl border border-neutral-200 bg-white p-4">
        <p className="text-xs text-neutral-500">전체 현황</p>
        <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-5">
          <div className="rounded-lg bg-neutral-100 px-3 py-2 text-sm">전체 {countsTotal.total}</div>
          <div className="rounded-lg bg-neutral-100 px-3 py-2 text-sm">접수 {countsTotal.submitted}</div>
          <div className="rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-800">검토 {countsTotal.reviewing}</div>
          <div className="rounded-lg bg-emerald-100 px-3 py-2 text-sm text-emerald-800">승인 {countsTotal.approved}</div>
          <div className="rounded-lg bg-rose-100 px-3 py-2 text-sm text-rose-800">거절 {countsTotal.rejected}</div>
        </div>
        <p className="mt-3 text-xs text-neutral-500">현재 필터 결과</p>
        <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-5">
          <div className="rounded-lg bg-neutral-100 px-3 py-2 text-sm">전체 {countsFiltered.total}</div>
          <div className="rounded-lg bg-neutral-100 px-3 py-2 text-sm">접수 {countsFiltered.submitted}</div>
          <div className="rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-800">검토 {countsFiltered.reviewing}</div>
          <div className="rounded-lg bg-emerald-100 px-3 py-2 text-sm text-emerald-800">승인 {countsFiltered.approved}</div>
          <div className="rounded-lg bg-rose-100 px-3 py-2 text-sm text-rose-800">거절 {countsFiltered.rejected}</div>
        </div>
      </section>

      <section className="mb-4 rounded-2xl border border-sky-200 bg-sky-50/40 p-4">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-sky-900">1:1 후보 보내기</h2>
            <p className="text-xs text-sky-700">현재 조회/정렬 결과 전체를 기준으로 한 사람에게 여러 후보를 한 번에 보냅니다.</p>
          </div>
          <button
            type="button"
            disabled={sendingCandidates}
            onClick={() => void handleSendCandidates()}
            className="h-10 rounded-lg bg-sky-600 px-4 text-sm font-medium text-white disabled:opacity-50"
          >
            {sendingCandidates ? "발송 중..." : "선택 후보 발송"}
          </button>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          <div className="rounded-2xl border border-sky-200 bg-white p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-sky-800">후보를 받을 카드</p>
              <p className="text-xs text-neutral-500">조회 {items.length}명</p>
            </div>
            <select
              value={selectedSourceCardId}
              onChange={(e) => {
                setSelectedSourceCardId(e.target.value);
                setSelectedCandidateCardIds([]);
              }}
              className="mt-2 h-10 w-full rounded-lg border border-neutral-300 px-2 text-sm"
            >
              <option value="">카드 선택</option>
              {items.map((card) => (
                <option key={card.id} value={card.id}>
                  [{statusLabel(card.status)}] {card.name} / {sexLabel(card.sex)} / {card.age ?? "-"}세 / {card.region}
                </option>
              ))}
            </select>
            {items.length === 0 ? (
              <p className="mt-3 text-sm text-neutral-500">현재 조회 결과에 카드가 없습니다.</p>
            ) : (
              <div className="mt-3 space-y-2">
                <p className="text-[11px] font-semibold tracking-wide text-neutral-500">빠른 선택</p>
                <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                  {items.map((card) => {
                    const selected = card.id === selectedSourceCardId;
                    return (
                      <button
                        key={card.id}
                        type="button"
                        onClick={() => {
                          setSelectedSourceCardId(card.id);
                          setSelectedCandidateCardIds([]);
                        }}
                        className={`w-full rounded-xl border px-3 py-3 text-left transition ${
                          selected ? "border-sky-500 bg-sky-50" : "border-neutral-200 bg-neutral-50 hover:border-sky-300"
                        }`}
                      >
                        <p className="text-sm font-semibold text-neutral-900">
                          {card.name} / {sexLabel(card.sex)}
                        </p>
                        <p className="mt-1 text-xs text-neutral-600">
                          {card.age ?? "-"}세 / {card.height_cm}cm / {card.region}
                        </p>
                        <div className="mt-1 flex items-center gap-2 text-xs">
                          <span className={`inline-flex rounded-full px-2 py-0.5 font-medium ${statusBadgeClass(card.status)}`}>
                            {statusLabel(card.status)}
                          </span>
                          <span className="truncate text-neutral-500">{card.job}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {selectedSourceCard && (
              <div className="mt-3 rounded-xl border border-sky-100 bg-sky-50 p-3 text-xs text-sky-900">
                <p className="font-semibold">{selectedSourceCard.name}</p>
                <p className="mt-1">
                  {sexLabel(selectedSourceCard.sex)} / {selectedSourceCard.age ?? "-"}세 / {selectedSourceCard.height_cm}cm
                </p>
                <p className="mt-1">{selectedSourceCard.job} / {selectedSourceCard.region}</p>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-sky-200 bg-white p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-sky-800">보낼 후보 선택</p>
              <p className="text-xs text-neutral-500">{selectedCandidateCardIds.length}명 선택됨</p>
            </div>
            {!selectedSourceCard ? (
              <div className="mt-3 rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-4 text-sm text-neutral-500">
                왼쪽 카드 목록이나 드롭다운에서 기준 카드를 먼저 선택해주세요.
              </div>
            ) : selectableCandidateCards.length === 0 ? (
              <p className="mt-3 text-sm text-neutral-500">조건에 맞는 후보 카드가 없습니다.</p>
            ) : (
              <div className="mt-3">
                <p className="mb-2 text-xs text-neutral-500">
                  {selectedSourceCard.name} 님에게 보낼 수 있는 반대 성별 후보 {selectableCandidateCards.length}명
                </p>
                <div className="grid gap-2 md:grid-cols-2">
                {selectableCandidateCards.map((card) => {
                  const checked = selectedCandidateCardIds.includes(card.id);
                  return (
                    <label
                      key={card.id}
                      className={`cursor-pointer rounded-xl border p-3 ${
                        checked ? "border-sky-500 bg-sky-50" : "border-neutral-200 bg-neutral-50"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleCandidateSelection(card.id)}
                          className="mt-1"
                        />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-neutral-900">
                            {card.name} / {card.age ?? "-"}세 / {card.region}
                          </p>
                          <div className="mt-1 flex items-center gap-2 text-xs">
                            <span className={`inline-flex rounded-full px-2 py-0.5 font-medium ${statusBadgeClass(card.status)}`}>
                              {statusLabel(card.status)}
                            </span>
                            <span className="text-neutral-600">{card.height_cm}cm / {card.job}</span>
                          </div>
                          <p className="mt-2 text-xs text-neutral-700 whitespace-pre-wrap break-words">{card.intro_text}</p>
                        </div>
                      </div>
                    </label>
                  );
                })}
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50/40 p-4">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-emerald-900">매칭 진행 현황</h2>
            <p className="text-xs text-emerald-700">쌍방 수락 완료만 바로 보이도록 기본 필터를 걸어두었습니다.</p>
          </div>
          <select
            value={matchStateFilter}
            onChange={async (e) => {
              const nextValue = e.target.value as typeof matchStateFilter;
              setMatchStateFilter(nextValue);
              setLoading(true);
              try {
                setError("");
                const matchQuery =
                  nextValue && nextValue !== "mutual_only"
                    ? `?state=${encodeURIComponent(nextValue)}`
                    : nextValue === "mutual_only"
                    ? "?state=mutual_accepted"
                    : "";
                const res = await fetch(`/api/dating/1on1/matches/admin${matchQuery}`, { cache: "no-store" });
                const body = (await res.json().catch(() => ({}))) as { items?: AdminMatchItem[]; error?: string };
                if (!res.ok) {
                  throw new Error(body.error ?? "매칭 목록을 불러오지 못했습니다.");
                }
                setMatchItems(body.items ?? []);
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
              } finally {
                setLoading(false);
              }
            }}
            className="h-10 rounded-lg border border-emerald-200 bg-white px-2 text-sm text-emerald-900"
          >
            <option value="mutual_only">쌍방 수락 완료만</option>
            <option value="">전체</option>
            <option value="proposed">후보 발송</option>
            <option value="source_selected">상대 응답 대기</option>
            <option value="candidate_accepted">최종 수락 대기</option>
            <option value="candidate_rejected">후보 거절</option>
            <option value="source_declined">최종 거절</option>
            <option value="source_skipped">미선택</option>
            <option value="admin_canceled">관리자 종료</option>
            <option value="mutual_accepted">쌍방 수락 완료</option>
          </select>
        </div>

        <div className="mt-3 space-y-2">
          {visibleMatches.length === 0 ? (
            <p className="text-sm text-neutral-500">해당 조건의 매칭 기록이 없습니다.</p>
          ) : (
            visibleMatches.map((match) => (
              <div key={match.id} className="rounded-xl border border-emerald-200 bg-white p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-neutral-900">
                    {match.source_card?.name ?? "-"} → {match.candidate_card?.name ?? "-"}
                  </p>
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${matchStateBadgeClass(match.state)}`}>
                    {matchStateLabel(match.state)}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-neutral-600">
                  {match.source_card && (
                    <span>
                      기준카드: {sexLabel(match.source_card.sex)} / {match.source_card.age ?? "-"}세 / {match.source_card.region}
                    </span>
                  )}
                  {match.candidate_card && (
                    <span>
                      후보카드: {sexLabel(match.candidate_card.sex)} / {match.candidate_card.age ?? "-"}세 / {match.candidate_card.region}
                    </span>
                  )}
                </div>
                <p className="mt-2 text-xs text-neutral-500">
                  생성 {new Date(match.created_at).toLocaleString("ko-KR")}
                  {match.source_selected_at ? ` / 선택 ${new Date(match.source_selected_at).toLocaleString("ko-KR")}` : ""}
                  {match.candidate_responded_at ? ` / 후보응답 ${new Date(match.candidate_responded_at).toLocaleString("ko-KR")}` : ""}
                  {match.source_final_responded_at ? ` / 최종응답 ${new Date(match.source_final_responded_at).toLocaleString("ko-KR")}` : ""}
                </p>
              </div>
            ))
          )}
        </div>
      </section>

      <form onSubmit={handleSearch} className="mb-4 rounded-2xl border border-neutral-200 bg-white p-4">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-7">
          <select
            value={sex}
            onChange={(e) => setSex(e.target.value as "" | "male" | "female")}
            className="h-10 rounded-lg border border-neutral-300 px-2 text-sm"
          >
            <option value="">성별: 전체</option>
            <option value="male">남자</option>
            <option value="female">여자</option>
          </select>
          <input
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            placeholder="지역"
            className="h-10 rounded-lg border border-neutral-300 px-2 text-sm"
          />
          <input
            value={minAge}
            onChange={(e) => setMinAge(e.target.value)}
            placeholder="최소 나이"
            inputMode="numeric"
            className="h-10 rounded-lg border border-neutral-300 px-2 text-sm"
          />
          <input
            value={maxAge}
            onChange={(e) => setMaxAge(e.target.value)}
            placeholder="최대 나이"
            inputMode="numeric"
            className="h-10 rounded-lg border border-neutral-300 px-2 text-sm"
          />
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as StatusFilter)}
            className="h-10 rounded-lg border border-neutral-300 px-2 text-sm"
          >
            <option value="">상태: 전체</option>
            <option value="submitted">submitted</option>
            <option value="reviewing">reviewing</option>
            <option value="approved">approved</option>
            <option value="rejected">rejected</option>
          </select>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="키워드(이름/직업/내용/태그)"
            className="h-10 rounded-lg border border-neutral-300 px-2 text-sm"
          />
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="h-10 rounded-lg border border-neutral-300 px-2 text-sm"
          >
            <option value="created_desc">최신순</option>
            <option value="age_asc">나이 오름차순</option>
            <option value="age_desc">나이 내림차순</option>
            <option value="region_asc">지역 오름차순</option>
            <option value="region_desc">지역 내림차순</option>
          </select>
        </div>
        <button type="submit" className="mt-3 h-10 rounded-lg bg-neutral-900 px-4 text-sm font-medium text-white">
          조회
        </button>
      </form>

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      {loading ? (
        <p className="text-sm text-neutral-500">로딩 중...</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-neutral-500">조회 결과가 없습니다.</p>
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const saving = savingIds.includes(item.id);
            return (
              <article key={item.id} className="overflow-hidden rounded-3xl border border-neutral-200 bg-white shadow-sm">
                <div className="border-b border-neutral-200 bg-gradient-to-r from-neutral-50 to-white px-5 py-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-lg font-bold text-neutral-900">{item.name}</h2>
                        <span className="rounded-full bg-neutral-900 px-2.5 py-1 text-[11px] font-semibold text-white">
                          {sexLabel(item.sex)}
                        </span>
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusBadgeClass(item.status)}`}>
                          {statusLabel(item.status)}
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-neutral-600">
                        {item.age ?? "-"}세 · {item.height_cm}cm · {item.job} · {item.region}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-neutral-200 bg-white px-3 py-2 text-xs text-neutral-500">
                      <p>작성일 {new Date(item.created_at).toLocaleString("ko-KR")}</p>
                      <p className="mt-1">
                        최근 검토 {item.reviewed_at ? new Date(item.reviewed_at).toLocaleString("ko-KR") : "-"}
                        {item.reviewed_by_user_id ? ` / ${item.reviewed_by_user_id.slice(0, 8)}...` : ""}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                      출생 {item.birth_year}년
                    </span>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                      흡연 {smokingLabel(item.smoking)}
                    </span>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                      운동 {workoutLabel(item.workout_frequency)}
                    </span>
                  </div>
                </div>

                <div className="grid gap-5 px-5 py-5 lg:grid-cols-[260px_minmax(0,1fr)]">
                  <div>
                    <div className="grid grid-cols-2 gap-2">
                      {item.photo_signed_urls.map((url, idx) => (
                        <a
                          key={`${item.id}-${idx}`}
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="block overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-50"
                        >
                          <div className="flex h-40 w-full items-center justify-center bg-white">
                            <img src={url} alt={`1:1 카드 사진 ${idx + 1}`} className="max-h-full max-w-full object-contain" />
                          </div>
                        </a>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-4">
                    <section className="rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3">
                      <p className="text-[11px] font-semibold tracking-wide text-neutral-500">자기소개</p>
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-neutral-800">{item.intro_text}</p>
                    </section>

                    <div className="grid gap-4 md:grid-cols-2">
                      <section className="rounded-2xl border border-neutral-200 bg-white px-4 py-3">
                        <p className="text-[11px] font-semibold tracking-wide text-neutral-500">장점</p>
                        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-neutral-800">{item.strengths_text}</p>
                      </section>
                      <section className="rounded-2xl border border-neutral-200 bg-white px-4 py-3">
                        <p className="text-[11px] font-semibold tracking-wide text-neutral-500">원하는 점</p>
                        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-neutral-800">{item.preferred_partner_text}</p>
                      </section>
                    </div>

                    <section className="rounded-2xl border border-neutral-200 bg-white px-4 py-4">
                      <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                  <select
                    value={editStatusById[item.id] ?? item.status}
                    onChange={(e) =>
                      setEditStatusById((prev) => ({ ...prev, [item.id]: e.target.value as StatusValue }))
                    }
                    className="h-10 rounded-lg border border-neutral-300 px-2 text-sm"
                  >
                    <option value="submitted">submitted</option>
                    <option value="reviewing">reviewing</option>
                    <option value="approved">approved</option>
                    <option value="rejected">rejected</option>
                  </select>
                  <input
                    value={editTagsById[item.id] ?? ""}
                    onChange={(e) => setEditTagsById((prev) => ({ ...prev, [item.id]: e.target.value }))}
                    placeholder="태그 (쉼표로 구분)"
                    className="h-10 rounded-lg border border-neutral-300 px-2 text-sm"
                  />
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void handleSave(item.id)}
                    className="h-10 rounded-lg bg-neutral-900 px-3 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {saving ? "저장 중..." : "상태/메모 저장"}
                  </button>
                      </div>
                      <p className="mt-2 text-[11px] text-neutral-500">
                        상태 전환 규칙: submitted → reviewing/rejected, reviewing → approved/rejected, approved/rejected는 고정
                      </p>

                      <textarea
                        value={editNoteById[item.id] ?? ""}
                        onChange={(e) => setEditNoteById((prev) => ({ ...prev, [item.id]: e.target.value }))}
                        placeholder="관리 메모"
                        className="mt-3 min-h-24 w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm"
                      />

                      <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-3">
                        <p className="text-[11px] font-semibold tracking-wide text-amber-800">운영자 전용 연락처</p>
                        <p className="mt-1 text-sm font-semibold text-amber-900">{item.phone}</p>
                      </div>
                    </section>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </main>
  );
}
