"use client";

import Link from "next/link";
import { useDeferredValue, useEffect, useMemo, useState } from "react";

type Tab = "overview" | "entries" | "anomalies" | "ops";

type OverviewResponse = {
  ok: boolean;
  season: { id: string; week_id: string; theme_label: string; status: string } | null;
  counts: {
    entries_total: number;
    entries_pending: number;
    entries_approved_active: number;
    entries_hidden: number;
    reports_open: number;
    votes_total: number;
    rewards_claimed: number;
  } | null;
};

type EntryRow = {
  id: string;
  nickname: string;
  gender: "male" | "female";
  intro_text: string | null;
  image_urls: string[];
  rating: number;
  wins: number;
  losses: number;
  votes_received: number;
  moderation_status: "pending" | "approved" | "rejected";
  status: "active" | "inactive" | "hidden";
  report_count: number;
  created_at: string;
};

type ReportRow = {
  id: string;
  entry_id: string;
  reason: string;
  status: "pending" | "reviewed" | "dismissed";
  created_at: string;
};

type AnomalyRow = {
  actor_key: string;
  kind: "user" | "viewer";
  votes: number;
  distinct_matchups: number;
  dominant_entry_id: string | null;
  dominant_entry_votes: number;
  score: number;
};

type LogRow = {
  id: string;
  run_type: string;
  status: string;
  payload: Record<string, unknown>;
  created_at: string;
};

type SeasonThemeOption = {
  slug: string;
  label: string;
};

type SeasonPlannerItem = {
  id: string;
  week_id: string;
  theme_slug: string;
  theme_label: string;
  start_at: string;
  end_at: string;
  status: "draft" | "active" | "closed";
};

async function parseJson<T>(res: Response): Promise<T> {
  return (await res.json().catch(() => ({}))) as T;
}

