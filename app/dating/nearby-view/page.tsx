"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import DatingAdultNotice from "@/components/DatingAdultNotice";
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
  weeklyBenefit?: {
    eligible: boolean;
    canClaim: boolean;
    weekId: string;
    claimedProvince: string | null;
    claimedAt: string | null;
  };
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
const NEARBY_VIEW_CACHE_KEY = "dating-nearby-view:v1";

type NearbyViewSnapshot = {
  status: CityStatusResponse;
  selectedProvince: string;
  activeSex: "male" | "female";
  items: CardItem[];
  scrollY: number;
};

function readNearbyViewSnapshot(): NearbyViewSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(NEARBY_VIEW_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as NearbyViewSnapshot;
  } catch {
    return null;
  }
}

function writeNearbyViewSnapshot(snapshot: NearbyViewSnapshot) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(NEARBY_VIEW_CACHE_KEY, JSON.stringify(snapshot));
  } catch {
    // ignore
  }
}

export default function NearbyViewPage() {
  const initialSnapshot = useMemo(() => readNearbyViewSnapshot(), []);
  const [submittingProvince, setSubmittingProvince] = useState("");
  const [checkoutProvince, setCheckoutProvince] = useState("");
  const [status, setStatus] = useState<CityStatusResponse>(
    initialSnapshot?.status ?? {
      loggedIn: false,
      activeCities: [],
      activeCityDetails: [],
      pendingCities: [],
      provinceStats: [],
      weeklyBenefit: { eligible: false, canClaim: false, weekId: "", claimedProvince: null, claimedAt: null },
    }
  );
  const [selectedProvince, setSelectedProvince] = useState<string>(initialSnapshot?.selectedProvince ?? "");
  const [activeSex, setActiveSex] = useState<"male" | "female">(initialSnapshot?.activeSex ?? "male");
  const [items, setItems] = useState<CardItem[]>(initialSnapshot?.items ?? []);
  const [loading, setLoading] = useState(() => !(initialSnapshot?.items?.length));
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => setTick((v) => v + 1), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!initialSnapshot) return;
    const restore = window.requestAnimationFrame(() => {
      window.scrollTo({ top: initialSnapshot.scrollY ?? 0, behavior: "auto" });
    });
    return () => window.cancelAnimationFrame(restore);
  }, [initialSnapshot]);

  useEffect(() => {
    const saveSnapshot = () => {
      writeNearbyViewSnapshot({
        status,
        selectedProvince,
        activeSex,
        items,
        scrollY: window.scrollY,
      });
    };

    saveSnapshot();
    window.addEventListener("pagehide", saveSnapshot);
    return () => window.removeEventListener("pagehide", saveSnapshot);
  }, [activeSex, items, selectedProvince, status]);

  const loadStatus = useCallback(async () => {
    const res = await fetch("/api/dating/cards/city-view/status", { cache: "no-store" });
    if (!res.ok) {
      setStatus({
        loggedIn: false,
        activeCities: [],
        activeCityDetails: [],
        pendingCities: [],
        provinceStats: [],
        weeklyBenefit: { eligible: false, canClaim: false, weekId: "", claimedProvince: null, claimedAt: null },
      });
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
      weeklyBenefit: body.weeklyBenefit ?? { eligible: false, canClaim: false, weekId: "", claimedProvince: null, claimedAt: null },
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
    queueMicrotask(() => {
      void loadStatus();
    });
  }, [loadStatus]);

  useEffect(() => {
    if (!selectedProvince) return;
    void loadList(selectedProvince);
  }, [selectedProvince, loadList]);

  const claimWeeklyBenefit = useCallback(
    async (province: string) => {
      if (!province || !status.loggedIn || submittingProvince) return;
      setSubmittingProvince(province);
      try {
        const res = await fetch("/api/dating/cards/city-view/request", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ province, useWeeklyBenefit: true }),
        });
        const body = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string; province?: string; status?: "approved" | "pending" };
        if (!res.ok || !body.ok) {
          alert(body.message ?? "주간 무료 열람 처리에 실패했습니다.");
          return;
        }
        if (body.message) alert(body.message);
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

  const requestCheckout = useCallback(
    async (province: string) => {
      if (!province || !status.loggedIn || checkoutProvince) return;
      setCheckoutProvince(province);
      try {
        const res = await fetch("/api/payments/toss/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ productType: "city_view", province }),
        });
        const body = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string; checkoutUrl?: string };

        if (!res.ok) {
          alert(body.message ?? "결제 요청에 실패했습니다.");
          return;
        }

        if (!body.checkoutUrl) {
          alert(body.message ?? "결제창을 불러오지 못했습니다.");
          return;
        }

        window.location.href = body.checkoutUrl;
      } catch {
        alert("결제 요청 처리 중 오류가 발생했습니다.");
      } finally {
        setCheckoutProvince("");
      }
    },
    [checkoutProvince, status.loggedIn]
  );

  const maleItems = useMemo(() => items.filter((i) => i.sex === "male"), [items]);
  const femaleItems = useMemo(() => items.filter((i) => i.sex === "female"), [items]);
  const selectedExpiresAt = useMemo(
    () => (status.activeCityDetails ?? []).find((v) => v.province === selectedProvince)?.expiresAt ?? null,
    [selectedProvince, status.activeCityDetails]
  );
  void tick;

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-4 flex items-center gap-2">
        <Link href="/community/dating/cards" className="rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50">
          오픈카드
        </Link>
        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm font-semibold text-emerald-700">가까운 이상형 보기</span>
      </div>

      <section className="rounded-[28px] border border-neutral-200 bg-white p-5 shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-2xl">
            <h1 className="text-[28px] font-black tracking-tight text-neutral-950">가까운 이상형 보기</h1>
            <p className="mt-2 text-sm text-neutral-600">지역별 대기 인원을 먼저 보고, 원하는 지역만 열어 바로 살펴볼 수 있어요.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <span className="rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1 text-xs font-semibold text-neutral-700">지역당 5,000원</span>
              <span className="rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1 text-xs font-semibold text-neutral-700">3시간 이용</span>
              <span className="rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1 text-xs font-semibold text-neutral-700">지원권 1장 추가</span>
            </div>
            <p className="mt-3 text-xs text-neutral-500">현재는 카카오페이 간편결제로만 결제 가능해요. 그 밖의 결제 문의는 오픈카톡으로 부탁드려요.</p>
          </div>

          <div className="w-full rounded-[24px] border border-neutral-200 bg-neutral-50 p-4 lg:max-w-sm">
            <p className="text-sm font-semibold text-neutral-800">오픈카드 유지 혜택</p>
            <p className="mt-1 text-sm text-neutral-600">오픈카드를 공개 중이거나 대기 중으로 유지하면, 매주 지역 1곳을 무료로 열어볼 수 있어요.</p>
            {status.weeklyBenefit?.eligible ? (
              status.weeklyBenefit.canClaim ? (
                <p className="mt-2 text-xs font-medium text-emerald-700">이번 주 무료 열람 1회가 남아 있어요.</p>
              ) : (
                <p className="mt-2 text-xs font-medium text-neutral-600">이번 주 무료 열람은 {status.weeklyBenefit.claimedProvince ?? "-"}에서 사용했어요.</p>
              )
            ) : (
              <p className="mt-2 text-xs text-neutral-500">이 혜택은 오픈카드를 유지 중인 회원에게만 제공됩니다.</p>
            )}
            <a
              href={OPEN_KAKAO_URL}
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-flex min-h-[40px] items-center rounded-xl border border-neutral-300 bg-white px-3 text-xs font-medium text-neutral-700 hover:bg-neutral-100"
            >
              오픈카톡 문의
            </a>
          </div>
        </div>
      </section>

      <DatingAdultNotice />

      <section className="mt-5 rounded-[28px] border border-neutral-200 bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
        <h2 className="mb-3 text-sm font-semibold text-neutral-800">지역별 대기 인원</h2>
        <div className="space-y-2">
          {(status.provinceStats ?? []).length === 0 ? <p className="text-xs text-neutral-500">대기 카드가 없습니다.</p> : null}
          {(status.provinceStats ?? []).map((stat) => {
            const isActive = (status.activeCities ?? []).includes(stat.province);
            const isPending = (status.pendingCities ?? []).includes(stat.province);

            return (
              <div key={stat.province} className="flex flex-col gap-3 rounded-[20px] border border-neutral-200 bg-neutral-50 px-4 py-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-sm font-semibold text-neutral-900">{stat.province}</p>
                  <p className="mt-1 text-xs text-neutral-500">
                    총 {stat.total}명 · 남 {stat.male} · 여 {stat.female}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {isActive ? (
                    <>
                      <button
                        type="button"
                        onClick={() => setSelectedProvince(stat.province)}
                        className={`inline-flex min-h-[36px] items-center rounded-xl px-3 text-xs font-semibold ${
                          selectedProvince === stat.province ? "bg-neutral-900 text-white" : "border border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100"
                        }`}
                      >
                        바로 보기
                      </button>
                      <span className="text-xs font-medium text-emerald-700">{formatRemaining(selectedExpiresAtFor(status.activeCityDetails ?? [], stat.province))}</span>
                    </>
                  ) : (
                    <>
                      {status.weeklyBenefit?.eligible && status.weeklyBenefit.canClaim ? (
                        <button
                          type="button"
                          onClick={() => void claimWeeklyBenefit(stat.province)}
                          disabled={!status.loggedIn || Boolean(submittingProvince)}
                          className="inline-flex min-h-[36px] items-center rounded-xl border border-emerald-300 bg-emerald-50 px-3 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {submittingProvince === stat.province ? "처리 중..." : "주간 무료 열람"}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => void requestCheckout(stat.province)}
                        disabled={!status.loggedIn || Boolean(checkoutProvince)}
                        className="inline-flex min-h-[36px] items-center rounded-xl bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {checkoutProvince === stat.province ? "결제창 준비 중..." : "카카오페이로 결제"}
                      </button>
                      {isPending ? <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-700">기존 요청 대기</span> : null}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="mt-5 rounded-[28px] border border-neutral-200 bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
        {!selectedProvince ? (
          <p className="text-sm text-neutral-500">결제나 무료 열람으로 열린 지역이 아직 없어요.</p>
        ) : loading ? (
          <p className="text-sm text-neutral-500">카드를 불러오는 중...</p>
        ) : (
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-neutral-800">{selectedProvince} 대기 카드</h2>
              <span className="text-xs font-medium text-emerald-700">남은 시간 {formatRemaining(selectedExpiresAt)}</span>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setActiveSex("male")}
                className={`inline-flex min-h-[36px] items-center rounded-xl px-3 text-xs font-semibold ${
                  activeSex === "male" ? "bg-neutral-900 text-white" : "border border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100"
                }`}
              >
                남자 {maleItems.length}명
              </button>
              <button
                type="button"
                onClick={() => setActiveSex("female")}
                className={`inline-flex min-h-[36px] items-center rounded-xl px-3 text-xs font-semibold ${
                  activeSex === "female" ? "bg-neutral-900 text-white" : "border border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100"
                }`}
              >
                여자 {femaleItems.length}명
              </button>
            </div>
            <CardSection
              title={activeSex === "male" ? `${selectedProvince} 남자 대기 카드` : `${selectedProvince} 여자 대기 카드`}
              items={activeSex === "male" ? maleItems : femaleItems}
              onNavigateAway={() =>
                writeNearbyViewSnapshot({
                  status,
                  selectedProvince,
                  activeSex,
                  items,
                  scrollY: window.scrollY,
                })
              }
            />
          </div>
        )}
      </section>
    </main>
  );
}

function selectedExpiresAtFor(details: Array<{ province: string; expiresAt: string }>, province: string): string | null {
  return details.find((v) => v.province === province)?.expiresAt ?? null;
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

function CardSection({
  title,
  items,
  onNavigateAway,
}: {
  title: string;
  items: CardItem[];
  onNavigateAway: () => void;
}) {
  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold text-neutral-800">{title}</h2>
      {items.length === 0 ? (
        <p className="text-xs text-neutral-500">현재 열린 카드가 없습니다.</p>
      ) : (
        <div className="grid grid-cols-1 gap-2">
          {items.map((card) => (
            <div key={card.id} className="rounded-[20px] border border-neutral-200 bg-neutral-50 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-neutral-900">
                  {card.display_nickname} {card.age != null ? `${card.age}세` : ""}
                </p>
                <div className="flex items-center gap-2">
                  <PhoneVerifiedBadge verified={card.is_phone_verified} />
                  <span className="text-xs text-neutral-500">{card.region ?? "-"}</span>
                </div>
              </div>
              {card.job ? <p className="mt-1 text-xs text-neutral-600">직업 {card.job}</p> : null}
              {card.ideal_type ? <p className="mt-1 truncate text-xs text-emerald-700">이상형 {card.ideal_type}</p> : null}
              <div className="mt-3 flex flex-wrap gap-2">
                <Link
                  href={`/community/dating/cards/${card.id}`}
                  onClick={onNavigateAway}
                  onTouchStart={onNavigateAway}
                  className="inline-flex min-h-[36px] items-center rounded-xl border border-neutral-300 bg-white px-3 text-xs font-medium text-neutral-700 hover:bg-neutral-100"
                >
                  상세보기
                </Link>
                <Link
                  href={`/community/dating/cards/${card.id}/apply`}
                  onClick={onNavigateAway}
                  onTouchStart={onNavigateAway}
                  className="inline-flex min-h-[36px] items-center rounded-xl bg-rose-600 px-3 text-xs font-semibold text-white hover:bg-rose-700"
                >
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
