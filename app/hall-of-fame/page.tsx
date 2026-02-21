import Link from "next/link";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { buildSignedImageUrl, extractStorageObjectPath } from "@/lib/images";

export const metadata: Metadata = {
  title: "명예의 전당 | GymTools",
  description: "주간 몸평 1위 기록을 확인해 보세요.",
};

type HallOfFameRow = {
  id: string;
  week_id: string;
  gender: "male" | "female";
  post_id: string;
  nickname: string | null;
  image_url: string | null;
  score_avg: number;
  vote_count: number;
};

export default async function HallOfFamePage() {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("hall_of_fame")
    .select("id, week_id, gender, post_id, nickname, image_url, score_avg, vote_count")
    .order("week_id", { ascending: false })
    .limit(104);

  if (error) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-8">
        <p className="text-sm text-red-600">명예의 전당을 불러오지 못했습니다: {error.message}</p>
      </main>
    );
  }

  const grouped = new Map<string, { male: HallOfFameRow | null; female: HallOfFameRow | null }>();
  for (const baseRow of (data ?? []) as HallOfFameRow[]) {
    const path = extractStorageObjectPath(baseRow.image_url, "community");
    const row: HallOfFameRow = {
      ...baseRow,
      image_url: path ? buildSignedImageUrl("community", path) : null,
    };
    if (!grouped.has(row.week_id)) {
      grouped.set(row.week_id, { male: null, female: null });
    }
    const week = grouped.get(row.week_id)!;
    if (row.gender === "male") week.male = row;
    if (row.gender === "female") week.female = row;
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-neutral-900">명예의 전당</h1>
        <p className="mt-1 text-sm text-neutral-500">주간 몸평 남/여 1위를 자동 기록합니다.</p>
      </div>

      {grouped.size === 0 ? (
        <p className="text-neutral-500">아직 기록이 없습니다.</p>
      ) : (
        <div className="space-y-4">
          {Array.from(grouped.entries()).map(([weekId, winners]) => (
            <section key={weekId} className="rounded-2xl border border-neutral-200 bg-white p-4">
              <p className="mb-2 text-sm font-semibold text-neutral-800">{weekId}</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <WinnerCard label="남자 1위" row={winners.male} />
                <WinnerCard label="여자 1위" row={winners.female} />
              </div>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}

function WinnerCard({ label, row }: { label: string; row: HallOfFameRow | null }) {
  if (!row) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
        <p className="text-xs font-semibold text-amber-700">{label}</p>
        <p className="mt-1 text-sm text-neutral-500">기록 없음</p>
      </div>
    );
  }

  return (
    <Link href={`/community/${row.post_id}`} className="block rounded-xl border border-amber-200 bg-amber-50 p-3">
      <p className="text-xs font-semibold text-amber-700">{label}</p>
      <p className="mt-1 text-sm font-semibold text-neutral-900">{row.nickname ?? "익명"}</p>
      <p className="mt-1 text-xs text-neutral-600">
        평균 {Number(row.score_avg).toFixed(2)} / {row.vote_count}표
      </p>
      {row.image_url && (
        <img
          src={row.image_url}
          alt=""
          className="mt-2 h-20 w-20 rounded-lg border border-amber-200 object-cover"
        />
      )}
    </Link>
  );
}
