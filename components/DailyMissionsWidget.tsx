"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type MissionItem = {
  key: string;
  label: string;
  done: boolean;
};

type MissionResponse = {
  missions: {
    items: MissionItem[];
    completed: number;
    total: number;
    completed_all: boolean;
  };
};

export default function DailyMissionsWidget() {
  const [loading, setLoading] = useState(true);
  const [unauthorized, setUnauthorized] = useState(false);
  const [data, setData] = useState<MissionResponse | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/daily-missions", { cache: "no-store" });
        if (!active) return;
        if (res.status === 401) {
          setUnauthorized(true);
          return;
        }
        if (!res.ok) return;
        const json = await res.json();
        setData(json);
      } catch {
        // ignore
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  if (loading) {
    return (
      <section className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
        <p className="text-sm text-emerald-700">오늘의 미션 불러오는 중...</p>
      </section>
    );
  }

  if (unauthorized) {
    return (
      <section className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
        <p className="text-base font-bold text-emerald-800">🎯 오늘의 미션</p>
        <p className="text-sm text-neutral-600 mt-2">로그인하면 미션 진행률이 저장됩니다.</p>
        <Link
          href="/login?redirect=/"
          className="inline-flex mt-3 min-h-[40px] items-center px-3 rounded-lg bg-emerald-600 text-white text-sm"
        >
          로그인하고 시작
        </Link>
      </section>
    );
  }

  const completed = data?.missions.completed ?? 0;
  const total = data?.missions.total ?? 3;
  const allDone = Boolean(data?.missions.completed_all);

  return (
    <section className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
      <button
        type="button"
        className="w-full flex items-center justify-between"
        onClick={() => setCollapsed((v) => !v)}
      >
        <p className="text-base font-bold text-emerald-800">🎯 오늘의 미션</p>
        <p className="text-sm text-emerald-700">{collapsed ? "펼치기" : "접기"}</p>
      </button>

      <p className="mt-1 text-sm text-neutral-700">
        완료 {completed}/{total}
      </p>

      {!collapsed && (
        <ul className="mt-3 space-y-2">
          {data?.missions.items.map((item) => (
            <li key={item.key} className="rounded-lg bg-white px-3 py-2 text-sm text-neutral-700 flex items-center">
              <span className="mr-2">{item.done ? "✅" : "⬜"}</span>
              <span>{item.label}</span>
            </li>
          ))}
        </ul>
      )}

      {allDone && (
        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-100 px-3 py-2 text-sm font-semibold text-amber-800">
          🎉 오늘 미션 완료!
        </div>
      )}
    </section>
  );
}