function getCurrentIsoWeekIdKst() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const target = new Date(kst);
  target.setUTCHours(0, 0, 0, 0);
  const day = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - day);
  const isoYear = target.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const week = Math.ceil((((target.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

export default function AdminBodyBattlePage() {
  const [tab, setTab] = useState<Tab>("overview");
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [entries, setEntries] = useState<EntryRow[]>([]);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [anomalies, setAnomalies] = useState<AnomalyRow[]>([]);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [bulkApproving, setBulkApproving] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [entryQuery, setEntryQuery] = useState("");
  const [seasonItems, setSeasonItems] = useState<SeasonPlannerItem[]>([]);
  const [seasonThemes, setSeasonThemes] = useState<SeasonThemeOption[]>([]);
  const [seasonLoading, setSeasonLoading] = useState(false);
  const [plannerWeekId, setPlannerWeekId] = useState(getCurrentIsoWeekIdKst());
  const [plannerThemeSlug, setPlannerThemeSlug] = useState("shoulders");
  const [plannerThemeLabel, setPlannerThemeLabel] = useState("");
  const [bulkWeeks, setBulkWeeks] = useState(4);
  const [bulkRollingBack, setBulkRollingBack] = useState(false);
  const deferredEntryQuery = useDeferredValue(entryQuery);

  const filteredEntries = useMemo(() => {
    const q = deferredEntryQuery.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((item) => {
      const hay = `${item.id} ${item.nickname} ${item.gender} ${item.moderation_status} ${item.status}`.toLowerCase();
      return hay.includes(q);
    });
  }, [entries, deferredEntryQuery]);

  async function loadOverview() {
    const res = await fetch("/api/admin/bodybattle/overview", { cache: "no-store" });
    const body = await parseJson<OverviewResponse & { message?: string }>(res);
    if (!res.ok) throw new Error(body.message ?? "Failed to load overview.");
    setOverview(body);
  }

  async function loadEntries() {
    const res = await fetch("/api/admin/bodybattle/entries?limit=250", { cache: "no-store" });
    const body = await parseJson<{ items?: EntryRow[]; message?: string }>(res);
    if (!res.ok) throw new Error(body.message ?? "Failed to load entries.");
    setEntries(body.items ?? []);
  }

  async function loadAnomalies() {
    const [anomaliesRes, reportsRes] = await Promise.all([
      fetch("/api/admin/bodybattle/anomalies?hours=24", { cache: "no-store" }),
      fetch("/api/admin/bodybattle/reports?limit=250", { cache: "no-store" }),
    ]);
    const anomaliesBody = await parseJson<{ suspicious_actors?: AnomalyRow[]; message?: string }>(anomaliesRes);
    const reportsBody = await parseJson<{ items?: ReportRow[]; message?: string }>(reportsRes);
    if (!anomaliesRes.ok) throw new Error(anomaliesBody.message ?? "Failed to load anomalies.");
    if (!reportsRes.ok) throw new Error(reportsBody.message ?? "Failed to load reports.");
    setAnomalies(anomaliesBody.suspicious_actors ?? []);
    setReports(reportsBody.items ?? []);
  }

  async function loadOpsLogs() {
    const res = await fetch("/api/admin/bodybattle/logs?limit=100", { cache: "no-store" });
    const body = await parseJson<{ items?: LogRow[]; message?: string }>(res);
    if (!res.ok) throw new Error(body.message ?? "Failed to load logs.");
    setLogs(body.items ?? []);
  }

  async function loadSeasonPlanner() {
    setSeasonLoading(true);
    try {
      const res = await fetch("/api/admin/bodybattle/seasons", { cache: "no-store" });
      const body = await parseJson<{
        ok?: boolean;
        message?: string;
        items?: SeasonPlannerItem[];
        themes?: SeasonThemeOption[];
      }>(res);
      if (!res.ok || !body.ok) throw new Error(body.message ?? "Failed to load seasons.");
      const themes = body.themes ?? [];
      setSeasonItems(body.items ?? []);
      setSeasonThemes(themes);
      if (!themes.some((theme) => theme.slug === plannerThemeSlug)) {
        setPlannerThemeSlug(themes[0]?.slug ?? "shoulders");
      }
    } finally {
      setSeasonLoading(false);
    }
  }

  async function savePlannedSeason() {
    if (!plannerWeekId || !plannerThemeSlug) return;
    setSeasonLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/bodybattle/seasons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          week_id: plannerWeekId,
          theme_slug: plannerThemeSlug,
          theme_label: plannerThemeLabel.trim() || undefined,
        }),
      });
      const body = await parseJson<{ ok?: boolean; message?: string }>(res);
      if (!res.ok || !body.ok) throw new Error(body.message ?? "Failed to save season theme.");
      await loadSeasonPlanner();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSeasonLoading(false);
    }
  }

  async function reserveBulkSeasons() {
    setSeasonLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/bodybattle/seasons/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start_week_id: plannerWeekId,
          weeks: bulkWeeks,
        }),
      });
      const body = await parseJson<{ ok?: boolean; message?: string }>(res);
      if (!res.ok || !body.ok) throw new Error(body.message ?? "Failed to reserve seasons.");
      await Promise.all([loadSeasonPlanner(), loadOpsLogs()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSeasonLoading(false);
    }
  }

  async function rollbackBulkRun(runId: string) {
    setBulkRollingBack(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/bodybattle/seasons/rollback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ run_id: runId }),
      });
      const body = await parseJson<{ ok?: boolean; message?: string }>(res);
      if (!res.ok || !body.ok) throw new Error(body.message ?? "Failed to rollback.");
      await Promise.all([loadSeasonPlanner(), loadOpsLogs()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBulkRollingBack(false);
    }
  }

  async function loadCurrentTab(nextTab = tab) {
    setLoading(true);
    setError(null);
    try {
      if (nextTab === "overview") await loadOverview();
      else if (nextTab === "entries") await loadEntries();
      else if (nextTab === "anomalies") await loadAnomalies();
      else await Promise.all([loadOpsLogs(), loadSeasonPlanner()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function bulkApprovePending() {
    const pending = entries.filter((e) => e.moderation_status === "pending");
    if (pending.length === 0) return;
    setBulkApproving(true);
    setError(null);
    try {
      await Promise.all(pending.map((e) => patchEntry(e.id, { moderation_status: "approved" })));
      await loadEntries();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBulkApproving(false);
    }
  }

  async function patchEntry(id: string, body: Record<string, unknown>) {
    const res = await fetch(`/api/admin/bodybattle/entries/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await parseJson<{ message?: string }>(res);
    if (!res.ok) throw new Error(json.message ?? "Failed to update entry.");
  }

  async function resolveReport(id: string, hide = false) {
    const res = await fetch(`/api/admin/bodybattle/reports/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "reviewed", apply_entry_action: hide ? "hide" : "none" }),
    });
    const json = await parseJson<{ message?: string }>(res);
    if (!res.ok) throw new Error(json.message ?? "Failed to resolve report.");
  }

  async function runSeasonSync(mode: "sync" | "ensure_only" | "finalize_only") {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/bodybattle/season/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const data = await parseJson<{ message?: string }>(res);
      if (!res.ok) throw new Error(data.message ?? "Failed to run season sync.");
      await Promise.all([loadOverview(), loadOpsLogs(), loadSeasonPlanner()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  useEffect(() => {
    void loadCurrentTab("overview");
  }, []);

  useEffect(() => {
    const hasData =
      (tab === "overview" && !!overview) ||
      (tab === "entries" && entries.length > 0) ||
      (tab === "anomalies" && (anomalies.length > 0 || reports.length > 0)) ||
      (tab === "ops" && logs.length > 0);
    if (!hasData) {
      void loadCurrentTab(tab);
    }
  }, [tab, overview, entries.length, anomalies.length, reports.length, logs.length]);

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-neutral-900">BodyBattle Admin</h1>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void loadCurrentTab(tab)}
            className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-xs font-semibold text-neutral-700"
          >
            새로고침
          </button>
          <Link href="/admin" className="text-sm text-neutral-500 hover:text-neutral-700">
            Back
          </Link>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-4 overflow-hidden rounded-xl border border-neutral-200 bg-white">
        {(["overview", "entries", "anomalies", "ops"] as Tab[]).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setTab(item)}
            className={`min-h-[44px] text-sm font-semibold ${tab === item ? "bg-blue-600 text-white" : "text-neutral-700"}`}
          >
            {item}
          </button>
        ))}
      </div>

      {loading ? <p className="text-sm text-neutral-500">Loading...</p> : null}
      {error ? <p className="mb-3 text-sm text-red-600">{error}</p> : null}

      {tab === "overview" && overview?.season && overview.counts ? (
        <section className="rounded-2xl border border-neutral-200 bg-white p-4">
          <p className="text-sm font-semibold text-neutral-900">
            {overview.season.week_id} · {overview.season.theme_label} · {overview.season.status}
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <p className="rounded-lg bg-neutral-50 p-2 text-xs">Entries {overview.counts.entries_total}</p>
            <p className="rounded-lg bg-neutral-50 p-2 text-xs">Pending {overview.counts.entries_pending}</p>
            <p className="rounded-lg bg-neutral-50 p-2 text-xs">Active {overview.counts.entries_approved_active}</p>
            <p className="rounded-lg bg-neutral-50 p-2 text-xs">Hidden {overview.counts.entries_hidden}</p>
            <p className="rounded-lg bg-neutral-50 p-2 text-xs">Open reports {overview.counts.reports_open}</p>
            <p className="rounded-lg bg-neutral-50 p-2 text-xs">Votes {overview.counts.votes_total}</p>
            <p className="rounded-lg bg-neutral-50 p-2 text-xs">Rewards {overview.counts.rewards_claimed}</p>
          </div>
        </section>
      ) : null}

      {tab === "entries" ? (
        <section className="space-y-2">
          <div className="flex gap-2">
            <input
              value={entryQuery}
              onChange={(e) => setEntryQuery(e.target.value)}
              placeholder="닉네임/ID/상태 검색"
              className="flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm"
            />
            <button
              type="button"
              disabled={bulkApproving || entries.filter((e) => e.moderation_status === "pending").length === 0}
              onClick={() => void bulkApprovePending()}
              className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
            >
              {bulkApproving ? "승인 중..." : `대기 ${entries.filter((e) => e.moderation_status === "pending").length}건 일괄승인`}
            </button>
          </div>
          {filteredEntries.map((entry) => (
            <article key={entry.id} className="rounded-xl border border-neutral-200 bg-white p-3">
              <div className="flex items-start gap-3">
                {entry.image_urls?.length > 0 && (
                  <div className="flex shrink-0 gap-1">
                    {entry.image_urls.slice(0, 2).map((url) => (
                      <button
                        key={url}
                        type="button"
                        onClick={() => setLightboxUrl(url)}
                        className="h-16 w-16 overflow-hidden rounded-lg border border-neutral-200 bg-neutral-100"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={url} alt="" className="h-full w-full object-cover" />
                      </button>
                    ))}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-neutral-900">
                    {entry.nickname} <span className="font-normal text-neutral-500">({entry.gender})</span>
                  </p>
                  <p className="mt-0.5 text-xs text-neutral-500">
                    {entry.id.slice(0, 8)}... · rating {entry.rating} · {entry.wins}W {entry.losses}L · votes {entry.votes_received}
                  </p>
                  <p className="mt-0.5 text-xs">
                    <span className={`font-semibold ${entry.moderation_status === "pending" ? "text-amber-600" : entry.moderation_status === "approved" ? "text-emerald-600" : "text-red-600"}`}>
                      {entry.moderation_status}
                    </span>
                    {" · "}
                    <span className={entry.status === "hidden" ? "text-red-500" : "text-neutral-500"}>{entry.status}</span>
                    {entry.report_count > 0 && <span className="ml-1 text-red-500"> · 신고 {entry.report_count}건</span>}
                  </p>
                  {entry.intro_text && (
                    <p className="mt-1 line-clamp-1 text-xs text-neutral-400">{entry.intro_text}</p>
                  )}
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => patchEntry(entry.id, { moderation_status: "approved" }).then(() => loadCurrentTab("entries")).catch((e) => setError(String(e)))}
                  className="rounded bg-emerald-600 px-2 py-1 text-xs text-white"
                >
                  Approve
                </button>
                <button
                  type="button"
                  onClick={() => patchEntry(entry.id, { moderation_status: "rejected" }).then(() => loadCurrentTab("entries")).catch((e) => setError(String(e)))}
                  className="rounded bg-red-600 px-2 py-1 text-xs text-white"
                >
                  Reject
                </button>
                <button
                  type="button"
                  onClick={() => patchEntry(entry.id, { status: "hidden" }).then(() => loadCurrentTab("entries")).catch((e) => setError(String(e)))}
                  className="rounded bg-neutral-800 px-2 py-1 text-xs text-white"
                >
                  Hide
                </button>
                <button
                  type="button"
                  onClick={() => patchEntry(entry.id, { status: "active", moderation_status: "approved" }).then(() => loadCurrentTab("entries")).catch((e) => setError(String(e)))}
                  className="rounded bg-blue-600 px-2 py-1 text-xs text-white"
                >
                  Restore
                </button>
              </div>
            </article>
          ))}
        </section>
      ) : null}

      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
          onClick={() => setLightboxUrl(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lightboxUrl} alt="" className="max-h-[90vh] max-w-[90vw] rounded-xl object-contain" onClick={(e) => e.stopPropagation()} />
          <button
            type="button"
            onClick={() => setLightboxUrl(null)}
            className="absolute right-4 top-4 rounded-full bg-white/20 px-3 py-1 text-sm text-white"
          >
            닫기
          </button>
        </div>
      )}

      {tab === "anomalies" ? (
        <section className="space-y-3">
          {anomalies.length === 0 ? <p className="text-sm text-neutral-500">최근 24시간 이상행동 없음</p> : null}
          {anomalies.map((item) => (
            <article key={item.actor_key} className="rounded-xl border border-amber-200 bg-amber-50 p-3">
              <p className="text-sm font-semibold text-amber-900">
                {item.actor_key} · score {item.score}
              </p>
              <p className="mt-1 text-xs text-amber-800">
                votes {item.votes} · matchups {item.distinct_matchups} · dominant {item.dominant_entry_id?.slice(0, 8) ?? "-"} ({item.dominant_entry_votes}표)
              </p>
              {item.dominant_entry_id && (
                <button
                  type="button"
                  onClick={() =>
                    patchEntry(item.dominant_entry_id!, { status: "hidden" })
                      .then(() => loadCurrentTab("anomalies"))
                      .catch((e) => setError(String(e)))
                  }
                  className="mt-2 rounded bg-neutral-800 px-2 py-1 text-xs text-white"
                >
                  지배 항목 숨기기
                </button>
              )}
            </article>
          ))}

          <section className="rounded-xl border border-neutral-200 bg-white p-3">
            <p className="text-xs font-semibold text-neutral-700">Reports ({reports.length})</p>
            <div className="mt-2 space-y-2">
              {reports.map((report) => (
                <div key={report.id} className="rounded-lg border border-neutral-200 bg-neutral-50 p-2">
                  <p className="text-xs text-neutral-700">
                    {report.reason} · status={report.status} · entry={report.entry_id.slice(0, 8)}...
                  </p>
                  <div className="mt-1 flex gap-2">
                    <button
                      type="button"
                      onClick={() => resolveReport(report.id, false).then(() => loadCurrentTab("anomalies")).catch((e) => setError(String(e)))}
                      className="rounded bg-blue-600 px-2 py-1 text-xs text-white"
                    >
                      Review
                    </button>
                    <button
                      type="button"
                      onClick={() => resolveReport(report.id, true).then(() => loadCurrentTab("anomalies")).catch((e) => setError(String(e)))}
                      className="rounded bg-red-600 px-2 py-1 text-xs text-white"
                    >
                      Review + Hide
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </section>
      ) : null}

      {tab === "ops" ? (
        <section className="space-y-3">
          <article className="rounded-xl border border-neutral-200 bg-white p-3">
            <p className="text-sm font-semibold text-neutral-900">Season Theme Planner</p>
            <p className="mt-1 text-xs text-neutral-500">Set upcoming weekly theme in advance. Format: YYYY-W##</p>

            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-4">
              <input
                value={plannerWeekId}
                onChange={(e) => setPlannerWeekId(e.target.value.toUpperCase())}
                placeholder="2026-W12"
                className="rounded-lg border border-neutral-300 px-3 py-2 text-sm"
              />
              <select
                value={plannerThemeSlug}
                onChange={(e) => {
                  const nextSlug = e.target.value;
                  setPlannerThemeSlug(nextSlug);
                  const found = seasonThemes.find((theme) => theme.slug === nextSlug);
                  setPlannerThemeLabel(found?.label ?? "");
                }}
                className="rounded-lg border border-neutral-300 px-3 py-2 text-sm"
              >
                {seasonThemes.map((theme) => (
                  <option key={theme.slug} value={theme.slug}>
                    {theme.label}
                  </option>
                ))}
              </select>
              <input
                value={plannerThemeLabel}
                onChange={(e) => setPlannerThemeLabel(e.target.value)}
                placeholder="Custom label (optional)"
                className="rounded-lg border border-neutral-300 px-3 py-2 text-sm"
              />
              <button
                type="button"
                onClick={() => void savePlannedSeason()}
                disabled={seasonLoading}
                className="rounded bg-blue-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
              >
                {seasonLoading ? "Saving..." : "Save Theme"}
              </button>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                type="number"
                min={1}
                max={12}
                value={bulkWeeks}
                onChange={(e) => setBulkWeeks(Math.max(1, Math.min(12, Number(e.target.value) || 1)))}
                className="w-24 rounded-lg border border-neutral-300 px-2 py-1 text-xs"
              />
              <button
                type="button"
                onClick={() => void reserveBulkSeasons()}
                disabled={seasonLoading}
                className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              >
                {seasonLoading ? "Working..." : `Reserve Next ${bulkWeeks} Weeks`}
              </button>
            </div>

            <div className="mt-3 space-y-2">
              {seasonItems.map((season) => (
                <div key={season.id} className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2">
                  <p className="text-xs font-semibold text-neutral-800">
                    {season.week_id} 쨌 {season.theme_label} ({season.theme_slug}) 쨌 {season.status}
                  </p>
                  <p className="mt-1 text-[11px] text-neutral-500">
                    {new Date(season.start_at).toLocaleString("ko-KR")} ~ {new Date(season.end_at).toLocaleString("ko-KR")}
                  </p>
                </div>
              ))}
              {seasonItems.length === 0 ? <p className="text-xs text-neutral-500">No season schedule yet.</p> : null}
            </div>
          </article>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={running}
              onClick={() => runSeasonSync("sync")}
              className="rounded bg-blue-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
            >
              Run Sync
            </button>
            <button
              type="button"
              disabled={running}
              onClick={() => runSeasonSync("ensure_only")}
              className="rounded bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
            >
              Ensure Season
            </button>
            <button
              type="button"
              disabled={running}
              onClick={() => runSeasonSync("finalize_only")}
              className="rounded bg-amber-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
            >
              Finalize Due
            </button>
          </div>
          <div className="space-y-2">
            {logs.map((log) => (
              <article key={log.id} className="rounded-xl border border-neutral-200 bg-white p-3">
                <p className="text-xs font-semibold text-neutral-900">
                  {log.run_type} · {log.status} · {new Date(log.created_at).toLocaleString("ko-KR")}
                </p>
                {log.run_type === "season_bulk_upsert" ? (
                  <div className="mt-1">
                    <button
                      type="button"
                      disabled={bulkRollingBack}
                      onClick={() => void rollbackBulkRun(log.id)}
                      className="rounded bg-red-600 px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
                    >
                      {bulkRollingBack ? "Rolling back..." : "Rollback This Bulk Run"}
                    </button>
                  </div>
                ) : null}
                <pre className="mt-1 overflow-x-auto rounded bg-neutral-50 p-2 text-[11px] text-neutral-700">
{JSON.stringify(log.payload, null, 2)}
                </pre>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}
