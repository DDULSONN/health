"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

type Schedule = {
  id: string;
  label: string | null;
  starts_at: string;
  ends_at: string | null;
  capacity: number | null;
};

type GymClassPreview = {
  id: string;
  title: string;
  host_name: string;
  status: "draft" | "published" | "closed" | "canceled";
  summary: string | null;
  description: string | null;
  region: string | null;
  venue: string | null;
  price_text: string | null;
  application_deadline: string | null;
  contact_url: string | null;
  preparation_note: string | null;
  schedules: Schedule[];
  application_count: number;
};

type ApplyForm = {
  name: string;
  phone: string;
  email: string;
  memo: string;
  schedule_id: string;
};

const EMPTY_APPLY_FORM: ApplyForm = {
  name: "",
  phone: "",
  email: "",
  memo: "",
  schedule_id: "",
};

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

async function readError(response: Response) {
  try {
    const payload = (await response.json()) as { error?: string; detail?: string };
    return payload.error ?? payload.detail ?? "요청에 실패했습니다.";
  } catch {
    return "요청에 실패했습니다.";
  }
}

export default function GymClassPreviewPage() {
  const params = useParams<{ slug: string }>();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [item, setItem] = useState<GymClassPreview | null>(null);
  const [form, setForm] = useState<ApplyForm>(EMPTY_APPLY_FORM);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function boot() {
      try {
        const adminResponse = await fetch("/api/admin/me", { cache: "no-store" });
        const adminPayload = (await adminResponse.json()) as { isAdmin?: boolean };
        if (!mounted) return;
        setIsAdmin(Boolean(adminPayload.isAdmin));
        if (!adminPayload.isAdmin) {
          setLoading(false);
          return;
        }

        const slug = encodeURIComponent(params.slug);
        const response = await fetch(`/api/admin/gym-classes/slug/${slug}`, { cache: "no-store" });
        if (!response.ok) throw new Error(await readError(response));
        const payload = (await response.json()) as { item: GymClassPreview };
        if (!mounted) return;
        setItem(payload.item);
      } catch (error) {
        if (!mounted) return;
        setMessage(error instanceof Error ? error.message : "클래스를 불러오지 못했습니다.");
      } finally {
        if (mounted) setLoading(false);
      }
    }

    void boot();
    return () => {
      mounted = false;
    };
  }, [params.slug]);

  async function submitApplication() {
    if (!item) return;
    setSubmitting(true);
    setMessage("");

    try {
      const response = await fetch(`/api/admin/gym-classes/${item.id}/applications`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!response.ok) throw new Error(await readError(response));
      setForm(EMPTY_APPLY_FORM);
      setMessage("신청이 접수되었습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "신청에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  if (isAdmin === false) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-8">
        <div className="rounded-[28px] border border-neutral-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-xl font-black text-neutral-900">관리자 미리보기 페이지입니다.</h1>
          <Link href="/community" className="mt-4 inline-flex rounded-2xl bg-neutral-900 px-4 py-3 text-sm font-bold text-white">
            커뮤니티로 돌아가기
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <Link href="/community/classes" className="rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm font-bold text-neutral-700">
          관리로 돌아가기
        </Link>
        <span className="rounded-full bg-amber-50 px-3 py-2 text-xs font-black text-amber-700">관리자 미리보기</span>
      </div>

      {loading ? (
        <div className="rounded-[28px] border border-neutral-200 bg-white px-4 py-12 text-center text-sm text-neutral-500 shadow-sm">
          불러오는 중
        </div>
      ) : item ? (
        <div className="space-y-4">
          <section className="rounded-[32px] border border-neutral-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700">
                {item.region || "지역 미정"}
              </span>
              <span className="rounded-full bg-neutral-100 px-3 py-1 text-xs font-black text-neutral-600">
                {item.price_text || "가격 미정"}
              </span>
            </div>
            <h1 className="mt-4 text-3xl font-black tracking-tight text-neutral-950">{item.title}</h1>
            <p className="mt-2 text-sm font-semibold text-neutral-500">{item.host_name}</p>
            {item.summary ? <p className="mt-5 text-base leading-7 text-neutral-700">{item.summary}</p> : null}
          </section>

          <section className="rounded-[28px] border border-neutral-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-black text-neutral-950">일정</h2>
            <div className="mt-3 space-y-2">
              {item.schedules.length === 0 ? (
                <div className="rounded-2xl bg-neutral-50 px-4 py-6 text-center text-sm text-neutral-500">일정 준비중입니다.</div>
              ) : (
                item.schedules.map((schedule) => (
                  <label key={schedule.id} className="flex cursor-pointer items-center gap-3 rounded-2xl border border-neutral-100 bg-neutral-50 p-4">
                    <input
                      type="radio"
                      name="schedule"
                      value={schedule.id}
                      checked={form.schedule_id === schedule.id}
                      onChange={(event) => setForm({ ...form, schedule_id: event.target.value })}
                    />
                    <span>
                      <span className="block text-sm font-black text-neutral-900">{schedule.label || formatDate(schedule.starts_at)}</span>
                      <span className="mt-1 block text-xs text-neutral-500">{formatDate(schedule.starts_at)}</span>
                    </span>
                  </label>
                ))
              )}
            </div>
          </section>

          <section className="rounded-[28px] border border-neutral-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-black text-neutral-950">신청하기</h2>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <input className="rounded-2xl border border-neutral-200 px-4 py-3 text-sm" placeholder="이름" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <input className="rounded-2xl border border-neutral-200 px-4 py-3 text-sm" placeholder="연락처" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              <input className="rounded-2xl border border-neutral-200 px-4 py-3 text-sm md:col-span-2" placeholder="이메일" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <textarea className="mt-3 min-h-24 w-full rounded-2xl border border-neutral-200 px-4 py-3 text-sm" placeholder="메모" value={form.memo} onChange={(e) => setForm({ ...form, memo: e.target.value })} />
            <button type="button" disabled={submitting} onClick={submitApplication} className="mt-3 w-full rounded-2xl bg-emerald-600 px-5 py-4 text-sm font-black text-white disabled:opacity-50">
              신청 접수
            </button>
          </section>

          {item.description || item.preparation_note ? (
            <section className="rounded-[28px] border border-neutral-200 bg-white p-5 text-sm leading-7 text-neutral-700 shadow-sm">
              {item.description ? <p>{item.description}</p> : null}
              {item.preparation_note ? <p className="mt-3 text-neutral-500">{item.preparation_note}</p> : null}
            </section>
          ) : null}
        </div>
      ) : (
        <div className="rounded-[28px] border border-neutral-200 bg-white px-4 py-12 text-center text-sm text-neutral-500 shadow-sm">
          클래스를 찾지 못했습니다.
        </div>
      )}

      {message ? (
        <div className="fixed inset-x-4 bottom-5 mx-auto max-w-md rounded-2xl bg-neutral-950 px-4 py-3 text-center text-sm font-bold text-white shadow-xl">
          {message}
        </div>
      ) : null}
    </main>
  );
}
