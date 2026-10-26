"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import DatingAdultNotice from "@/components/DatingAdultNotice";
import PaidPolicyNotice from "@/components/PaidPolicyNotice";

type MoreViewStatus = "none" | "pending" | "approved" | "rejected";
type MoreViewStatusResponse = {
  ok?: boolean;
  loggedIn?: boolean;
  male?: MoreViewStatus;
  female?: MoreViewStatus;
};

type MoreViewCard = {
  id: string;
  display_nickname: string | null;
  age: number | null;
  region: string | null;
  height_cm: number | null;
  job: string | null;
  ideal_type: string | null;
  image_urls: string[];
};

function MoreViewCardTile({ card }: { card: MoreViewCard }) {
  const imageUrl = card.image_urls[0] ?? null;

  return (
    <div className="overflow-hidden rounded-[26px] border border-neutral-200 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
      <div className="aspect-[4/5] bg-neutral-100">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-neutral-400">사진 없음</div>
        )}
      </div>
      <div className="p-4">
        <div className="flex items-end gap-2">
          <p className="text-lg font-black text-neutral-950">{card.display_nickname ?? "오픈카드"}</p>
          {card.age != null ? <span className="text-sm font-semibold text-neutral-500">{card.age}세</span> : null}
        </div>
        <div className="mt-2 flex flex-wrap gap-2 text-xs font-semibold text-neutral-500">
          {card.region ? <span className="rounded-full bg-neutral-100 px-3 py-1">{card.region}</span> : null}
          {card.height_cm != null ? <span className="rounded-full bg-neutral-100 px-3 py-1">{card.height_cm}cm</span> : null}
          {card.job ? <span className="rounded-full bg-neutral-100 px-3 py-1">{card.job}</span> : null}
        </div>
        {card.ideal_type ? <p className="mt-3 line-clamp-2 text-sm leading-6 text-neutral-600">{card.ideal_type}</p> : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href={`/community/dating/cards/${card.id}`}
            className="inline-flex min-h-[44px] items-center rounded-xl border border-neutral-300 bg-white px-3 text-xs font-medium text-neutral-700 hover:bg-neutral-100"
          >
            상세보기
          </Link>
          <Link
            href={`/community/dating/cards/${card.id}/apply`}
            className="inline-flex min-h-[44px] items-center rounded-xl bg-rose-600 px-3 text-xs font-semibold text-white hover:bg-rose-700"
          >
            지원하기
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function MoreViewPage() {
  const [status, setStatus] = useState<{ loggedIn: boolean; male: MoreViewStatus; female: MoreViewStatus }>({ loggedIn: false, male: "none", female: "none" });
  const [maleItems, setMaleItems] = useState<MoreViewCard[]>([]);
  const [femaleItems, setFemaleItems] = useState<MoreViewCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const loadStatus = useCallback(async () => {
    setLoading(true); setLoadError("");
    try {
      const res = await fetch("/api/dating/cards/more-view/status", { cache: "no-store" });
      if (!res.ok) throw new Error("STATUS_FAILED");
      const body = (await res.json()) as MoreViewStatusResponse;
      const next = { loggedIn: body.loggedIn === true, male: body.male ?? "none", female: body.female ?? "none" };
      setStatus(next);
      const readList = async (sex: "male" | "female", state: MoreViewStatus) => {
        if (state !== "approved") return [];
        const listRes = await fetch(`/api/dating/cards/more-view/list?sex=${sex}`, { cache: "no-store" });
        if (!listRes.ok) throw new Error("LIST_FAILED");
        const list = (await listRes.json()) as { items?: MoreViewCard[] };
        return Array.isArray(list.items) ? list.items : [];
      };
      const [male, female] = await Promise.all([readList("male", next.male), readList("female", next.female)]);
      setMaleItems(male); setFemaleItems(female);
    } catch { setLoadError("기존 이용 내역을 불러오지 못했어요. 잠시 후 다시 확인해 주세요."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void loadStatus(); }, [loadStatus]);

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <Link href="/community/dating/cards?tab=open_cards" className="inline-flex min-h-[44px] items-center text-sm text-neutral-500">오픈카드로</Link>
      <section className="mt-3 rounded-2xl border border-neutral-200 bg-white p-5">
        <h1 className="text-xl font-bold text-neutral-950">이상형 더보기 · 기존 이용 내역</h1>
        <p className="mt-2 text-sm leading-6 text-neutral-600">새로운 열람은 ‘가까운 이상형’에서 이용해 주세요. 기존 열람권은 남은 이용 기간 동안 여기서 확인할 수 있어요.</p>
        <Link href="/dating/nearby-view" className="mt-4 inline-flex min-h-[44px] items-center rounded-xl border border-neutral-200 px-4 text-sm font-semibold text-neutral-800 hover:bg-neutral-50">가까운 이상형 보기</Link>
        {loading ? <p role="status" className="mt-4 text-sm text-neutral-500">이용 내역 확인 중...</p> : loadError ? <div role="alert" className="mt-4 text-sm text-rose-700"><p>{loadError}</p><button type="button" onClick={() => void loadStatus()} className="min-h-[44px] underline">다시 확인</button></div> : (
          <div className="mt-4 flex flex-wrap gap-2">
            {(["male", "female"] as const).map(sex => <span key={sex} className="rounded-lg bg-neutral-50 px-3 py-2 text-xs text-neutral-600">{sex === "male" ? "남자 카드" : "여자 카드"} · {status[sex] === "approved" ? "이용 중" : status[sex] === "pending" ? "승인 대기" : "이용 중인 열람권 없음"}</span>)}
          </div>
        )}
      </section>
      <DatingAdultNotice />
      {!loading && !loadError && [{ sex: "male", title: "남자 카드 둘러보기", items: maleItems }, { sex: "female", title: "여자 카드 둘러보기", items: femaleItems }].map(section => section.items.length > 0 ? (
        <section key={section.sex} className="mt-6">
          <div className="mb-3 flex items-end justify-between"><h2 className="text-lg font-bold text-neutral-950">{section.title}</h2><span className="text-sm text-neutral-400">{section.items.length}명</span></div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{section.items.map(card => <MoreViewCardTile key={card.id} card={card} />)}</div>
        </section>
      ) : null)}
      <PaidPolicyNotice />
    </main>
  );
}
