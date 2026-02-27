"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import PhoneVerifiedBadge from "@/components/PhoneVerifiedBadge";

type ProvinceStat = {
  province: string;
  total: number;
  male: number;
  female: number;
};

type CityStatusResponse = {
  ok?: boolean;
  loggedIn?: boolean;
  activeCities?: string[];
  activeCityDetails?: Array<{ province: string; expiresAt: string }>;
  pendingCities?: string[];
  provinceStats?: ProvinceStat[];
};

type CardItem = {
  id: string;
  sex: "male" | "female";
  display_nickname: string;
  is_phone_verified?: boolean;
  age: number | null;
  region: string | null;
  job: string | null;
  ideal_type: string | null;
  image_urls: string[];
};

const OPEN_KAKAO_URL = "https://open.kakao.com/o/s2gvTdhi";

export default function NearbyViewPage() {
  const [submittingProvince, setSubmittingProvince] = useState("");
  const [status, setStatus] = useState<CityStatusResponse>({ loggedIn: false, activeCities: [], activeCityDetails: [], pendingCities: [], provinceStats: [] });
  const [selectedProvince, setSelectedProvince] = useState<string>("");
  const [activeSex, setActiveSex] = useState<"male" | "female">("male");
  const [items, setItems] = useState<CardItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => setTick((v) => v + 1), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const loadStatus = useCallback(async () => {
    const res = await fetch("/api/dating/cards/city-view/status", { cache: "no-store" });
    if (!res.ok) {
      setStatus({ loggedIn: false, activeCities: [], activeCityDetails: [], pendingCities: [], provinceStats: [] });
      return;
    }
    const body = (await res.json().catch(() => ({}))) as CityStatusResponse;
    const active = Array.isArray(body.activeCities) ? body.activeCities : [];
    const activeCityDetails = Array.isArray(body.activeCityDetails) ? body.activeCityDetails : [];
    const pending = Array.isArray(body.pendingCities) ? body.pendingCities : [];
    const provinceStats = Array.isArray(body.provinceStats) ? body.provinceStats : [];

    setStatus({
      ok: body.ok,
      loggedIn: body.loggedIn === true,
      activeCities: active,
      activeCityDetails,
      pendingCities: pending,
      provinceStats,
    });

    if (!selectedProvince && active.length > 0) {
      setSelectedProvince(active[0]);
    }
  }, [selectedProvince]);

  const loadList = useCallback(async (province: string) => {
    if (!province) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/dating/cards/city-view/list?province=${encodeURIComponent(province)}`, { cache: "no-store" });
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
    if (!selectedProvince) return;
    void loadList(selectedProvince);
  }, [selectedProvince, loadList]);

  const handleRequestProvince = useCallback(
    async (province: string) => {
      if (!province || !status.loggedIn || submittingProvince) return;
      setSubmittingProvince(province);
      try {
        const res = await fetch("/api/dating/cards/city-view/request", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ province }),
        });
        const body = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string; province?: string; status?: "pending" | "approved" | "rejected" };
        if (!res.ok || !body.ok) {
          alert(body.message ?? "신청에 실패했습니다.");
          return;
        }
        await loadStatus();
        if (body.province && body.status === "approved") {
          setSelectedProvince(body.province);
        }
      } finally {
        setSubmittingProvince("");
      }
    },
    [loadStatus, status.loggedIn, submittingProvince]
  );

  const maleItems = useMemo(() => items.filter((i) => i.sex === "male"), [items]);
  const femaleItems = useMemo(() => items.filter((i) => i.sex === "female"), [items]);
  const selectedExpiresAt = useMemo(
    () => (status.activeCityDetails ?? []).find((v) => v.province === selectedProvince)?.expiresAt ?? null,
    [selectedProvince, status.activeCityDetails]
  );
  void tick;

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
        <p className="mt-2 text-sm text-sky-800">도/광역시별 대기 인원을 확인하고 신청하면, 승인 후 3시간 동안 해당 지역 대기 카드를 볼 수 있습니다.</p>
        <p className="mt-1 text-xs text-sky-900">가격: 지역당 5,000원</p>
        <p className="mt-1 text-xs text-sky-900">승인 시 지원권 1장 추가 지급</p>
        <p className="mt-1 text-xs text-sky-800">3시간 만료 후 같은 지역 재신청 가능</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <a
            href={OPEN_KAKAO_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-[34px] items-center rounded-md border border-sky-300 bg-white px-3 text-xs font-medium text-sky-700 hover:bg-sky-100"
          >
            오픈카톡 문의/구매
          </a>
          <span className="text-xs text-sky-800">입금 후 닉네임 + 신청 지역 전달하면 승인 처리됩니다.</span>
        </div>
        <p className="mt-1 text-[11px] text-sky-700">구매 안내: 승인 전에는 카드 열람이 불가하며, 승인 후 3시간 동안만 이용 가능합니다.</p>
        {!status.loggedIn && <p className="mt-2 text-xs text-neutral-500">로그인 후 신청 가능합니다.</p>}
      </section>

      <section className="mt-5 rounded-2xl border border-neutral-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-neutral-800">도/광역시별 대기 인원</h2>
        <div className="space-y-2">
          {(status.provinceStats ?? []).length === 0 && <p className="text-xs text-neutral-500">대기 카드가 없습니다.</p>}
          {(status.provinceStats ?? []).map((stat) => {
            const isActive = (status.activeCities ?? []).includes(stat.province);
            const isPending = (status.pendingCities ?? []).includes(stat.province);
            return (
              <div key={stat.province} className="flex items-center justify-between rounded-lg border border-neutral-200 px-3 py-2">
                <div>
                  <p className="text-sm font-medium text-neutral-900">{stat.province}</p>
                  <p className="text-xs text-neutral-600">
                    총 {stat.total}명 (남 {stat.male} / 여 {stat.female})
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {isActive ? (
                    <>
                      <button
                        type="button"
                        onClick={() => setSelectedProvince(stat.province)}
                        className={`h-8 rounded-md px-3 text-xs font-medium ${selectedProvince === stat.province ? "bg-sky-700 text-white" : "bg-sky-600 text-white hover:bg-sky-700"}`}
                      >
                        보기
                      </button>
                      <span className="text-xs text-sky-700">
                        {formatRemaining((status.activeCityDetails ?? []).find((v) => v.province === stat.province)?.expiresAt ?? null)}
                      </span>
                    </>
                  ) : isPending ? (
                    <span className="inline-flex h-8 items-center rounded-md border border-amber-300 bg-amber-50 px-3 text-xs font-medium text-amber-700">승인대기</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void handleRequestProvince(stat.province)}
                      disabled={!status.loggedIn || Boolean(submittingProvince)}
                      className="h-8 rounded-md bg-sky-600 px-3 text-xs font-medium text-white hover:bg-sky-700 disabled:opacity-50"
                    >
                      {submittingProvince === stat.province ? "신청 중..." : "신청"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="mt-5 rounded-2xl border border-neutral-200 bg-white p-4">
        {!selectedProvince ? (
          <p className="text-sm text-neutral-500">승인된 지역이 없습니다.</p>
        ) : loading ? (
          <p className="text-sm text-neutral-500">불러오는 중...</p>
        ) : (
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-neutral-800">{selectedProvince} 대기카드</h2>
              <span className="text-xs text-sky-700">남은 시간 {formatRemaining(selectedExpiresAt)}</span>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setActiveSex("male")}
                className={`h-8 rounded-md px-3 text-xs font-medium ${activeSex === "male" ? "bg-sky-700 text-white" : "border border-sky-300 bg-sky-50 text-sky-700"}`}
              >
                남자 {maleItems.length}명
              </button>
              <button
                type="button"
                onClick={() => setActiveSex("female")}
                className={`h-8 rounded-md px-3 text-xs font-medium ${activeSex === "female" ? "bg-pink-600 text-white" : "border border-pink-300 bg-pink-50 text-pink-700"}`}
              >
                여자 {femaleItems.length}명
              </button>
            </div>
            <CardSection title={activeSex === "male" ? `${selectedProvince} 남자 대기카드` : `${selectedProvince} 여자 대기카드`} items={activeSex === "male" ? maleItems : femaleItems} />
          </div>
        )}
      </section>
    </main>
  );
}

function formatRemaining(expiresAt: string | null): string {
  if (!expiresAt) return "-";
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return "만료";
  const totalMin = Math.floor(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}시간 ${m}분`;
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
                <PhoneVerifiedBadge verified={card.is_phone_verified} />
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
