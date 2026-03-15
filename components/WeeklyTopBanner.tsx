"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatKstDateTime } from "@/lib/weekly";

type WinnerPost = {
  id: string;
  title: string;
  user_id: string;
  score_sum: number;
  vote_count: number;
  profiles: { nickname: string | null } | null;
};

type LatestWeeklyResponse =
  | {
      mode: "confirmed";
      week: { start_utc: string; end_utc: string };
      male: { post_id: string; score: number; post: WinnerPost | null } | null;
      female: { post_id: string; score: number; post: WinnerPost | null } | null;
    }
  | {
      mode: "collecting";
      week: { start_utc: string; end_utc: string };
      male: WinnerPost | null;
      female: WinnerPost | null;
      last_confirmed: {
        week_start: string;
        week_end: string;
        male_post_id: string | null;
        female_post_id: string | null;
      } | null;
    };

function WinnerRow({
  label,
  item,
  href,
}: {
  label: string;
  item: { nickname: string; score: number } | null;
  href: string;
}) {
  return (
    <Link href={href} className="block rounded-xl bg-white/90 px-3 py-2 hover:bg-white">
      <p className="text-xs text-neutral-500">{label}</p>
      {item ? (
        <p className="truncate text-sm font-semibold text-neutral-900">
          {item.nickname} · {item.score}점
        </p>
      ) : (
        <p className="text-sm text-neutral-400">아직 집계 전</p>
      )}
    </Link>
  );
}

export default function WeeklyTopBanner() {
  const [data, setData] = useState<LatestWeeklyResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    (async () => {
      try {
        const res = await fetch("/api/weekly-winners/latest", { cache: "no-store" });
        const json = await res.json();
        if (isMounted && res.ok) {
          setData(json as LatestWeeklyResponse);
        }
      } catch (error) {
        console.error("[WeeklyTopBanner] load failed:", error);
      } finally {
        if (isMounted) setLoading(false);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, []);

  if (loading) {
    return (
      <section className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 p-4">
        <p className="text-sm text-amber-700">이번 주 몸평 랭킹을 불러오는 중...</p>
      </section>
    );
  }

  const collecting = data?.mode === "collecting";
  const male =
    data?.mode === "confirmed"
      ? data.male
        ? {
            nickname: data.male.post?.profiles?.nickname ?? "익명",
            score: data.male.score,
          }
        : null
      : data?.male
      ? {
          nickname: data.male.profiles?.nickname ?? "익명",
          score: data.male.score_sum ?? 0,
        }
      : null;

  const female =
    data?.mode === "confirmed"
      ? data.female
        ? {
            nickname: data.female.post?.profiles?.nickname ?? "익명",
            score: data.female.score,
          }
        : null
      : data?.female
      ? {
          nickname: data.female.profiles?.nickname ?? "익명",
          score: data.female.score_sum ?? 0,
        }
      : null;

  const maleHref =
    data?.mode === "confirmed" && data?.male?.post_id
      ? `/community/${data.male.post_id}`
      : "/hall-of-fame";
  const femaleHref =
    data?.mode === "confirmed" && data?.female?.post_id
      ? `/community/${data.female.post_id}`
      : "/hall-of-fame";

  return (
    <section className="mb-5 rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 p-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-lg font-bold text-amber-800">🏆 이번 주 몸평 랭킹</p>
        <Link href="/hall-of-fame" className="text-xs text-amber-700 hover:underline">
          명예의 전당
        </Link>
      </div>

      {data ? (
        <p className="mb-3 text-xs text-neutral-500">
          {collecting ? "이번 주 집계 중" : "확정 주간"} · {formatKstDateTime(data.week.start_utc)} ~{" "}
          {formatKstDateTime(data.week.end_utc)}
        </p>
      ) : (
        <p className="mb-3 text-xs text-neutral-500">이번 주 집계 데이터가 아직 없어요.</p>
      )}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <WinnerRow label="남자 1위" item={male} href={maleHref} />
        <WinnerRow label="여자 1위" item={female} href={femaleHref} />
      </div>
    </section>
  );
}
