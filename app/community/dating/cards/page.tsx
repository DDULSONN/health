"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatRemainingToKorean } from "@/lib/dating-open";

type PublicCard = {
  id: string;
  sex: "male" | "female";
  display_nickname: string;
  age: number | null;
  region: string | null;
  height_cm: number | null;
  job: string | null;
  training_years: number | null;
  ideal_type: string | null;
  strengths_text: string | null;
  photo_visibility: "blur" | "public";
  total_3lift: number | null;
  is_3lift_verified: boolean;
  image_urls: string[];
  expires_at: string | null;
  created_at: string;
};

type QueueStats = {
  male: {
    pending_count: number;
    public_count: number;
    slot_limit: number;
    pending_regions?: Array<{ city: string; count: number }>;
  };
  female: {
    pending_count: number;
    public_count: number;
    slot_limit: number;
    pending_regions?: Array<{ city: string; count: number }>;
  };
  accepted_matches_count?: number;
};
type MoreViewStatus = "none" | "pending" | "approved" | "rejected";
type MoreViewStatusResponse = {
  ok?: boolean;
  loggedIn?: boolean;
  male?: MoreViewStatus;
  female?: MoreViewStatus;
};

type PaidCard = {
  id: string;
  nickname: string;
  gender: "M" | "F";
  age: number | null;
  region: string | null;
  height_cm: number | null;
  job: string | null;
  training_years: number | null;
  is_3lift_verified: boolean;
  strengths_text: string | null;
  ideal_text: string | null;
  thumbUrl: string;
  expires_at: string | null;
};

const PAGE_SIZE = 20;

function maskIdealTypeForPreview(value: string | null): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  const sensitivePattern =
    /(010|@|kakao|openchat|instagram|insta|\uCE74\uD1A1|\uC624\uD508\uCC44\uD305|\uC778\uC2A4\uD0C0)/i;
  if (sensitivePattern.test(raw)) return "***";
  return raw;
}

async function fetchBySex(
  sex: "male" | "female",
  _offsetLegacy: number,
  cursorCreatedAt: string | null,
  cursorId: string | null
) {
  const params = new URLSearchParams({ sex, limit: String(PAGE_SIZE) });
  if (cursorCreatedAt) params.set("cursorCreatedAt", cursorCreatedAt);
  if (cursorId) params.set("cursorId", cursorId);
  const res = await fetch(`/api/dating/cards/list?${params.toString()}`, { cache: "no-store" });
  if (!res.ok) throw new Error("failed to load open cards");
  return (await res.json()) as {
    items: PublicCard[];
    hasMore: boolean;
    nextCursorCreatedAt: string | null;
    nextCursorId: string | null;
  };
}

