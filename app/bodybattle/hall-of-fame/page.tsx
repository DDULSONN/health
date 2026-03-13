"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import { toBodyBattleImageUrl } from "@/lib/bodybattle-image";

type HofItem = {
  id: string;
  week_id: string;
  theme_label: string;
  nickname: string | null;
  image_url: string | null;
  rating: number;
  votes_received: number;
  wins: number;
  losses: number;
  draws: number;
  champion_comment: string | null;
};

type HofResponse = {
  ok: boolean;
  items: HofItem[];
};

export default function BodyBattleHallOfFamePage() {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<HofItem[]>([]);

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      try {
        const res = await fetch("/api/bodybattle/hall-of-fame?limit=60", { cache: "no-store" });
        const data = (await res.json()) as HofResponse;
        if (mounted) setItems(data.items ?? []);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">바디배틀 명예의 전당</h1>
          <p className="mt-1 text-sm text-neutral-500">Weekly champions archive</p>
        </div>
        <Link href="/bodybattle" className="text-sm text-neutral-500 hover:text-neutral-700">
          Back
        </Link>
      </div>

      {loading ? <p className="text-sm text-neutral-500">Loading...</p> : null}
      {!loading && items.length === 0 ? <p className="text-sm text-neutral-600">No champions yet.</p> : null}

      <section className="space-y-3">
        {items.map((item) => (
          <article key={item.id} className="rounded-2xl border border-neutral-200 bg-white p-4">
            <p className="text-xs font-semibold text-amber-700">
              {item.week_id} · {item.theme_label}
            </p>
            <div className="mt-2 flex gap-3">
              {item.image_url ? (
                <Image
                  src={toBodyBattleImageUrl(item.image_url, { width: 160, quality: 64 }) ?? item.image_url}
                  alt=""
                  width={96}
                  height={96}
                  unoptimized
                  className="h-20 w-20 rounded-lg object-cover"
                />
              ) : (
                <div className="h-20 w-20 rounded-lg bg-neutral-100" />
              )}
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-neutral-900">{item.nickname ?? "Unknown"}</p>
                <p className="text-xs text-neutral-600">
                  Rating {Number(item.rating).toFixed(2)} · {item.wins}W {item.losses}L {item.draws}D · {item.votes_received} votes
                </p>
                {item.champion_comment ? <p className="mt-1 text-xs text-neutral-500">{item.champion_comment}</p> : null}
              </div>
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
