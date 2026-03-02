"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type CardItem = {
  id: string;
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
    const res = await fetch(`/api/dating/1on1/cards?${buildQuery()}`, { cache: "no-store" });
    const body = (await res.json().catch(() => ({}))) as {
      items?: CardItem[];
      counts_total?: Counts;
      counts_filtered?: Counts;
      error?: string;
    };
    if (!res.ok) {
      throw new Error(body.error ?? "목록을 불러오지 못했습니다.");
    }
    const rows = body.items ?? [];
    setItems(rows);
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
                          {/* eslint-disable-next-line @next/next/no-img-element */}
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
