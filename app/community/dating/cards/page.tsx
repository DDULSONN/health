"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DatingAdultNotice from "@/components/DatingAdultNotice";
import { formatRemainingToKorean } from "@/lib/dating-open";
import PhoneVerifiedBadge from "@/components/PhoneVerifiedBadge";
import { cacheOpenCardDetail, cachePaidCardDetail } from "@/lib/dating-detail-cache";

type PublicCard = {
  id: string;
  sex: "male" | "female";
  display_nickname: string;
  is_phone_verified?: boolean;
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
  is_phone_verified?: boolean;
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
  created_at: string;
  display_mode?: "priority_24h" | "instant_public";
};

type SwipeCandidate = {
  user_id: string;
  card_id: string;
  sex: "male" | "female";
  display_nickname: string;
  age: number | null;
  region: string | null;
  height_cm: number | null;
  job: string | null;
  training_years: number | null;
  ideal_type: string | null;
  strengths_text: string | null;
  total_3lift: number | null;
  is_3lift_verified: boolean;
  photo_visibility: "blur" | "public";
  image_url: string | null;
  source_status: string;
  created_at: string;
};

type SwipeState = {
  loggedIn: boolean;
  canSwipe: boolean;
  remaining: number;
  limit: number;
  candidate: SwipeCandidate | null;
  reason: string | null;
};

type SwipeRequestOptions = {
  preferCache?: boolean;
  silent?: boolean;
};

const PAGE_SIZE = 20;
const OPEN_CARDS_CACHE_KEY = "community-dating-open-cards:v1";

type OpenCardsSnapshot = {
  activeSex: "male" | "female";
  males: PublicCard[];
  females: PublicCard[];
  maleCursorCreatedAt: string | null;
  maleCursorId: string | null;
  femaleCursorCreatedAt: string | null;
  femaleCursorId: string | null;
  maleHasMore: boolean;
  femaleHasMore: boolean;
  queueStats: QueueStats | null;
  paidItems: PaidCard[];
  moreViewMale: PublicCard[];
  moreViewFemale: PublicCard[];
  scrollY?: number;
};

function readOpenCardsSnapshot(): OpenCardsSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(OPEN_CARDS_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as OpenCardsSnapshot;
  } catch {
    return null;
  }
}