export default function OpenCardsPage() {
  const [males, setMales] = useState<PublicCard[]>([]);
  const [females, setFemales] = useState<PublicCard[]>([]);
  const [maleCursorCreatedAt, setMaleCursorCreatedAt] = useState<string | null>(null);
  const [maleCursorId, setMaleCursorId] = useState<string | null>(null);
  const [femaleCursorCreatedAt, setFemaleCursorCreatedAt] = useState<string | null>(null);
  const [femaleCursorId, setFemaleCursorId] = useState<string | null>(null);
  const [maleHasMore, setMaleHasMore] = useState(true);
  const [femaleHasMore, setFemaleHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [queueStats, setQueueStats] = useState<QueueStats | null>(null);
  const [paidItems, setPaidItems] = useState<PaidCard[]>([]);
  const [, setMoreViewStatus] = useState<{
    loggedIn: boolean;
    male: MoreViewStatus;
    female: MoreViewStatus;
  }>({
    loggedIn: false,
    male: "none",
    female: "none",
  });
  const [moreViewMale, setMoreViewMale] = useState<PublicCard[]>([]);
  const [moreViewFemale, setMoreViewFemale] = useState<PublicCard[]>([]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => setTick((v) => v + 1), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const loadInitial = useCallback(async () => {
    setLoading(true);
    try {
      const [m, f, qsRes, paidRes, mvStatusRes] = await Promise.all([
        fetchBySex("male", 0, null, null),
        fetchBySex("female", 0, null, null),
        fetch("/api/dating/cards/queue-stats", { cache: "no-store" }),
        fetch("/api/dating/paid/list", { cache: "no-store" }),
        fetch("/api/dating/cards/more-view/status", { cache: "no-store" }),
      ]);
      setMales(m.items ?? []);
      setFemales(f.items ?? []);
      setMaleCursorCreatedAt(m.nextCursorCreatedAt ?? null);
      setMaleCursorId(m.nextCursorId ?? null);
      setFemaleCursorCreatedAt(f.nextCursorCreatedAt ?? null);
      setFemaleCursorId(f.nextCursorId ?? null);
      setMaleHasMore(Boolean(m.hasMore));
      setFemaleHasMore(Boolean(f.hasMore));
      if (qsRes.ok) {
        const qsBody = (await qsRes.json()) as QueueStats;
        setQueueStats(qsBody);
      } else {
        setQueueStats(null);
      }
      if (paidRes.ok) {
        const paidBody = (await paidRes.json()) as { items?: PaidCard[] };
        setPaidItems(Array.isArray(paidBody.items) ? paidBody.items : []);
      } else {
        setPaidItems([]);
      }

      const mvStatusBody = (await mvStatusRes.json().catch(() => ({}))) as MoreViewStatusResponse;
      const nextStatus = {
        loggedIn: mvStatusBody.loggedIn === true,
        male: mvStatusBody.male ?? "none",
        female: mvStatusBody.female ?? "none",
      };
      setMoreViewStatus(nextStatus);

      const pendingFetches: Promise<void>[] = [];
      if (nextStatus.male === "approved") {
        pendingFetches.push(
          fetch("/api/dating/cards/more-view/list?sex=male", { cache: "no-store" })
            .then(async (res) => {
              if (!res.ok) return;
              const body = (await res.json()) as { items?: PublicCard[] };
              setMoreViewMale(Array.isArray(body.items) ? body.items : []);
            })
            .catch(() => undefined)
        );
      } else {
        setMoreViewMale([]);
      }
      if (nextStatus.female === "approved") {
        pendingFetches.push(
          fetch("/api/dating/cards/more-view/list?sex=female", { cache: "no-store" })
            .then(async (res) => {
              if (!res.ok) return;
              const body = (await res.json()) as { items?: PublicCard[] };
              setMoreViewFemale(Array.isArray(body.items) ? body.items : []);
            })
            .catch(() => undefined)
        );
      } else {
        setMoreViewFemale([]);
      }
      await Promise.all(pendingFetches);
    } catch (e) {
      console.error("open cards load failed", e);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void loadInitial();
    });
  }, [loadInitial]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void (async () => {
        try {
          const [mvStatusRes, qsRes] = await Promise.all([
            fetch("/api/dating/cards/more-view/status", { cache: "no-store" }),
            fetch("/api/dating/cards/queue-stats", { cache: "no-store" }),
          ]);
          if (qsRes.ok) {
            const qsBody = (await qsRes.json()) as QueueStats;
            setQueueStats(qsBody);
          }
          if (!mvStatusRes.ok) return;
          const mvStatusBody = (await mvStatusRes.json()) as MoreViewStatusResponse;
          const nextStatus = {
            loggedIn: mvStatusBody.loggedIn === true,
            male: mvStatusBody.male ?? "none",
            female: mvStatusBody.female ?? "none",
          };
          setMoreViewStatus(nextStatus);

          if (nextStatus.male === "approved") {
            const maleRes = await fetch("/api/dating/cards/more-view/list?sex=male", { cache: "no-store" });
            if (maleRes.ok) {
              const body = (await maleRes.json()) as { items?: PublicCard[] };
              setMoreViewMale(Array.isArray(body.items) ? body.items : []);
            }
          } else {
            setMoreViewMale([]);
          }
          if (nextStatus.female === "approved") {
            const femaleRes = await fetch("/api/dating/cards/more-view/list?sex=female", { cache: "no-store" });
            if (femaleRes.ok) {
              const body = (await femaleRes.json()) as { items?: PublicCard[] };
              setMoreViewFemale(Array.isArray(body.items) ? body.items : []);
            }
          } else {
            setMoreViewFemale([]);
          }
        } catch {
          // keep current UI state on polling error
        }
      })();
    }, 15000);

    return () => window.clearInterval(timer);
  }, []);

  const loadMoreMale = useCallback(async () => {
    if (!maleHasMore) return;
    try {
      const m = await fetchBySex("male", 0, maleCursorCreatedAt, maleCursorId);
      setMales((prev) => [...prev, ...(m.items ?? [])]);
      setMaleCursorCreatedAt(m.nextCursorCreatedAt ?? null);
      setMaleCursorId(m.nextCursorId ?? null);
      setMaleHasMore(Boolean(m.hasMore));
    } catch (e) {
      console.error("open cards load more male failed", e);
    }
  }, [maleHasMore, maleCursorCreatedAt, maleCursorId]);

  const loadMoreFemale = useCallback(async () => {
    if (!femaleHasMore) return;
    try {
      const f = await fetchBySex("female", 0, femaleCursorCreatedAt, femaleCursorId);
      setFemales((prev) => [...prev, ...(f.items ?? [])]);
      setFemaleCursorCreatedAt(f.nextCursorCreatedAt ?? null);
      setFemaleCursorId(f.nextCursorId ?? null);
      setFemaleHasMore(Boolean(f.hasMore));
    } catch (e) {
      console.error("open cards load more female failed", e);
    }
  }, [femaleHasMore, femaleCursorCreatedAt, femaleCursorId]);

  const nowLabel = useMemo(() => tick, [tick]);
  void nowLabel;
  const malePaidItems = useMemo(() => paidItems.filter((item) => item.gender === "M"), [paidItems]);
  const femalePaidItems = useMemo(() => paidItems.filter((item) => item.gender === "F"), [paidItems]);
  const paidCount = paidItems.length;
  return (
    <main className="max-w-3xl mx-auto px-4 py-6">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="rounded-full border border-neutral-300 bg-neutral-900 px-3 py-1.5 text-sm font-semibold text-white">?ㅽ뵂移대뱶</span>
        <Link href="/dating/paid" className="rounded-full border border-rose-300 bg-rose-50 px-3 py-1.5 text-sm font-semibold text-rose-700 hover:bg-rose-100">
          ?뵦24?쒓컙 怨좎젙
        </Link>
        <Link href="/dating/more-view" className="rounded-full border border-pink-300 bg-pink-50 px-3 py-1.5 text-sm font-semibold text-pink-700 hover:bg-pink-100">
          ?댁긽???붾낫湲?
        </Link>
        <Link href="/dating/nearby-view" className="rounded-full border border-sky-300 bg-sky-50 px-3 py-1.5 text-sm font-semibold text-sky-700 hover:bg-sky-100">
          내 가까운 이상형
        </Link>
      </div>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">?ㅽ뵂移대뱶</h1>
          <p className="text-sm text-neutral-500 mt-1">공개 카드는 36시간 동안 노출됩니다.</p>
          <p className="text-xs text-rose-600 mt-1">현재 24시간 고정 {paidCount}명 노출중</p>
          <p className="text-xs text-neutral-500 mt-1">대기열: 남자 {queueStats?.male.pending_count ?? 0}명 / 여자 {queueStats?.female.pending_count ?? 0}명</p>
          <p className="text-xs text-neutral-500 mt-1">대기열 분포(남): {queueStats?.male.pending_regions?.map((item) => `${item.city} ${item.count}`).join(" / ") || "-"}</p>
          <p className="text-xs text-neutral-500 mt-1">대기열 분포(여): {queueStats?.female.pending_regions?.map((item) => `${item.city} ${item.count}`).join(" / ") || "-"}</p>
          <p className="text-xs text-neutral-500 mt-1">지수 매칭(매칭) 누적 {queueStats?.accepted_matches_count ?? 0}명</p>
        </div>
        <Link
          href="/dating/card/new"
          className="inline-flex min-h-[40px] items-center rounded-lg border border-pink-200 bg-pink-50 px-3 text-sm font-medium text-pink-700 hover:bg-pink-100"
        >
          ?ㅽ뵂移대뱶 ?묒꽦
        </Link>
      </div>
      {loading ? (
        <p className="text-neutral-400 text-center py-10">遺덈윭?ㅻ뒗 以?..</p>
      ) : (
        <div className="space-y-8">
          <Section
            title="?⑥옄 ?ㅽ뵂移대뱶"
            currentCount={queueStats?.male.public_count ?? males.length}
            paidItems={malePaidItems}
            items={males}
            moreViewItems={moreViewMale}
            hasMore={maleHasMore}
            onMore={loadMoreMale}
          />
          <Section
            title="?ъ옄 ?ㅽ뵂移대뱶"
            currentCount={queueStats?.female.public_count ?? females.length}
            paidItems={femalePaidItems}
            items={females}
            moreViewItems={moreViewFemale}
            hasMore={femaleHasMore}
            onMore={loadMoreFemale}
          />
        </div>
      )}
    </main>
  );
}

