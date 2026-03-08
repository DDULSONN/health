"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import { toBodyBattleImageUrl } from "@/lib/bodybattle-image";

type RankingItem = {
  rank: number;
  id: string;
  nickname: string;
  gender: "male" | "female";
  rating: number;
  wins: number;
  losses: number;
  draws: number;
  votes_received: number;
  image_url: string | null;
};

type RankingResponse = {
  ok: boolean;
  season: {
    id: string;
    week_id: string;
    theme_label: string;
  } | null;
  items: RankingItem[];
  min_votes: number;
  min_exposures: number;
};

export default function BodyBattleRankingPage() {
  const [gender, setGender] = useState<"male" | "female">("male");
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<RankingResponse | null>(null);

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      try {
        const res = await fetch(`/api/bodybattle/ranking?gender=${gender}&top=50`, { cache: "no-store" });
        const json = (await res.json()) as RankingResponse;
        if (mounted) setData(json);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => {
      mounted = false;
    };
  }, [gender]);

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">BodyBattle Ranking</h1>
          <p className="mt-1 text-sm text-neutral-500">{data?.season ? `${data.season.week_id} · ${data.season.theme_label}` : "No active season"}</p>
        </div>
        <Link href="/bodybattle" className="text-sm text-neutral-500 hover:text-neutral-700">
          Back
        </Link>
      </div>

      <div className="mb-4 grid grid-cols-2 overflow-hidden rounded-xl border border-neutral-200 bg-white">
        <button
          type="button"
          onClick={() => setGender("male")}
          className={`min-h-[44px] text-sm font-semibold ${gender === "male" ? "bg-blue-600 text-white" : "text-neutral-700"}`}
        >
          Male
        </button>
        <button
          type="button"
          onClick={() => setGender("female")}
          className={`min-h-[44px] text-sm font-semibold ${gender === "female" ? "bg-blue-600 text-white" : "text-neutral-700"}`}
        >
          Female
        </button>
      </div>

      {loading ? <p className="text-sm text-neutral-500">Loading ranking...</p> : null}

      {!loading && (data?.items?.length ?? 0) === 0 ? (
        <p className="text-sm text-neutral-600">
          No eligible ranking data yet. Minimum {data?.min_exposures ?? 20} exposures and {data?.min_votes ?? 30} votes required.
        </p>
      ) : null}

      <section className="space-y-2">
        {(data?.items ?? []).map((item) => (
          <article key={item.id} className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-white p-3">
            <p className="w-8 text-center text-sm font-bold text-neutral-800">{item.rank}</p>
            {item.image_url ? (
              <Image
                src={toBodyBattleImageUrl(item.image_url, { width: 120, quality: 64 }) ?? item.image_url}
                alt=""
                width={64}
                height={64}
                unoptimized
                className="h-12 w-12 rounded-lg object-cover"
              />
            ) : (
              <div className="h-12 w-12 rounded-lg bg-neutral-100" />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-neutral-900">{item.nickname}</p>
              <p className="text-xs text-neutral-500">
                Rating {Number(item.rating).toFixed(2)} · {item.wins}W {item.losses}L {item.draws}D · {item.votes_received} votes
              </p>
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
