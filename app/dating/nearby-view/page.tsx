"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

type CityStatusResponse = {
  ok?: boolean;
  loggedIn?: boolean;
  activeCities?: string[];
  pendingCities?: string[];
};

type CardItem = {
  id: string;
  sex: "male" | "female";
  display_nickname: string;
  age: number | null;
  region: string | null;
  job: string | null;
  ideal_type: string | null;
  image_urls: string[];
};

export default function NearbyViewPage() {
  const [cityInput, setCityInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<CityStatusResponse>({ loggedIn: false, activeCities: [], pendingCities: [] });
  const [selectedCity, setSelectedCity] = useState<string>("");
  const [items, setItems] = useState<CardItem[]>([]);
  const [loading, setLoading] = useState(false);

  const loadStatus = useCallback(async () => {
    const res = await fetch("/api/dating/cards/city-view/status", { cache: "no-store" });
    const body = (await res.json().catch(() => ({}))) as CityStatusResponse;
    const active = Array.isArray(body.activeCities) ? body.activeCities : [];
    setStatus({
      ok: body.ok,
      loggedIn: body.loggedIn === true,
      activeCities: active,
      pendingCities: Array.isArray(body.pendingCities) ? body.pendingCities : [],
    });
    if (!selectedCity && active.length > 0) {
      setSelectedCity(active[0]);
    }
  }, [selectedCity]);

  const loadList = useCallback(async (city: string) => {
    if (!city) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/dating/cards/city-view/list?city=${encodeURIComponent(city)}`, { cache: "no-store" });
      if (!res.ok) {
        setItems([]);
        return;
      }
      const body = (await res.json()) as { items?: CardItem[] };
      setItems(Array.isArray(body.items) ? body.items : []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (!selectedCity) return;
    void loadList(selectedCity);
  }, [selectedCity, loadList]);

  const handleRequest = useCallback(async () => {
    const city = cityInput.trim();
    if (!city || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/dating/cards/city-view/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ city }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string; city?: string };
      if (!res.ok || !body.ok) {
        alert(body.message ?? "신청에 실패했습니다.");
        return;
      }
      setCityInput("");
      await loadStatus();
      if (body.city) setSelectedCity(body.city);
    } finally {
      setSubmitting(false);
    }
  }, [cityInput, submitting, loadStatus]);

  const maleItems = useMemo(() => items.filter((i) => i.sex === "male"), [items]);
  const femaleItems = useMemo(() => items.filter((i) => i.sex === "female"), [items]);

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <div className="mb-4 flex items-center gap-2">
        <Link href="/community/dating/cards" className="rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50">
          오픈카드
        </Link>
        <span className="rounded-full border border-sky-300 bg-sky-50 px-3 py-1.5 text-sm font-semibold text-sky-700">내 가까운 이상형</span>
      </div>

      <section className="rounded-2xl border border-sky-200 bg-sky-50 p-5">
        <h1 className="text-lg font-bold text-sky-900">내 가까운 이상형</h1>
        <p className="mt-2 text-sm text-sky-800">도시를 신청하고 승인되면 해당 도시의 대기중 오픈카드를 3시간 동안 볼 수 있습니다.</p>
        <p className="mt-1 text-xs text-sky-900">가격: 도시당 5,000원</p>
        <p className="mt-1 text-xs text-sky-900">승인 시 지원권 1장이 추가 지급됩니다.</p>
        <p className="mt-1 text-xs text-sky-800">3시간 만료 후 같은 도시도 다시 신청 가능합니다.</p>

        <div className="mt-3 flex flex-wrap gap-2">
          <input
            value={cityInput}
            onChange={(e) => setCityInput(e.target.value)}
            placeholder="예: 수원, 동탄, 당진"
            className="min-h-[40px] min-w-[200px] rounded-lg border border-sky-300 bg-white px-3 text-sm"
          />
          <button
            type="button"
            onClick={() => void handleRequest()}
            disabled={!status.loggedIn || submitting}
            className="min-h-[40px] rounded-lg bg-sky-600 px-3 text-sm font-medium text-white disabled:opacity-50"
          >
            {submitting ? "신청 중..." : "도시 신청"}
          </button>
        </div>

        <p className="mt-2 text-xs text-sky-800">승인 대기 도시: {status.pendingCities?.join(", ") || "없음"}</p>
        {!status.loggedIn && <p className="mt-1 text-xs text-neutral-500">로그인 후 신청 가능합니다.</p>}
      </section>

      <section className="mt-5 rounded-2xl border border-neutral-200 bg-white p-4">
        <div className="mb-3 flex flex-wrap gap-2">
          {(status.activeCities ?? []).map((city) => (
            <button
              key={city}
              type="button"
              onClick={() => setSelectedCity(city)}
              className={`h-8 rounded-full border px-3 text-xs ${selectedCity === city ? "border-sky-600 bg-sky-600 text-white" : "border-sky-300 bg-sky-50 text-sky-700"}`}
            >
              {city}
            </button>
          ))}
        </div>

        {!selectedCity ? (
          <p className="text-sm text-neutral-500">승인된 도시가 없습니다.</p>
        ) : loading ? (
          <p className="text-sm text-neutral-500">불러오는 중...</p>
        ) : (
          <div className="space-y-5">
            <CardSection title={`${selectedCity} 남자 대기카드`} items={maleItems} />
            <CardSection title={`${selectedCity} 여자 대기카드`} items={femaleItems} />
          </div>
        )}
      </section>
    </main>
  );
}

function CardSection({ title, items }: { title: string; items: CardItem[] }) {
  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold text-neutral-800">{title}</h2>
      {items.length === 0 ? (
        <p className="text-xs text-neutral-500">대기중 카드가 없습니다.</p>
      ) : (
        <div className="grid grid-cols-1 gap-2">
          {items.map((card) => (
            <div key={card.id} className="rounded-xl border border-neutral-200 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-neutral-900">
                  {card.display_nickname} {card.age != null ? `${card.age}세` : ""}
                </p>
                <span className="text-xs text-neutral-500">{card.region ?? "-"}</span>
              </div>
              {card.job && <p className="mt-1 text-xs text-neutral-600">직업 {card.job}</p>}
              {card.ideal_type && <p className="mt-1 truncate text-xs text-pink-700">이상형: {card.ideal_type}</p>}
              <div className="mt-2 flex flex-wrap gap-2">
                <Link href={`/community/dating/cards/${card.id}`} className="inline-flex min-h-[36px] items-center rounded-md border border-neutral-300 px-3 text-xs text-neutral-700">
                  상세보기
                </Link>
                <Link href={`/community/dating/cards/${card.id}/apply`} className="inline-flex min-h-[36px] items-center rounded-md bg-pink-500 px-3 text-xs font-medium text-white">
                  지원하기
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
