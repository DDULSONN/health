"use client";

const pending = new Map<string, Set<string>>();
let timer: ReturnType<typeof setTimeout> | null = null;
let running: Promise<void> | null = null;
let listening = false;

export function queueCandidateImpression(ticket: string, id: string) {
  if (!ticket || !id || ticket.length > 5000 || pending.size >= 16 && !pending.has(ticket)) return;
  const ids = pending.get(ticket) ?? new Set<string>();
  if (ids.size >= 32) return;
  ids.add(id); pending.set(ticket, ids);
  if (!listening && typeof window !== "undefined") {
    listening = true;
    window.addEventListener("pagehide", () => { void flushCandidateImpressions(); });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") void flushCandidateImpressions();
    });
  }
  if (!timer) timer = setTimeout(() => { timer = null; void flushCandidateImpressions(); }, 2000);
}

export async function flushCandidateImpressions(): Promise<void> {
  if (timer) { clearTimeout(timer); timer = null; }
  while (running) await running;
  const batches = [...pending]; pending.clear();
  if (!batches.length) return;
  const work = Promise.all(batches.map(async ([ticket, ids]) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1800);
    try {
      await fetch("/api/dating/1on1/recommendations/impressions", {
        method: "POST", credentials: "same-origin", cache: "no-store", keepalive: true,
        headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ ticket, candidate_ids: [...ids] }),
      });
    } catch { /* Best effort; never cancel the user's matching/refresh action. */ }
    finally { clearTimeout(timeout); }
  })).then(() => {});
  running = work;
  try { await work; } finally { if (running === work) running = null; }
}
