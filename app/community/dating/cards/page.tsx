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
  male: { pending_count: number; public_count: number; slot_limit: number };
  female: { pending_count: number; public_count: number; slot_limit: number };
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
const OPEN_KAKAO_URL = "https://open.kakao.com/o/s2gvTdhi";

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
  const [moreViewStatus, setMoreViewStatus] = useState<{
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
  const [moreViewSubmitting, setMoreViewSubmitting] = useState<null | "male" | "female">(null);
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
          const mvStatusRes = await fetch("/api/dating/cards/more-view/status", { cache: "no-store" });
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
  const requestMoreView = useCallback(async (sex: "male" | "female") => {
    if (moreViewSubmitting) return;
    setMoreViewSubmitting(sex);
    const popup = window.open(OPEN_KAKAO_URL, "_blank", "noopener,noreferrer");
    try {
      const res = await fetch("/api/dating/cards/more-view/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sex }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        status?: MoreViewStatus;
        message?: string;
        requestRowId?: string;
      };
      if (!res.ok) {
        alert(body.message ?? "신청에 실패했습니다.");
        return;
      }
      if (body.status === "approved") {
        setMoreViewStatus((prev) => ({ ...prev, [sex]: "approved", loggedIn: true }));
        alert("이미 승인된 상태입니다. 구매 후 3시간 이용, 랜덤 10명 고정 노출입니다.");
      } else {
        setMoreViewStatus((prev) => ({ ...prev, [sex]: "pending", loggedIn: true }));
        if (body.requestRowId) {
          alert(`신청 접수 완료 (${body.requestRowId}). 구매 후 3시간 이용/랜덤 10명 고정입니다. 오픈카톡으로 닉네임 + 신청ID를 보내주세요.`);
        } else {
          alert("신청이 접수되었습니다. 구매 후 3시간 이용/랜덤 10명 고정입니다. 오픈카톡으로 닉네임을 보내주세요.");
        }
      }
      await loadInitial();
    } catch {
      alert("신청 처리 중 오류가 발생했습니다.");
    } finally {
      if (!popup || popup.closed) {
        window.open(OPEN_KAKAO_URL, "_blank", "noopener,noreferrer");
      }
      setMoreViewSubmitting(null);
    }
  }, [loadInitial, moreViewSubmitting]);

  return (
    <main className="max-w-3xl mx-auto px-4 py-6">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="rounded-full border border-neutral-300 bg-neutral-900 px-3 py-1.5 text-sm font-semibold text-white">오픈카드</span>
        <Link href="/dating/paid" className="rounded-full border border-rose-300 bg-rose-50 px-3 py-1.5 text-sm font-semibold text-rose-700 hover:bg-rose-100">
          🔥24시간 고정
        </Link>
      </div>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">오픈카드</h1>
          <p className="text-sm text-neutral-500 mt-1">공개 카드는 48시간 동안 노출됩니다.</p>
          <p className="text-xs text-rose-600 mt-1">현재 24시간 고정 {paidCount}명 노출중</p>
          <p className="text-xs text-neutral-500 mt-1">
            대기열: 남자 {queueStats?.male.pending_count ?? 0}명 / 여자 {queueStats?.female.pending_count ?? 0}명
          </p>
          <p className="text-xs text-neutral-500 mt-1">지원-수락(매칭) 누적 {queueStats?.accepted_matches_count ?? 0}명</p>
        </div>
        <Link
          href="/dating/card/new"
          className="inline-flex min-h-[40px] items-center rounded-lg border border-pink-200 bg-pink-50 px-3 text-sm font-medium text-pink-700 hover:bg-pink-100"
        >
          오픈카드 작성
        </Link>
      </div>
      <div className="mb-6 rounded-2xl border border-pink-200 bg-pink-50 p-4">
        <p className="text-sm font-semibold text-pink-800">이상형 더보기 신청 (유료)</p>
        <p className="mt-1 text-xs text-pink-700">구매 후 3시간 동안만 이용 가능하며, 대기열에서 랜덤 10명이 1회 고정으로 노출됩니다.</p>
        <p className="mt-1 text-xs text-pink-700">신청 후 오픈카톡으로 닉네임/신청ID를 보내주시면 승인 처리됩니다.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void requestMoreView("male")}
            disabled={!moreViewStatus.loggedIn || moreViewStatus.male === "approved" || moreViewSubmitting === "male"}
            className="min-h-[40px] rounded-lg border border-pink-300 bg-white px-3 text-xs font-medium text-pink-700 disabled:opacity-50"
          >
            남자 더보기 {moreViewStatus.male === "approved" ? "승인됨" : moreViewStatus.male === "pending" ? "심사중" : "신청"}
          </button>
          <button
            type="button"
            onClick={() => void requestMoreView("female")}
            disabled={!moreViewStatus.loggedIn || moreViewStatus.female === "approved" || moreViewSubmitting === "female"}
            className="min-h-[40px] rounded-lg border border-pink-300 bg-white px-3 text-xs font-medium text-pink-700 disabled:opacity-50"
          >
            여자 더보기 {moreViewStatus.female === "approved" ? "승인됨" : moreViewStatus.female === "pending" ? "심사중" : "신청"}
          </button>
          {!moreViewStatus.loggedIn && <span className="inline-flex items-center text-xs text-neutral-500">로그인 후 신청 가능</span>}
        </div>
      </div>

      {loading ? (
        <p className="text-neutral-400 text-center py-10">불러오는 중...</p>
      ) : (
        <div className="space-y-8">
          <Section
            title="남자 오픈카드"
            currentCount={queueStats?.male.public_count ?? males.length}
            paidItems={malePaidItems}
            items={males}
            moreViewItems={moreViewMale}
            hasMore={maleHasMore}
            onMore={loadMoreMale}
          />
          <Section
            title="여자 오픈카드"
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
        {title} <span className="text-sm font-medium text-neutral-500">({currentCount}명 공개중)</span>
      </h2>
      {!hasAnyItems ? (
        <p className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-500">현재 공개된 카드가 없습니다.</p>
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
              <p className="mb-2 px-1 text-xs font-semibold text-pink-700">이상형 더보기 (랜덤 10명)</p>
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
              더 보기
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
          <span className="inline-flex rounded-full bg-rose-500 px-2 py-0.5 text-xs font-semibold text-white">24시간 고정</span>
          <span className="font-semibold text-neutral-900">{card.nickname}</span>
          {card.age != null && <span>{card.age}세</span>}
          {card.region && <span>{card.region}</span>}
        </div>
        {card.expires_at && (
          <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">⏳ {formatRemainingToKorean(card.expires_at)}</span>
        )}
      </div>

      {card.thumbUrl ? (
        <div className="mt-3 h-44 overflow-hidden rounded-xl border border-rose-100 bg-white">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={card.thumbUrl} alt="" className="h-full w-full object-contain" />
        </div>
      ) : (
        <div className="mt-3 h-44 rounded-xl border border-rose-100 bg-white" />
      )}

      <div className="mt-2 flex flex-wrap gap-2 text-xs text-neutral-600">
        {card.height_cm != null && <span>키 {card.height_cm}cm</span>}
        {card.job && <span>직업 {card.job}</span>}
        {card.training_years != null && <span>운동 {card.training_years}년</span>}
        {card.is_3lift_verified && <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">3대인증 완료</span>}
      </div>

      {card.ideal_text && <p className="mt-2 text-xs text-pink-700 truncate">💘 이상형: {card.ideal_text}</p>}
      {card.strengths_text && <p className="mt-1 text-xs text-emerald-700 truncate">✨ 내 장점: {card.strengths_text}</p>}

      <div className="mt-3 flex flex-wrap gap-2">
        <Link
          href={`/dating/paid/${card.id}`}
          className="inline-flex min-h-[40px] items-center rounded-lg border border-neutral-300 px-4 text-sm text-neutral-700 hover:bg-neutral-50"
        >
          상세보기
        </Link>
        <Link
          href={`/dating/paid/${card.id}/apply`}
          className="inline-flex min-h-[40px] items-center rounded-lg bg-pink-500 px-4 text-sm font-medium text-white hover:bg-pink-600"
        >
          지원하기
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
          {card.expires_at ? `⏳ ${formatRemainingToKorean(card.expires_at)}` : "대기열"}
        </span>
      </div>

      <div
        className={`mt-3 w-full rounded-xl border border-neutral-100 bg-neutral-50 overflow-hidden ${
          card.image_urls.length >= 2 ? "grid grid-cols-2 gap-1 h-44" : "h-44 flex items-center justify-center"
        }`}
      >
        {card.image_urls.length > 0 ? (
          card.image_urls.map((url, idx) => (
            <div key={`${card.id}-${idx}`} className="h-full w-full flex items-center justify-center bg-neutral-50">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt=""
                className={`h-full w-full object-contain ${card.photo_visibility === "public" ? "" : "blur-[9px]"}`}
              />
            </div>
          ))
        ) : (
          <div className="h-full w-full animate-pulse bg-neutral-100" />
        )}
      </div>

      <div className="mt-2 flex flex-wrap gap-2 text-xs text-neutral-600">
        {card.height_cm != null && <span>키 {card.height_cm}cm</span>}
        {card.job && <span>직업 {card.job}</span>}
        {card.training_years != null && <span>운동 {card.training_years}년</span>}
        {card.is_3lift_verified && (
          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">3대인증 완료</span>
        )}
      </div>

      {ideal && <p className="mt-2 text-xs text-pink-700 truncate">💘 이상형: {ideal}</p>}
      {card.strengths_text && <p className="mt-1 text-xs text-emerald-700 truncate">✨ 내 장점: {card.strengths_text}</p>}

      {card.sex === "male" && (
        <div className="mt-2 flex flex-wrap gap-2">
          {card.total_3lift != null && (
            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-rose-100 text-rose-700">3대 {card.total_3lift}kg</span>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <Link
          href={`/community/dating/cards/${card.id}`}
          className="inline-flex min-h-[40px] items-center rounded-lg border border-neutral-300 px-4 text-sm text-neutral-700 hover:bg-neutral-50"
        >
          상세보기
        </Link>
        <Link
          href={`/community/dating/cards/${card.id}/apply`}
          className="inline-flex min-h-[40px] items-center rounded-lg bg-pink-500 px-4 text-sm font-medium text-white hover:bg-pink-600"
        >
          지원하기
        </Link>
      </div>
    </div>
  );
}
