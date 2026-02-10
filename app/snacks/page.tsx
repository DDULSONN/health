"use client";

import { useEffect, useState } from "react";
import CoupangEmbed from "@/components/CoupangEmbed";
import CoupangNotice from "@/components/CoupangNotice";
import AdSlot from "@/components/AdSlot";

interface EmbedItem {
  id: string;
  rank: number;
  embedHtml: string;
}

interface Section {
  key: string;
  title: string;
  items: EmbedItem[];
}

interface SnacksEmbedData {
  siteUpdatedAt: string;
  sections: Section[];
}

function getRankBadge(rank: number): string {
  if (rank === 1) return "🥇";
  if (rank === 2) return "🥈";
  if (rank === 3) return "🥉";
  return `#${rank}`;
}

export default function SnacksPage() {
  const [data, setData] = useState<SnacksEmbedData | null>(null);

  useEffect(() => {
    import("@/data/snacksEmbed.json").then((mod) => {
      setData(mod.default as SnacksEmbedData);
    });
  }, []);

  if (!data) {
    return (
      <main className="max-w-3xl mx-auto px-4 py-10">
        <p className="text-neutral-400 text-center">로딩 중...</p>
      </main>
    );
  }

  return (
    <main className="max-w-3xl mx-auto px-4 py-8">
      {/* Hero */}
      <section className="text-center mb-10">
        <h1 className="text-2xl font-bold text-neutral-900 leading-snug">
          헬창 주인장이 직접 먹어보고 고른
          <br />
          맛도리 다이어트 간식
        </h1>
        <p className="mt-2 text-sm text-neutral-400">
          최종 업데이트 · {data.siteUpdatedAt}
        </p>
      </section>

      {/* Sections */}
      {data.sections.map((section) => {
        const sorted = [...section.items].sort((a, b) => a.rank - b.rank);

        return (
          <section key={section.key} className="mb-12">
            <h2 className="text-lg font-bold text-neutral-800 mb-4 flex items-center gap-2">
              <span className="w-1 h-5 bg-emerald-500 rounded-full inline-block" />
              {section.title}
              <span className="text-xs font-normal text-neutral-400">
                맛있는 순
              </span>
            </h2>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {sorted.map((item) => (
                <div
                  key={item.id}
                  className="relative rounded-2xl bg-white border border-neutral-200 p-3 flex flex-col items-center hover:border-neutral-300 transition-colors"
                >
                  {/* 랭킹 뱃지 */}
                  <span className="absolute -top-2 -left-2 bg-amber-100 text-amber-800 text-xs font-bold px-2 py-0.5 rounded-full border border-amber-200 shadow-sm z-10">
                    {getRankBadge(item.rank)}
                  </span>

                  {/* iframe */}
                  <CoupangEmbed embedHtml={item.embedHtml} />
                </div>
              ))}
            </div>
          </section>
        );
      })}

      <AdSlot slotId="snacks-bottom" className="mb-6" />

      {/* 쿠팡 파트너스 고지문 */}
      <CoupangNotice />
    </main>
  );
}