function writeOpenCardsSnapshot(snapshot: OpenCardsSnapshot) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(OPEN_CARDS_CACHE_KEY, JSON.stringify(snapshot));
  } catch {
    // ignore cache write errors
  }
}

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
  const initialSnapshot = useMemo(() => readOpenCardsSnapshot(), []);
  const [activeSex, setActiveSex] = useState<"male" | "female">(initialSnapshot?.activeSex ?? "female");
  const [guideOpen, setGuideOpen] = useState(false);
  const [males, setMales] = useState<PublicCard[]>(initialSnapshot?.males ?? []);
  const [females, setFemales] = useState<PublicCard[]>(initialSnapshot?.females ?? []);
  const [maleCursorCreatedAt, setMaleCursorCreatedAt] = useState<string | null>(initialSnapshot?.maleCursorCreatedAt ?? null);
  const [maleCursorId, setMaleCursorId] = useState<string | null>(initialSnapshot?.maleCursorId ?? null);
  const [femaleCursorCreatedAt, setFemaleCursorCreatedAt] = useState<string | null>(initialSnapshot?.femaleCursorCreatedAt ?? null);
  const [femaleCursorId, setFemaleCursorId] = useState<string | null>(initialSnapshot?.femaleCursorId ?? null);
  const [maleHasMore, setMaleHasMore] = useState(initialSnapshot?.maleHasMore ?? true);
  const [femaleHasMore, setFemaleHasMore] = useState(initialSnapshot?.femaleHasMore ?? true);
  const [loading, setLoading] = useState(() => !(initialSnapshot && (initialSnapshot.males.length > 0 || initialSnapshot.females.length > 0)));
  const [queueStats, setQueueStats] = useState<QueueStats | null>(initialSnapshot?.queueStats ?? null);
  const [paidItems, setPaidItems] = useState<PaidCard[]>(initialSnapshot?.paidItems ?? []);
  const [, setMoreViewStatus] = useState<{
    loggedIn: boolean;
    male: MoreViewStatus;
    female: MoreViewStatus;
  }>({
    loggedIn: false,
    male: "none",
    female: "none",
  });
  const [moreViewMale, setMoreViewMale] = useState<PublicCard[]>(initialSnapshot?.moreViewMale ?? []);
  const [moreViewFemale, setMoreViewFemale] = useState<PublicCard[]>(initialSnapshot?.moreViewFemale ?? []);
  const [tick, setTick] = useState(0);
  const [swipeLoading, setSwipeLoading] = useState(true);
  const [swipeRefreshing, setSwipeRefreshing] = useState(false);
  const [swipeSubmitting, setSwipeSubmitting] = useState(false);
  const [swipeMessage, setSwipeMessage] = useState("");
  const [swipeImgFailed, setSwipeImgFailed] = useState(false);
  const [swipeState, setSwipeState] = useState<SwipeState>({
    loggedIn: false,
    canSwipe: false,
    remaining: 0,
    limit: 10,
    candidate: null,
    reason: null,
  });
  const activeSexRef = useRef<"male" | "female">(activeSex);
  const swipeCacheRef = useRef<Partial<Record<"male" | "female", SwipeState>>>({});
  const swipeRequestIdRef = useRef({ male: 0, female: 0 });

  useEffect(() => {
    activeSexRef.current = activeSex;
  }, [activeSex]);

  useEffect(() => {
    const timer = window.setInterval(() => setTick((v) => v + 1), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    writeOpenCardsSnapshot({
      activeSex,
      males,
      females,
      maleCursorCreatedAt,
      maleCursorId,
      femaleCursorCreatedAt,
      femaleCursorId,
      maleHasMore,
      femaleHasMore,
      queueStats,
      paidItems,
      moreViewMale,
      moreViewFemale,
      scrollY: typeof window !== "undefined" ? window.scrollY : 0,
    });
  }, [
    activeSex,
    females,
    femaleCursorCreatedAt,
    femaleCursorId,
    femaleHasMore,
    males,
    maleCursorCreatedAt,
    maleCursorId,
    maleHasMore,
    moreViewFemale,
    moreViewMale,
    paidItems,
    queueStats,
  ]);

  useEffect(() => {
    if (!initialSnapshot) return;
    const restore = window.requestAnimationFrame(() => {
      window.scrollTo({ top: initialSnapshot.scrollY ?? 0, behavior: "auto" });
    });
    return () => window.cancelAnimationFrame(restore);
  }, [initialSnapshot]);

  useEffect(() => {
    const saveSnapshot = () => {
      writeOpenCardsSnapshot({
        activeSex,
        males,
        females,
        maleCursorCreatedAt,
        maleCursorId,
        femaleCursorCreatedAt,
        femaleCursorId,
        maleHasMore,
        femaleHasMore,
        queueStats,
        paidItems,
        moreViewMale,
        moreViewFemale,
        scrollY: window.scrollY,
      });
    };

    window.addEventListener("pagehide", saveSnapshot);
    return () => window.removeEventListener("pagehide", saveSnapshot);
  }, [
    activeSex,
    femaleCursorCreatedAt,
    femaleCursorId,
    femaleHasMore,
    females,
    maleCursorCreatedAt,
    maleCursorId,
    maleHasMore,
    males,
    moreViewFemale,
    moreViewMale,
    paidItems,
    queueStats,
  ]);

  const refreshSecondary = useCallback(async () => {
    try {
      const [qsRes, paidRes, mvStatusRes] = await Promise.all([
        fetch("/api/dating/cards/queue-stats", { cache: "no-store" }),
        fetch("/api/dating/paid/list", { cache: "no-store" }),
        fetch("/api/dating/cards/more-view/status", { cache: "no-store" }),
      ]);
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
      console.error("open cards secondary load failed", e);
    }
  }, []);

  const loadInitial = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setLoading(true);
    }
    try {
      const [m, f] = await Promise.all([fetchBySex("male", 0, null, null), fetchBySex("female", 0, null, null)]);
      setMales(m.items ?? []);
      setFemales(f.items ?? []);
      setMaleCursorCreatedAt(m.nextCursorCreatedAt ?? null);
      setMaleCursorId(m.nextCursorId ?? null);
      setFemaleCursorCreatedAt(f.nextCursorCreatedAt ?? null);
      setFemaleCursorId(f.nextCursorId ?? null);
      setMaleHasMore(Boolean(m.hasMore));
      setFemaleHasMore(Boolean(f.hasMore));
      setLoading(false);
      void refreshSecondary();
    } catch (e) {
      console.error("open cards load failed", e);
      setLoading(false);
    }
  }, [refreshSecondary]);

  useEffect(() => {
    queueMicrotask(() => {
      void loadInitial({ silent: Boolean(initialSnapshot) });
    });
  }, [initialSnapshot, loadInitial]);

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

  const loadSwipe = useCallback(async (sex: "male" | "female", options?: SwipeRequestOptions) => {
    const { preferCache = true, silent = false } = options ?? {};
    const requestId = ++swipeRequestIdRef.current[sex];
    const cached = preferCache ? swipeCacheRef.current[sex] : undefined;
    const isActiveTab = activeSexRef.current === sex;

    if (isActiveTab) {
      if (cached) {
        setSwipeState(cached);
        setSwipeImgFailed(false);
        setSwipeLoading(false);
        setSwipeRefreshing(true);
      } else if (!silent) {
        setSwipeLoading(true);
        setSwipeRefreshing(false);
      }
    }

    try {
      const res = await fetch(`/api/dating/cards/swipe?sex=${sex}`, { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as SwipeState & { error?: string };
      if (!res.ok) {
        throw new Error(body.error ?? "스와이프 후보를 불러오지 못했습니다.");
      }
      const nextState = {
        loggedIn: body.loggedIn === true,
        canSwipe: body.canSwipe === true,
        remaining: Math.max(0, Number(body.remaining ?? 0)),
        limit: Math.max(1, Number(body.limit ?? 10)),
        candidate: body.candidate ?? null,
        reason: body.reason ?? null,
      };
      swipeCacheRef.current[sex] = nextState;
      if (activeSexRef.current === sex && swipeRequestIdRef.current[sex] === requestId) {
        setSwipeImgFailed(false);
        setSwipeState(nextState);
      }
    } catch (error) {
      console.error("swipe load failed", error);
      if (cached) return;
      const fallbackState = {
        loggedIn: false,
        canSwipe: false,
        remaining: 0,
        limit: 10,
        candidate: null,
        reason: error instanceof Error ? error.message : "스와이프 후보를 불러오지 못했습니다.",
      };
      if (activeSexRef.current === sex && swipeRequestIdRef.current[sex] === requestId) {
        setSwipeState(fallbackState);
      }
    } finally {
      if (activeSexRef.current === sex && swipeRequestIdRef.current[sex] === requestId) {
        setSwipeLoading(false);
        setSwipeRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    setSwipeMessage("");
    const otherSex = activeSex === "male" ? "female" : "male";
    void loadSwipe(activeSex, { preferCache: true });
    if (!swipeCacheRef.current[otherSex]) {
      void loadSwipe(otherSex, { preferCache: true, silent: true });
    }
  }, [activeSex, loadSwipe]);

  const handleSwipe = useCallback(
    async (action: "like" | "pass") => {
      if (!swipeState.candidate || swipeSubmitting) return;
      setSwipeSubmitting(true);
      setSwipeMessage("");
      try {
        const res = await fetch("/api/dating/cards/swipe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sex: activeSex,
            action,
            target_user_id: swipeState.candidate.user_id,
            target_card_id: swipeState.candidate.card_id,
          }),
        });
        const body = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
          match?: { other_instagram_id: string; other_nickname: string } | null;
        };
        if (!res.ok) {
          throw new Error(body.error ?? "처리에 실패했습니다.");
        }
        if (body.match?.other_instagram_id) {
          setSwipeMessage(`매칭 성사! 상대 인스타: @${body.match.other_instagram_id}`);
        } else if (action === "like") {
          setSwipeMessage("라이크를 보냈습니다.");
        } else {
          setSwipeMessage("다음 후보로 넘겼습니다.");
        }
        await loadSwipe(activeSex);
      } catch (error) {
        console.error("swipe submit failed", error);
        setSwipeMessage(error instanceof Error ? error.message : "처리에 실패했습니다.");
      } finally {
        setSwipeSubmitting(false);
      }
    },
    [activeSex, loadSwipe, swipeState.candidate, swipeSubmitting]
  );

  const nowLabel = useMemo(() => tick, [tick]);
  void nowLabel;
  const malePaidItems = useMemo(() => paidItems.filter((item) => item.gender === "M"), [paidItems]);
  const femalePaidItems = useMemo(() => paidItems.filter((item) => item.gender === "F"), [paidItems]);
  const fixedPaidCount = useMemo(
    () => paidItems.filter((item) => item.display_mode !== "instant_public").length,
    [paidItems]
  );
  const activeOpenItems = activeSex === "male" ? males : females;
  const activePaidItems = activeSex === "male" ? malePaidItems : femalePaidItems;
  const activeMoreViewItems = activeSex === "male" ? moreViewMale : moreViewFemale;
  const activeHasMore = activeSex === "male" ? maleHasMore : femaleHasMore;
  const activeCurrentCount = activeSex === "male" ? (queueStats?.male.public_count ?? males.length) : (queueStats?.female.public_count ?? females.length);
  return (
    <main className="max-w-3xl mx-auto px-4 py-6">
      <DatingAdultNotice />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="rounded-full border border-neutral-300 bg-neutral-900 px-3 py-1.5 text-sm font-semibold text-white">오픈카드</span>
        <Link
          href="/dating/paid"
          className="group inline-flex min-h-[44px] items-center gap-2 rounded-full border border-rose-300 bg-gradient-to-r from-rose-50 to-orange-50 px-3.5 py-1.5 text-sm font-semibold text-rose-700 shadow-sm ring-2 ring-rose-100 transition-all hover:-translate-y-0.5 hover:border-rose-400 hover:shadow-md"
        >
          <span className="rounded-full bg-rose-600 px-2 py-0.5 text-[11px] font-bold text-white">추천</span>
          <span>대기 없이 등록</span>
        </Link>
        <Link href="/dating/more-view" className="rounded-full border border-pink-300 bg-pink-50 px-3 py-1.5 text-sm font-semibold text-pink-700 hover:bg-pink-100">
          이상형 더보기
        </Link>
        <Link
          href="/dating/nearby-view"
          className="rounded-full border border-sky-300 bg-sky-50 px-3 py-1.5 text-sm font-semibold text-sky-700 hover:bg-sky-100"
        >
          내 가까운 이상형
        </Link>
      </div>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">오픈카드</h1>
          <p className="text-sm text-neutral-500 mt-1">공개 카드는 24시간 동안 노출되며, 수락 없이 종료되면 1회 자동으로 대기열에 다시 들어갈 수 있어요.</p>
          <p className="text-xs text-rose-600 mt-1">현재 36시간 고정 {fixedPaidCount}명 노출중</p>
          <p className="text-xs text-neutral-500 mt-1">대기열: 남자 {queueStats?.male.pending_count ?? 0}명 / 여자 {queueStats?.female.pending_count ?? 0}명</p>
          <p className="text-xs text-neutral-500 mt-1">누적 매칭 {queueStats?.accepted_matches_count ?? 0}명</p>
        </div>
        <Link
          href="/dating/card/new"
          className="inline-flex min-h-[40px] items-center rounded-lg border border-pink-200 bg-pink-50 px-3 text-sm font-medium text-pink-700 hover:bg-pink-100"
        >
          오픈카드 작성
        </Link>
      </div>

      <section className="mb-4 rounded-2xl border border-pink-200 bg-pink-50/70 p-4">
        <button
          type="button"
          onClick={() => setGuideOpen((prev) => !prev)}
          className="flex w-full items-center justify-between gap-3 text-left"
        >
          <div>
            <p className="text-sm font-semibold text-pink-800">💘 오픈카드 소개팅, 이렇게 보면 돼요</p>
            <p className="mt-1 text-xs text-pink-700">처음 들어와도 헷갈리지 않게, 핵심만 가볍게 정리했어요.</p>
          </div>
          <span className="inline-flex rounded-full bg-white px-3 py-1 text-xs font-semibold text-pink-700">
            {guideOpen ? "설명 접기" : "설명 보기"}
          </span>
        </button>

        {guideOpen && (
          <div className="mt-3 space-y-2 border-t border-pink-200 pt-3 text-sm text-neutral-700">
            <p>🪪 오픈카드를 만들면 공개 대기열에 들어가고, 공개되면 24시간 동안 보여져요.</p>
            <p>👀 마음에 드는 사람 카드가 있으면 지원할 수 있고, 내 카드에도 다른 사람이 지원할 수 있어요.</p>
            <p>💌 카드 주인이 지원자 중 한 명을 수락하면 연결이 성사되고, 그 카드는 목록에서 내려가요.</p>
            <p>⚡ 빠른 매칭은 카드 목록과 별도로, 랜덤 후보를 빠르게 넘기면서 라이크하는 기능이에요.</p>
            <p>🔒 지원서가 수락되면 마이페이지에서 서로 인스타그램 아이디가 자동으로 교환돼요.</p>
            <p>🔁 공개가 끝날 때까지 지원을 수락하지 않았다면, 카드가 1회 자동으로 대기열에 다시 들어가 한 번 더 노출될 수 있어요.</p>
            <p>🌟 카드가 아직 대기 상태여도 가까운 이상형, 이상형 더보기 같은 기능으로 누군가 내 카드에 지원할 수 있어요.</p>
            <p>📬 그래서 지원이 왔는지 놓치지 않게 마이페이지를 자주 확인해주는 게 좋아요.</p>
          </div>
        )}
      </section>

      <div className="mb-4 flex gap-2">
        <button
          type="button"
          onClick={() => setActiveSex("male")}
          className={`inline-flex min-h-[40px] items-center rounded-full border px-4 text-sm font-semibold ${
            activeSex === "male"
              ? "border-sky-500 bg-sky-500 text-white"
              : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50"
          }`}
        >
          남자 카드
        </button>
        <button
          type="button"
          onClick={() => setActiveSex("female")}
          className={`inline-flex min-h-[40px] items-center rounded-full border px-4 text-sm font-semibold ${
            activeSex === "female"
              ? "border-pink-500 bg-pink-500 text-white"
              : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50"
          }`}
        >
          여자 카드
        </button>
      </div>

      <section className="mb-6 rounded-2xl border border-amber-200 bg-amber-50/80 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-neutral-900">빠른 매칭</h2>
            <p className="mt-1 text-xs text-neutral-600">
              오픈카드 이력 중 랜덤으로 하루 최대 {swipeState.limit}명을 빠르게 확인할 수 있습니다.
              <br />
              서로 라이크하면 자동 매칭되며, 다음 후보가 바로 표시됩니다.
            </p>
          </div>
          <span className="inline-flex rounded-full bg-white px-3 py-1 text-xs font-semibold text-amber-700">
            오늘 남은 횟수 {swipeState.remaining}
          </span>
        </div>
        {swipeRefreshing && !swipeLoading ? (
          <p className="mt-2 text-xs font-medium text-neutral-500">최신 후보로 조용히 업데이트 중...</p>
        ) : null}
        {swipeMessage && <p className="mt-3 text-sm font-medium text-emerald-700">{swipeMessage}</p>}
        {swipeLoading ? (
          <p className="mt-4 text-sm text-neutral-500">후보를 불러오는 중...</p>
        ) : !swipeState.candidate ? (
          <p className="mt-4 text-sm text-neutral-600">{swipeState.reason ?? "현재 보여줄 후보가 없습니다."}</p>
        ) : (
          <div className="mt-4 rounded-2xl border border-white/80 bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2 text-sm text-neutral-700">
                <span className="font-semibold text-neutral-900">{swipeState.candidate.display_nickname}</span>
                {swipeState.candidate.age != null && <span>{swipeState.candidate.age}세</span>}
                {swipeState.candidate.region && <span>{swipeState.candidate.region}</span>}
              </div>
              <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                {swipeState.candidate.source_status === "public" ? "공개중" : "지난 카드"}
              </span>
            </div>

            <div className="mt-3 flex h-56 w-full items-center justify-center overflow-hidden rounded-xl border border-amber-100 bg-neutral-50">
              {swipeState.candidate.image_url && !swipeImgFailed ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={swipeState.candidate.image_url}
                  alt=""
                  decoding="async"
                  onError={() => setSwipeImgFailed(true)}
                  className={`max-h-full max-w-full object-contain ${
                    swipeState.candidate.photo_visibility === "public" ? "" : "blur-[9px]"
                  }`}
                />
              ) : (
                <span className="text-sm text-neutral-400">사진 없음</span>
              )}
            </div>

            <div className="mt-3 flex flex-wrap gap-2 text-xs text-neutral-600">
              {swipeState.candidate.height_cm != null && <span>키 {swipeState.candidate.height_cm}cm</span>}
              {swipeState.candidate.job && <span>직업 {swipeState.candidate.job}</span>}
              {swipeState.candidate.training_years != null && <span>운동 {swipeState.candidate.training_years}년</span>}
              {swipeState.candidate.is_3lift_verified && (
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">3대인증 완료</span>
              )}
              {swipeState.candidate.sex === "male" && swipeState.candidate.total_3lift != null && (
                <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-700">
                  3대 {swipeState.candidate.total_3lift}kg
                </span>
              )}
            </div>
            {swipeState.candidate.ideal_type && (
              <p className="mt-2 line-clamp-2 text-xs text-pink-700">이상형: {maskIdealTypeForPreview(swipeState.candidate.ideal_type)}</p>
            )}
            {swipeState.candidate.strengths_text && (
              <p className="mt-1 line-clamp-2 text-xs text-emerald-700">내 장점: {swipeState.candidate.strengths_text}</p>
            )}

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => void handleSwipe("pass")}
                disabled={swipeSubmitting}
                className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-xl border border-neutral-300 bg-white px-4 text-sm font-medium text-neutral-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                넘기기
              </button>
              <button
                type="button"
                onClick={() => void handleSwipe("like")}
                disabled={swipeSubmitting}
                className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-xl bg-pink-500 px-4 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                라이크
              </button>
            </div>
          </div>
        )}
      </section>

      {loading ? (
        <p className="text-neutral-400 text-center py-10">불러오는 중...</p>
      ) : (
        <Section
          title={activeSex === "male" ? "남자 오픈카드" : "여자 오픈카드"}
          currentCount={activeCurrentCount}
          paidItems={activePaidItems}
          items={activeOpenItems}
          moreViewItems={activeMoreViewItems}
          hasMore={activeHasMore}
          onMore={activeSex === "male" ? loadMoreMale : loadMoreFemale}
        />
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
  const pinnedPaidItems = paidItems.filter((card) => card.display_mode !== "instant_public");
  const instantPaidItems = paidItems.filter((card) => card.display_mode === "instant_public");
  const hasAnyItems = pinnedPaidItems.length > 0 || items.length > 0 || instantPaidItems.length > 0 || moreViewItems.length > 0;

  return (
    <section>
      <h2 className="text-lg font-bold text-neutral-800 mb-3">
        {title} <span className="text-sm font-medium text-neutral-500">({currentCount}명 공개중)</span>
      </h2>
      {!hasAnyItems ? (
        <p className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-500">현재 공개중인 카드가 없습니다.</p>
      ) : (
        <>
          {pinnedPaidItems.length > 0 && (
            <div className="mb-3 grid grid-cols-1 gap-3">
              {pinnedPaidItems.map((card) => (
                <PaidCardRow key={card.id} card={card} />
              ))}
            </div>
          )}
          <div className="grid grid-cols-1 gap-3">
            {items.map((card) => (
              <CardRow key={card.id} card={card} />
            ))}
            {instantPaidItems.map((card) => (
              <PaidCardRow key={`paid-${card.id}`} card={card} />
            ))}
          </div>
          {moreViewItems.length > 0 && (
            <div className="mt-3 rounded-xl border border-dashed border-pink-300 bg-pink-50/60 p-2">
              <p className="mb-2 px-1 text-xs font-semibold text-pink-700">이상형 더보기 (추가 25명)</p>
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
              더보기
            </button>
          )}
        </>
      )}
    </section>
  );
}

function PaidCardRow({ card }: { card: PaidCard }) {
  const router = useRouter();
  const isPriority = card.display_mode !== "instant_public";
  const detailHref = `/dating/paid/${card.id}`;
  const applyHref = `/dating/paid/${card.id}/apply`;
  const warmRoute = useCallback(() => {
    cachePaidCardDetail(card.id, {
      id: card.id,
      nickname: card.nickname,
      is_phone_verified: card.is_phone_verified,
      gender: card.gender,
      age: card.age,
      region: card.region,
      height_cm: card.height_cm,
      job: card.job,
      training_years: card.training_years,
      strengths_text: card.strengths_text,
      ideal_text: card.ideal_text,
      intro_text: null,
      expires_at: card.expires_at,
      image_urls: card.thumbUrl ? [card.thumbUrl] : [],
      photo_visibility: "public",
    });
    router.prefetch(detailHref);
    router.prefetch(applyHref);
  }, [applyHref, card, detailHref, router]);
  const rememberScroll = useCallback(() => {
    const snapshot = readOpenCardsSnapshot();
    if (!snapshot) return;
    writeOpenCardsSnapshot({
      ...snapshot,
      scrollY: window.scrollY,
    });
  }, []);

  return (
    <div className={`rounded-2xl border p-4 ${isPriority ? "border-rose-200 bg-rose-50" : "border-neutral-200 bg-white"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-neutral-700">
          {isPriority && (
            <span className="inline-flex rounded-full bg-rose-500 px-2 py-0.5 text-xs font-semibold text-white">🔥36시간 고정</span>
          )}
          <span className="font-semibold text-neutral-900">{card.nickname}</span>
          <PhoneVerifiedBadge verified={card.is_phone_verified} />
          {card.age != null && <span>{card.age}세</span>}
          {card.region && <span>{card.region}</span>}
        </div>
        {card.expires_at && (
          <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">잔여 {formatRemainingToKorean(card.expires_at)}</span>
        )}
      </div>

      {card.thumbUrl ? (
        <div className="relative mt-3 flex h-44 items-center justify-center overflow-hidden rounded-xl border border-rose-100 bg-white">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={card.thumbUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className="absolute inset-0 h-full w-full object-cover opacity-30 blur-sm"
          />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={card.thumbUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className="relative z-10 max-h-full max-w-full h-auto w-auto object-contain object-center"
          />
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

      {card.ideal_text && <p className="mt-2 text-xs text-pink-700 truncate">이상형: {card.ideal_text}</p>}
      {card.strengths_text && <p className="mt-1 text-xs text-emerald-700 truncate">내 장점: {card.strengths_text}</p>}

      <div className="mt-3 flex flex-wrap gap-2">
        <Link
          href={detailHref}
          prefetch
          onMouseEnter={warmRoute}
          onClick={rememberScroll}
          onTouchStart={warmRoute}
          onTouchEnd={rememberScroll}
          className="inline-flex min-h-[40px] items-center rounded-lg border border-neutral-300 px-4 text-sm text-neutral-700 hover:bg-neutral-50"
        >
          상세보기
        </Link>
        <Link
          href={applyHref}
          prefetch
          onMouseEnter={warmRoute}
          onClick={rememberScroll}
          onTouchStart={warmRoute}
          onTouchEnd={rememberScroll}
          className="inline-flex min-h-[40px] items-center rounded-lg bg-pink-500 px-4 text-sm font-medium text-white hover:bg-pink-600"
        >
          지원하기
        </Link>
      </div>
    </div>
  );
}

function CardRow({ card }: { card: PublicCard }) {
  const router = useRouter();
  const ideal = maskIdealTypeForPreview(card.ideal_type);
  const [imgFailed, setImgFailed] = useState(false);
  const detailHref = `/community/dating/cards/${card.id}`;
  const applyHref = `/community/dating/cards/${card.id}/apply`;
  const warmRoute = useCallback(() => {
    cacheOpenCardDetail(card.id, card);
    router.prefetch(detailHref);
    router.prefetch(applyHref);
  }, [applyHref, card, detailHref, router]);
  const rememberScroll = useCallback(() => {
    const snapshot = readOpenCardsSnapshot();
    if (!snapshot) return;
    writeOpenCardsSnapshot({
      ...snapshot,
      scrollY: window.scrollY,
    });
  }, []);

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-neutral-700">
          <span className="font-semibold text-neutral-900">{card.display_nickname}</span>
          <PhoneVerifiedBadge verified={card.is_phone_verified} />
          {card.age != null && <span>{card.age}세</span>}
          {card.region && <span>{card.region}</span>}
        </div>
        <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
          {card.expires_at ? `잔여 ${formatRemainingToKorean(card.expires_at)}` : "대기열"}
        </span>
      </div>

      <div className="mt-3 h-36 w-full overflow-hidden rounded-xl border border-neutral-100 bg-neutral-50 md:h-44">
        {card.image_urls.length > 0 && !imgFailed ? (
          <div className="relative flex h-full w-full items-center justify-center bg-neutral-50">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={card.image_urls[0]}
              alt=""
              loading="lazy"
              decoding="async"
              onError={() => setImgFailed(true)}
              className={`absolute inset-0 h-full w-full object-cover opacity-30 ${card.photo_visibility === "public" ? "blur-sm" : "blur-[10px]"}`}
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={card.image_urls[0]}
              alt=""
              loading="lazy"
              decoding="async"
              className={`relative z-10 max-h-full max-w-full h-auto w-auto object-contain object-center ${card.photo_visibility === "public" ? "" : "blur-[9px]"}`}
            />
          </div>
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <span className="text-sm text-neutral-400">사진 없음</span>
          </div>
        )}
      </div>

      <div className="mt-2 flex flex-wrap gap-2 text-xs text-neutral-600">
        {card.height_cm != null && <span>키 {card.height_cm}cm</span>}
        {card.job && <span>직업 {card.job}</span>}
        {card.training_years != null && <span>운동 {card.training_years}년</span>}
        {card.is_3lift_verified && (
          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">3대인증 완료</span>
        )}
        {card.sex === "male" && card.total_3lift != null && (
          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-rose-100 text-rose-700">3대 {card.total_3lift}kg</span>
        )}
      </div>

      {ideal && <p className="mt-2 line-clamp-2 text-xs text-pink-700">이상형: {ideal}</p>}
      {card.strengths_text && <p className="mt-1 line-clamp-2 text-xs text-emerald-700">내 장점: {card.strengths_text}</p>}

      <div className="mt-3 flex flex-wrap gap-2">
        <Link
          href={detailHref}
          prefetch
          onMouseEnter={warmRoute}
          onClick={rememberScroll}
          onTouchStart={warmRoute}
          onTouchEnd={rememberScroll}
          className="inline-flex min-h-[40px] items-center rounded-lg bg-neutral-900 px-4 text-sm font-medium text-white hover:bg-neutral-700"
        >
          상세보기
        </Link>
        <Link
          href={applyHref}
          prefetch
          onMouseEnter={warmRoute}
          onClick={rememberScroll}
          onTouchStart={warmRoute}
          onTouchEnd={rememberScroll}
          className="inline-flex min-h-[40px] items-center rounded-lg bg-pink-500 px-4 text-sm font-medium text-white hover:bg-pink-600"
        >
          지원하기
        </Link>
      </div>
    </div>
  );
}