function Section({
  title,
  currentCount,
  paidItems,
  items,
  moreViewItems,
  hasMore,
  onMore,
}: {
  title: string;
  currentCount: number;
  paidItems: PaidCard[];
  items: PublicCard[];
  moreViewItems: PublicCard[];
  hasMore: boolean;
  onMore: () => void;
}) {
  const hasAnyItems = paidItems.length > 0 || items.length > 0 || moreViewItems.length > 0;

  return (
    <section>
      <h2 className="text-lg font-bold text-neutral-800 mb-3">
        {title} <span className="text-sm font-medium text-neutral-500">({currentCount}紐?怨듦컻以?</span>
      </h2>
      {!hasAnyItems ? (
        <p className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-500">?꾩옱 怨듦컻??移대뱶媛 ?놁뒿?덈떎.</p>
      ) : (
        <>
          {paidItems.length > 0 && (
            <div className="mb-3 grid grid-cols-1 gap-3">
              {paidItems.map((card) => (
                <PaidCardRow key={card.id} card={card} />
              ))}
            </div>
          )}
          <div className="grid grid-cols-1 gap-3">
            {items.map((card) => (
              <CardRow key={card.id} card={card} />
            ))}
          </div>
          {moreViewItems.length > 0 && (
            <div className="mt-3 rounded-xl border border-dashed border-pink-300 bg-pink-50/60 p-2">
              <p className="mb-2 px-1 text-xs font-semibold text-pink-700">?댁긽???붾낫湲?(?쒕뜡 15紐?</p>
              <div className="grid grid-cols-1 gap-3">
                {moreViewItems.map((card) => (
                  <CardRow key={`more-${card.id}`} card={card} />
                ))}
              </div>
            </div>
          )}
          {hasMore && (
            <button
              type="button"
              onClick={onMore}
              className="mt-3 w-full min-h-[44px] rounded-xl border border-neutral-300 bg-white text-sm font-medium text-neutral-700 hover:bg-neutral-50"
            >
              ??蹂닿린
            </button>
          )}
        </>
      )}
    </section>
  );
}

function PaidCardRow({ card }: { card: PaidCard }) {
  return (
    <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-neutral-700">
          <span className="inline-flex rounded-full bg-rose-500 px-2 py-0.5 text-xs font-semibold text-white">24?쒓컙 怨좎젙</span>
          <span className="font-semibold text-neutral-900">{card.nickname}</span>
          {card.age != null && <span>{card.age}세</span>}
          {card.region && <span>{card.region}</span>}
        </div>
        {card.expires_at && (
          <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">??{formatRemainingToKorean(card.expires_at)}</span>
        )}
      </div>

      {card.thumbUrl ? (
        <div className="relative mt-3 flex h-44 items-center justify-center overflow-hidden rounded-xl border border-rose-100 bg-white">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={card.thumbUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-30 blur-sm" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={card.thumbUrl} alt="" className="relative z-10 max-h-full max-w-full h-auto w-auto object-contain object-center" />
        </div>
      ) : (
        <div className="mt-3 h-44 rounded-xl border border-rose-100 bg-white" />
      )}

      <div className="mt-2 flex flex-wrap gap-2 text-xs text-neutral-600">
        {card.height_cm != null && <span>??{card.height_cm}cm</span>}
        {card.job && <span>吏곸뾽 {card.job}</span>}
        {card.training_years != null && <span>운동 {card.training_years}년</span>}
        {card.is_3lift_verified && <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">3??몄쬆 ?꾨즺</span>}
      </div>

      {card.ideal_text && <p className="mt-2 text-xs text-pink-700 truncate">?뮊 ?댁긽?? {card.ideal_text}</p>}
      {card.strengths_text && <p className="mt-1 text-xs text-emerald-700 truncate">?????μ젏: {card.strengths_text}</p>}

      <div className="mt-3 flex flex-wrap gap-2">
        <Link
          href={`/dating/paid/${card.id}`}
          className="inline-flex min-h-[40px] items-center rounded-lg border border-neutral-300 px-4 text-sm text-neutral-700 hover:bg-neutral-50"
        >
          ?곸꽭蹂닿린
        </Link>
        <Link
          href={`/dating/paid/${card.id}/apply`}
          className="inline-flex min-h-[40px] items-center rounded-lg bg-pink-500 px-4 text-sm font-medium text-white hover:bg-pink-600"
        >
          吏?먰븯湲?
        </Link>
      </div>
    </div>
  );
}

function CardRow({ card }: { card: PublicCard }) {
  const ideal = maskIdealTypeForPreview(card.ideal_type);

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-neutral-700">
          <span className="font-semibold text-neutral-900">{card.display_nickname}</span>
          {card.age != null && <span>{card.age}세</span>}
          {card.region && <span>{card.region}</span>}
        </div>
        <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
          {card.expires_at ? `??${formatRemainingToKorean(card.expires_at)}` : "?湲곗뿴"}
        </span>
      </div>

      <div className="mt-3 h-36 w-full overflow-hidden rounded-xl border border-neutral-100 bg-neutral-50 md:h-44">
        {card.image_urls.length > 0 ? (
          <div className="relative flex h-full w-full items-center justify-center bg-neutral-50">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={card.image_urls[0]}
              alt=""
              className={`absolute inset-0 h-full w-full object-cover opacity-30 ${card.photo_visibility === "public" ? "blur-sm" : "blur-[10px]"}`}
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={card.image_urls[0]}
              alt=""
              className={`relative z-10 max-h-full max-w-full h-auto w-auto object-contain object-center ${card.photo_visibility === "public" ? "" : "blur-[9px]"}`}
            />
          </div>
        ) : (
          <div className="h-full w-full animate-pulse bg-neutral-100" />
        )}
      </div>

      <div className="mt-2 flex flex-wrap gap-2 text-xs text-neutral-600">
        {card.height_cm != null && <span>??{card.height_cm}cm</span>}
        {card.job && <span>吏곸뾽 {card.job}</span>}
        {card.training_years != null && <span>운동 {card.training_years}년</span>}
        {card.is_3lift_verified && (
          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">3??몄쬆 ?꾨즺</span>
        )}
      </div>

      {ideal && <p className="mt-2 text-xs text-pink-700 truncate">?뮊 ?댁긽?? {ideal}</p>}
      {card.strengths_text && <p className="mt-1 text-xs text-emerald-700 truncate">?????μ젏: {card.strengths_text}</p>}

      {card.sex === "male" && (
        <div className="mt-2 flex flex-wrap gap-2">
          {card.total_3lift != null && (
            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-rose-100 text-rose-700">3? {card.total_3lift}kg</span>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <Link
          href={`/community/dating/cards/${card.id}`}
          className="inline-flex min-h-[40px] items-center rounded-lg border border-neutral-300 px-4 text-sm text-neutral-700 hover:bg-neutral-50"
        >
          ?곸꽭蹂닿린
        </Link>
        <Link
          href={`/community/dating/cards/${card.id}/apply`}
          className="inline-flex min-h-[40px] items-center rounded-lg bg-pink-500 px-4 text-sm font-medium text-white hover:bg-pink-600"
        >
          吏?먰븯湲?
        </Link>
      </div>
    </div>
  );
}

