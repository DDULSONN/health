"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type GymClassListItem = {
  id: string;
  slug: string;
  title: string;
  host_name: string;
  status: "draft" | "published" | "closed" | "canceled";
  summary: string | null;
  region: string | null;
  venue: string | null;
  price_text: string | null;
  cover_image_url: string | null;
  schedules?: { id: string; starts_at: string; label: string | null }[];
  application_stats?: { total: number; submitted: number; confirmed: number };
};

async function readError(response: Response) {
  try {
    const payload = (await response.json()) as { error?: string; detail?: string };
    return payload.error ?? payload.detail ?? "요청에 실패했습니다.";
  } catch {
    return "요청에 실패했습니다.";
  }
}

function formatDate(value: string | null | undefined) {
  if (!value) return "일정 준비중";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export default function CommunityClassesListPage() {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [items, setItems] = useState<GymClassListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

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

        const response = await fetch("/api/admin/gym-classes", { cache: "no-store" });
        if (!response.ok) throw new Error(await readError(response));
        const payload = (await response.json()) as { items?: GymClassListItem[] };
        if (!mounted) return;
        setItems((payload.items ?? []).filter((item) => item.status === "published"));
      } catch (error) {
        if (!mounted) return;
        setMessage(error instanceof Error ? error.message : "클래스 목록을 불러오지 못했습니다.");
      } finally {
        if (mounted) setLoading(false);
      }
    }

    void boot();
    return () => {
      mounted = false;
    };
  }, []);

  if (isAdmin === false) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-8">
        <div className="rounded-[28px] border border-neutral-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-xl font-black text-neutral-900">준비중인 메뉴입니다.</h1>
          <p className="mt-2 text-sm text-neutral-500">운동 클래스는 곧 공개될 예정입니다.</p>
          <Link href="/community" className="mt-4 inline-flex rounded-2xl bg-neutral-900 px-4 py-3 text-sm font-bold text-white">
            커뮤니티로 돌아가기
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-black text-emerald-600">관리자 미리보기</p>
          <h1 className="mt-1 text-3xl font-black tracking-tight text-neutral-950">운동 클래스</h1>
          <p className="mt-2 text-sm text-neutral-500">모집중인 클래스를 유저가 보는 형태로 확인합니다.</p>
        </div>
        <Link href="/community/classes/manage" className="rounded-2xl bg-neutral-950 px-4 py-3 text-sm font-black text-white">
          관리 페이지
        </Link>
      </div>

      {message ? (
        <div className="mt-4 rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-600">
          {message}
        </div>
      ) : null}

      {loading ? (
        <div className="mt-5 rounded-[28px] border border-neutral-200 bg-white px-4 py-12 text-center text-sm text-neutral-500 shadow-sm">
          불러오는 중
        </div>
      ) : items.length === 0 ? (
        <div className="mt-5 rounded-[28px] border border-neutral-200 bg-white px-4 py-12 text-center text-sm text-neutral-500 shadow-sm">
          현재 모집중인 클래스가 없습니다.
        </div>
      ) : (
        <section className="mt-5 grid gap-4 md:grid-cols-2">
          {items.map((item) => {
            const nextSchedule = item.schedules?.[0];
            return (
              <Link
                key={item.id}
                href={`/community/classes/${encodeURIComponent(item.slug)}`}
                className="overflow-hidden rounded-[30px] border border-neutral-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
              >
                {item.cover_image_url ? (
                  <img src={item.cover_image_url} alt="" className="h-52 w-full object-cover" loading="lazy" />
                ) : (
                  <div className="flex h-52 w-full items-center justify-center bg-gradient-to-br from-emerald-50 to-neutral-100 text-sm font-bold text-emerald-700">
                    GymTools Class
                  </div>
                )}
                <div className="p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700">
                      {item.region || "지역 미정"}
                    </span>
                    <span className="rounded-full bg-neutral-100 px-3 py-1 text-xs font-black text-neutral-600">
                      {item.price_text || "가격 미정"}
                    </span>
                  </div>
                  <h2 className="mt-4 line-clamp-2 text-xl font-black text-neutral-950">{item.title}</h2>
                  <p className="mt-1 text-sm font-semibold text-neutral-500">{item.host_name}</p>
                  {item.summary ? <p className="mt-3 line-clamp-2 text-sm leading-6 text-neutral-600">{item.summary}</p> : null}
                  <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl bg-neutral-50 px-4 py-3">
                    <span className="text-xs font-bold text-neutral-500">{formatDate(nextSchedule?.starts_at)}</span>
                    <span className="text-xs font-black text-emerald-700">신청 {item.application_stats?.total ?? 0}명</span>
                  </div>
                </div>
              </Link>
            );
          })}
        </section>
      )}
    </main>
  );
}
