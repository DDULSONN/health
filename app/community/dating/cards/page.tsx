"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DatingAdultNotice from "@/components/DatingAdultNotice";
import { formatRemainingToKorean } from "@/lib/dating-open";
import {
  SWIPE_PREMIUM_DAILY_LIMIT,
  SWIPE_PREMIUM_DURATION_DAYS,
  SWIPE_PREMIUM_PRICE_KRW,
} from "@/lib/dating-swipe";
import PhoneVerifiedBadge from "@/components/PhoneVerifiedBadge";
import { cacheOpenCardDetail, cachePaidCardDetail } from "@/lib/dating-detail-cache";
import { createClient } from "@/lib/supabase/client";

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
  one_on_one_applicants_count?: number;
  one_on_one_matches_count?: number;
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
const OPEN_KAKAO_URL = process.env.NEXT_PUBLIC_OPENKAKAO_URL ?? "https://open.kakao.com/o/s2gvTdhi";

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

function buildLoginRedirect(path: string) {
  return `/login?redirect=${encodeURIComponent(path)}`;
}

type CardVisualTheme = {
  shell: string;
  halo: string;
  badge: string;
  chip: string;
  symbol: string;
  overlay: string;
};

const CARD_VISUAL_THEMES: CardVisualTheme[] = [
  {
    shell: "from-rose-100 via-rose-200 to-stone-500",
    halo: "bg-rose-200/60",
    badge: "bg-white/20 text-white backdrop-blur",
    chip: "border-white/30 bg-white/18 text-white",
    symbol: "text-rose-800/35",
    overlay: "from-transparent via-rose-200/8 to-black/35",
  },
  {
    shell: "from-sky-100 via-indigo-100 to-slate-500",
    halo: "bg-sky-200/55",
    badge: "bg-white/20 text-white backdrop-blur",
    chip: "border-white/30 bg-white/18 text-white",
    symbol: "text-sky-900/30",
    overlay: "from-transparent via-sky-200/8 to-black/35",
  },
  {
    shell: "from-emerald-100 via-teal-100 to-stone-500",
    halo: "bg-emerald-200/55",
    badge: "bg-white/20 text-white backdrop-blur",
    chip: "border-white/30 bg-white/18 text-white",
    symbol: "text-emerald-900/30",
    overlay: "from-transparent via-emerald-200/8 to-black/35",
  },
  {
    shell: "from-violet-100 via-fuchsia-100 to-slate-500",
    halo: "bg-violet-200/55",
    badge: "bg-white/20 text-white backdrop-blur",
    chip: "border-white/30 bg-white/18 text-white",
    symbol: "text-violet-900/30",
    overlay: "from-transparent via-violet-200/8 to-black/35",
  },
  {
    shell: "from-amber-100 via-orange-100 to-stone-500",
    halo: "bg-amber-200/55",
    badge: "bg-white/20 text-white backdrop-blur",
    chip: "border-white/30 bg-white/18 text-white",
    symbol: "text-amber-900/30",
    overlay: "from-transparent via-amber-200/8 to-black/35",
  },
];

function getCardVisualTheme(seed: string) {
  const hash = [...seed].reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return CARD_VISUAL_THEMES[hash % CARD_VISUAL_THEMES.length];
}

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
  const supabase = useMemo(() => createClient(), []);
  const [restoredSnapshot, setRestoredSnapshot] = useState<OpenCardsSnapshot | null>(null);
  const [snapshotReady, setSnapshotReady] = useState(false);
  const [activeSex, setActiveSex] = useState<"male" | "female">("female");
  const [guideOpen, setGuideOpen] = useState(false);
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
  const [swipeLoading, setSwipeLoading] = useState(true);
  const [swipeRefreshing, setSwipeRefreshing] = useState(false);
  const [swipeSubmitting, setSwipeSubmitting] = useState(false);
  const [swipeMessage, setSwipeMessage] = useState("");
  const [swipeImgFailed, setSwipeImgFailed] = useState(false);
  const [swipeState, setSwipeState] = useState<SwipeState>({
    loggedIn: false,
    canSwipe: false,
    remaining: 0,
    limit: 7,
    candidate: null,
    reason: null,
  });
  const activeSexRef = useRef<"male" | "female">(activeSex);
  const swipeCacheRef = useRef<Partial<Record<"male" | "female", SwipeState>>>({});
  const swipeRequestIdRef = useRef({ male: 0, female: 0 });
  const [viewerLoggedIn, setViewerLoggedIn] = useState(false);

  useEffect(() => {
    activeSexRef.current = activeSex;
  }, [activeSex]);

  useEffect(() => {
    const snapshot = readOpenCardsSnapshot();
    if (snapshot) {
      setRestoredSnapshot(snapshot);
      setActiveSex(snapshot.activeSex);
      setMales(snapshot.males);
      setFemales(snapshot.females);
      setMaleCursorCreatedAt(snapshot.maleCursorCreatedAt);
      setMaleCursorId(snapshot.maleCursorId);
      setFemaleCursorCreatedAt(snapshot.femaleCursorCreatedAt);
      setFemaleCursorId(snapshot.femaleCursorId);
      setMaleHasMore(snapshot.maleHasMore);
      setFemaleHasMore(snapshot.femaleHasMore);
      setQueueStats(snapshot.queueStats);
      setPaidItems(snapshot.paidItems);
      setMoreViewMale(snapshot.moreViewMale);
      setMoreViewFemale(snapshot.moreViewFemale);
      if (snapshot.males.length > 0 || snapshot.females.length > 0) {
        setLoading(false);
      }
    }
    setSnapshotReady(true);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setTick((v) => v + 1), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    queueMicrotask(async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setViewerLoggedIn(Boolean(user));
    });
  }, [supabase]);

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
    if (!restoredSnapshot) return;
    const restore = window.requestAnimationFrame(() => {
      window.scrollTo({ top: restoredSnapshot.scrollY ?? 0, behavior: "auto" });
    });
    return () => window.cancelAnimationFrame(restore);
  }, [restoredSnapshot]);

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
    if (!snapshotReady) return;
    queueMicrotask(() => {
      void loadInitial({ silent: Boolean(restoredSnapshot) });
    });
  }, [snapshotReady, restoredSnapshot, loadInitial]);

  useEffect(() => {
    const pollSecondaryStatus = async () => {
      if (document.visibilityState !== "visible") return;

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
    };

    const timer = window.setInterval(() => {
      void pollSecondaryStatus();
    }, 60000);

    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      void pollSecondaryStatus();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
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
          limit: Math.max(1, Number(body.limit ?? 7)),
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
          limit: 7,
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
      if (!swipeState.canSwipe) {
        setSwipeMessage("라이크나 넘기기를 하려면 먼저 오픈카드를 등록해 주세요.");
        return;
      }
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
    [activeSex, loadSwipe, swipeState.canSwipe, swipeState.candidate, swipeSubmitting]
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
  const swipeTheme = getCardVisualTheme(swipeState.candidate?.card_id ?? activeSex);
  return (
    <main className="mx-auto max-w-5xl px-4 py-5 md:px-6 md:py-8">
      <DatingAdultNotice />
      <section className="mb-5 rounded-[30px] border border-black/5 bg-white p-4 shadow-[0_14px_40px_rgba(15,23,42,0.06)] md:p-6">
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-xl bg-rose-600 px-3 py-1.5 text-xs font-bold text-white">오픈카드</span>
            <span className="text-sm font-medium text-neutral-400">24시간 공개 · 미연결 시 1회 재대기</span>
          </div>

          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 flex-1">
              <h1 className="text-[38px] font-black tracking-tight text-neutral-950 md:text-[46px]">오픈카드</h1>
              <p className="mt-3 max-w-xl text-[15px] leading-7 text-neutral-500 md:text-base">
                둘러보고 바로 지원하거나, 내 카드도 자연스럽게 공개할 수 있어요.
              </p>
              <div className="mt-4 inline-flex flex-wrap items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2">
                <span className="rounded-full bg-emerald-600 px-2.5 py-1 text-[11px] font-bold text-white">혜택</span>
                <p className="text-sm font-semibold text-emerald-900">오픈카드 등록하면 매주 원하는 지역 1곳 무료 오픈</p>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-[24px] bg-neutral-50 p-4">
                  <p className="text-sm font-semibold text-neutral-400">고정 노출</p>
                  <p className="mt-3 text-[18px] font-black text-rose-600 md:text-[20px]">{fixedPaidCount}명</p>
                  <p className="mt-1 text-sm text-neutral-400">상단 우선 공개</p>
                </div>
                <div className="rounded-[24px] bg-neutral-50 p-4">
                  <p className="text-sm font-semibold text-neutral-400">현재 공개중</p>
                  <p className="mt-3 text-[18px] font-black text-rose-600 md:text-[20px]">
                    남 {queueStats?.male.public_count ?? males.length} · 여 {queueStats?.female.public_count ?? females.length}
                  </p>
                  <p className="mt-1 text-sm text-neutral-400">
                    대기 남 {queueStats?.male.pending_count ?? 0} · 여 {queueStats?.female.pending_count ?? 0}
                  </p>
                </div>
                <div className="rounded-[24px] bg-neutral-50 p-4 sm:col-span-2 lg:col-span-2">
                  <p className="text-sm font-semibold text-neutral-400">누적 매칭</p>
                  <p className="mt-3 text-[18px] font-black text-rose-600 md:text-[20px]">
                    {(queueStats?.accepted_matches_count ?? 0).toLocaleString("ko-KR")}명
                  </p>
                  <p className="mt-1 text-sm text-neutral-400">현재까지 연결</p>
                </div>
                <div className="rounded-[24px] bg-neutral-50 p-4">
                  <p className="text-sm font-semibold text-neutral-400">1:1 신청</p>
                  <p className="mt-3 text-[18px] font-black text-neutral-900 md:text-[20px]">
                    {Number(queueStats?.one_on_one_applicants_count ?? 0).toLocaleString("ko-KR")}명
                  </p>
                  <p className="mt-1 text-sm text-neutral-400">누적 신청자</p>
                </div>
                <div className="rounded-[24px] bg-neutral-50 p-4">
                  <p className="text-sm font-semibold text-neutral-400">1:1 매칭</p>
                  <p className="mt-3 text-[18px] font-black text-neutral-900 md:text-[20px]">
                    {Number(queueStats?.one_on_one_matches_count ?? 0).toLocaleString("ko-KR")}건
                  </p>
                  <p className="mt-1 text-sm text-neutral-400">서로 수락 완료</p>
                </div>
              </div>

              <div className="mt-3 flex flex-col gap-3 rounded-[24px] bg-neutral-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-[15px] font-black tracking-tight text-neutral-900">후보를 보고 지원하는 1:1 소개팅도 함께 이용할 수 있어요.</p>
                  <p className="mt-1 text-sm text-neutral-500">마음에 드는 후보에 지원하고, 서로 수락되면 번호 교환이 진행됩니다.</p>
                </div>
                <Link
                  href="/dating/1on1"
                  className="inline-flex min-h-[40px] shrink-0 items-center justify-center rounded-full border border-neutral-200 bg-white px-4 text-sm font-semibold text-neutral-700 hover:bg-neutral-100"
                >
                  1:1 후보 보기
                </Link>
              </div>
            </div>

            <div className="w-full lg:w-[270px]">
              <div className="grid gap-3">
                <Link
                  href="/dating/card/new"
                  className="inline-flex min-h-[62px] items-center justify-center rounded-[22px] bg-rose-600 px-5 text-lg font-bold text-white shadow-[0_14px_26px_rgba(225,29,72,0.22)] hover:bg-rose-700"
                >
                  오픈카드 작성
                </Link>
                <Link
                  href="/dating/paid?apply=1"
                  className="inline-flex min-h-[58px] items-center justify-center gap-2 rounded-[22px] border border-neutral-200 bg-white px-5 text-base font-bold text-neutral-800 hover:bg-neutral-50"
                >
                  <span className="rounded-lg bg-rose-600 px-2 py-1 text-[11px] font-bold text-white">추천</span>
                  대기 없이 등록
                </Link>
              </div>
            </div>
          </div>

          <div className="border-t border-neutral-100 pt-1">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setActiveSex("female")}
                className={`inline-flex min-h-[52px] items-center rounded-full px-6 text-lg font-bold transition ${
                  activeSex === "female"
                    ? "bg-rose-600 text-white shadow-[0_12px_24px_rgba(225,29,72,0.18)]"
                    : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200"
                }`}
              >
                여자 카드 보기
              </button>
              <button
                type="button"
                onClick={() => setActiveSex("male")}
                className={`inline-flex min-h-[52px] items-center rounded-full px-6 text-lg font-bold transition ${
                  activeSex === "male"
                    ? "bg-slate-900 text-white shadow-[0_12px_24px_rgba(15,23,42,0.14)]"
                    : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200"
                }`}
              >
                남자 카드 보기
              </button>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <span className="inline-flex min-h-[42px] items-center rounded-full bg-neutral-950 px-4 text-sm font-bold text-white">전체</span>
              <Link
                href="/dating/apply-credits"
                className="inline-flex min-h-[42px] items-center rounded-full border border-neutral-200 bg-white px-4 text-sm font-semibold text-neutral-600 hover:bg-neutral-50"
              >
                지원권 구매
              </Link>
              <Link
                href="/dating/more-view"
                className="inline-flex min-h-[42px] items-center rounded-full border border-neutral-200 bg-white px-4 text-sm font-semibold text-neutral-600 hover:bg-neutral-50"
              >
                이상형 더보기
              </Link>
              <Link
                href="/dating/nearby-view"
                className="inline-flex min-h-[42px] items-center rounded-full border border-neutral-200 bg-white px-4 text-sm font-semibold text-neutral-600 hover:bg-neutral-50"
              >
                내 가까운 이상형
              </Link>
            </div>
          </div>
        </div>
      </section>

      {!viewerLoggedIn ? (
        <section className="mb-4 rounded-[26px] border border-black/5 bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-bold text-neutral-900">지금은 미리보기만 열려 있어요</p>
              <p className="mt-1 text-sm leading-6 text-neutral-500">목록 일부만 볼 수 있고, 상세보기와 지원하기는 로그인 후 이용할 수 있어요.</p>
            </div>
            <Link
              href={buildLoginRedirect(`/community/dating/cards?sex=${activeSex}`)}
              className="inline-flex min-h-[48px] items-center justify-center rounded-2xl bg-neutral-950 px-5 text-sm font-bold text-white hover:bg-neutral-800"
            >
              로그인하고 계속 보기
            </Link>
          </div>
        </section>
      ) : null}

      <section className="mb-5 rounded-[30px] border border-black/5 bg-white p-4 shadow-[0_14px_40px_rgba(15,23,42,0.05)] md:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-[30px] font-black tracking-tight text-neutral-950">빠른 매칭</h2>
            <p className="mt-2 max-w-lg text-[15px] leading-7 text-neutral-500">
              랜덤 후보를 하루 최대 {swipeState.limit}명까지 빠르게 확인할 수 있어요.
            </p>
          </div>
          <div className="shrink-0 rounded-[22px] bg-rose-50 px-4 py-3 text-right">
            <p className="text-sm font-semibold text-rose-400">오늘 남은</p>
            <p className="mt-1 text-[20px] font-black text-rose-600">
              {!swipeState.loggedIn ? "로그인" : swipeState.canSwipe ? `${swipeState.remaining}회` : "등록 필요"}
            </p>
          </div>
        </div>

        {swipeRefreshing && !swipeLoading ? <p className="mt-3 text-xs font-medium text-neutral-400">최신 후보로 업데이트 중...</p> : null}
        {swipeMessage ? <p className="mt-3 text-sm font-semibold text-emerald-700">{swipeMessage}</p> : null}

        {swipeLoading ? (
          <p className="mt-5 text-sm text-neutral-500">후보를 불러오는 중...</p>
        ) : !swipeState.candidate ? (
          <>
            <p className="mt-5 text-sm text-neutral-500">{swipeState.reason ?? "현재 보여줄 후보가 없습니다."}</p>
            {swipeState.loggedIn && swipeState.remaining <= 0 ? (
              <div className="mt-4 rounded-[24px] border border-amber-200 bg-amber-50/70 p-4">
                <p className="text-sm font-bold text-amber-900">오늘 라이크를 모두 사용했어요.</p>
                <p className="mt-1 text-sm leading-6 text-amber-800">
                  추가 이용은 {SWIPE_PREMIUM_PRICE_KRW.toLocaleString("ko-KR")}원 · {SWIPE_PREMIUM_DURATION_DAYS}일 · 하루{" "}
                  {SWIPE_PREMIUM_DAILY_LIMIT}회 기준이에요.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link
                    href="/mypage"
                    className="inline-flex min-h-[42px] items-center rounded-2xl bg-amber-500 px-4 text-sm font-bold text-white hover:bg-amber-600"
                  >
                    추가 이용 신청
                  </Link>
                  <a
                    href={OPEN_KAKAO_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-[42px] items-center rounded-2xl border border-amber-200 bg-white px-4 text-sm font-bold text-amber-800 hover:bg-amber-50"
                  >
                    오픈카톡 문의
                  </a>
                </div>
              </div>
            ) : null}
          </>
        ) : (
          <div className="mt-5 overflow-hidden rounded-[30px] border border-black/5 bg-white">
            <div className={`relative overflow-hidden bg-gradient-to-br ${swipeTheme.shell} p-4 pb-5 min-h-[330px]`}>
              <div className={`absolute inset-0 bg-gradient-to-b ${swipeTheme.overlay}`} aria-hidden />
              <div className="absolute -left-10 bottom-[-36px] h-40 w-40 rounded-full bg-white/10" aria-hidden />
              <div className="absolute -right-10 top-[-28px] h-40 w-40 rounded-full bg-white/10" aria-hidden />

              <div className="relative z-10 flex items-start justify-between gap-3">
                <span className={`inline-flex rounded-full px-3 py-1 text-sm font-semibold ${swipeTheme.badge}`}>
                  {swipeState.candidate.source_status === "public" ? "공개중" : "지난 카드"}
                </span>
                <span className="inline-flex rounded-full bg-black/35 px-3 py-1 text-sm font-bold text-white">빠른 확인</span>
              </div>

              <div className="relative z-10 mt-6 flex h-[210px] items-center justify-center overflow-hidden rounded-[28px]">
                {swipeState.candidate.image_url && !swipeImgFailed ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={swipeState.candidate.image_url}
                      alt=""
                      decoding="async"
                      onError={() => setSwipeImgFailed(true)}
                      className={`absolute inset-0 h-full w-full object-cover ${
                        swipeState.candidate.photo_visibility === "public" ? "opacity-34 blur-sm" : "opacity-44 blur-[10px]"
                      }`}
                    />
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={swipeState.candidate.image_url}
                      alt=""
                      decoding="async"
                      className={`relative z-10 h-full w-full object-contain px-2 ${
                        swipeState.candidate.photo_visibility === "public" ? "" : "blur-[9px]"
                      }`}
                    />
                  </>
                ) : null}
              </div>

              <div className="relative z-10 mt-5">
                <div className="flex items-end gap-2 text-white">
                  <span className="text-[22px] font-black tracking-tight">{swipeState.candidate.display_nickname}</span>
                  {swipeState.candidate.age != null ? <span className="pb-0.5 text-[16px] font-semibold text-white/90">{swipeState.candidate.age}세</span> : null}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {swipeState.candidate.region ? (
                    <span className={`inline-flex rounded-full border px-3 py-1 text-sm font-semibold ${swipeTheme.chip}`}>{swipeState.candidate.region}</span>
                  ) : null}
                  {swipeState.candidate.height_cm != null ? (
                    <span className={`inline-flex rounded-full border px-3 py-1 text-sm font-semibold ${swipeTheme.chip}`}>키 {swipeState.candidate.height_cm}cm</span>
                  ) : null}
                  {swipeState.candidate.job ? (
                    <span className={`inline-flex rounded-full border px-3 py-1 text-sm font-semibold ${swipeTheme.chip}`}>{swipeState.candidate.job}</span>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="space-y-3 p-4 md:p-5">
              {swipeState.candidate.ideal_type ? (
                <p className="text-[16px] leading-7 text-neutral-700">{maskIdealTypeForPreview(swipeState.candidate.ideal_type)}</p>
              ) : null}
              {swipeState.candidate.strengths_text ? <p className="text-sm leading-6 text-neutral-500">{swipeState.candidate.strengths_text}</p> : null}

              <div className="flex flex-wrap gap-2">
                {swipeState.candidate.training_years != null ? (
                  <span className="rounded-full bg-neutral-100 px-3 py-1 text-xs font-semibold text-neutral-500">운동 {swipeState.candidate.training_years}년</span>
                ) : null}
                {swipeState.candidate.is_3lift_verified ? (
                  <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">3대 인증 완료</span>
                ) : null}
                {swipeState.candidate.sex === "male" && swipeState.candidate.total_3lift != null ? (
                  <span className="rounded-full bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700">
                    3대 {swipeState.candidate.total_3lift}kg
                  </span>
                ) : null}
              </div>

              <div className="grid grid-cols-2 gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => void handleSwipe("pass")}
                  disabled={swipeSubmitting}
                  className="inline-flex min-h-[54px] items-center justify-center rounded-[18px] border border-neutral-200 bg-white px-4 text-lg font-bold text-neutral-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  넘기기
                </button>
                <button
                  type="button"
                  onClick={() => void handleSwipe("like")}
                  disabled={swipeSubmitting}
                  className="inline-flex min-h-[54px] items-center justify-center rounded-[18px] bg-rose-600 px-4 text-lg font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  라이크
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      <section className="mb-5 rounded-[26px] border border-black/5 bg-white p-4 shadow-[0_10px_28px_rgba(15,23,42,0.04)]">
        <button
          type="button"
          onClick={() => setGuideOpen((prev) => !prev)}
          className="flex w-full items-center justify-between gap-3 text-left"
        >
          <div>
            <p className="text-xl font-black tracking-tight text-neutral-950">이용 흐름 한 번에 보기</p>
            <p className="mt-1 text-sm text-neutral-500">등록, 지원, 수락, 재대기만 쉽게 정리했어요.</p>
          </div>
          <span className="inline-flex min-h-[42px] items-center rounded-full border border-neutral-200 px-4 text-sm font-bold text-neutral-600">
            {guideOpen ? "설명 접기" : "설명 보기"}
          </span>
        </button>

        {guideOpen && (
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <div className="rounded-[22px] bg-neutral-50 p-4">
              <p className="text-sm font-black text-neutral-900">1. 카드 공개</p>
              <p className="mt-2 text-sm leading-6 text-neutral-500">오픈카드를 만들면 대기열에 들어가고, 공개되면 24시간 동안 보여져요.</p>
            </div>
            <div className="rounded-[22px] bg-neutral-50 p-4">
              <p className="text-sm font-black text-neutral-900">2. 지원과 수락</p>
              <p className="mt-2 text-sm leading-6 text-neutral-500">마음에 드는 카드에 지원하고, 카드 주인이 수락하면 연결이 성사돼요.</p>
            </div>
            <div className="rounded-[22px] bg-neutral-50 p-4">
              <p className="text-sm font-black text-neutral-900">3. 종료 후 처리</p>
              <p className="mt-2 text-sm leading-6 text-neutral-500">연결이 없으면 1회 다시 대기열로 들어가고, 수락되면 마이페이지에서 인스타가 공개돼요.</p>
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
          viewerLoggedIn={viewerLoggedIn}
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
  viewerLoggedIn,
}: {
  title: string;
  currentCount: number;
  paidItems: PaidCard[];
  items: PublicCard[];
  moreViewItems: PublicCard[];
  hasMore: boolean;
  onMore: () => void;
  viewerLoggedIn: boolean;
}) {
  const pinnedPaidItems = paidItems.filter((card) => card.display_mode !== "instant_public");
  const instantPaidItems = paidItems.filter((card) => card.display_mode === "instant_public");
  const hasAnyItems = pinnedPaidItems.length > 0 || items.length > 0 || instantPaidItems.length > 0 || moreViewItems.length > 0;

  return (
    <section>
      <div className="mb-4 flex items-end justify-between gap-3">
        <h2 className="text-[28px] font-black tracking-tight text-neutral-950">
          {title} <span className="text-lg font-semibold text-neutral-400">{currentCount}명 공개중</span>
        </h2>
      </div>
      {!hasAnyItems ? (
        <p className="rounded-[26px] border border-black/5 bg-white p-5 text-sm text-neutral-500 shadow-[0_10px_28px_rgba(15,23,42,0.04)]">
          현재 공개중인 카드가 없습니다.
        </p>
      ) : (
        <>
          {pinnedPaidItems.length > 0 && (
            <div className="mb-3 grid grid-cols-2 gap-3">
              {pinnedPaidItems.map((card) => (
                <PaidCardRow key={card.id} card={card} viewerLoggedIn={viewerLoggedIn} />
              ))}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            {items.map((card) => (
              <CardRow key={card.id} card={card} viewerLoggedIn={viewerLoggedIn} />
            ))}
            {instantPaidItems.map((card) => (
              <PaidCardRow key={`paid-${card.id}`} card={card} viewerLoggedIn={viewerLoggedIn} />
            ))}
          </div>
          {moreViewItems.length > 0 && (
            <div className="mt-4 rounded-[28px] border border-dashed border-rose-200 bg-rose-50/60 p-3">
              <p className="mb-3 px-1 text-sm font-bold text-rose-700">이상형 더보기</p>
              <div className="grid grid-cols-2 gap-3">
                {moreViewItems.map((card) => (
                  <CardRow key={`more-${card.id}`} card={card} viewerLoggedIn={viewerLoggedIn} />
                ))}
              </div>
            </div>
          )}
          {hasMore && viewerLoggedIn && (
            <button
              type="button"
              onClick={onMore}
              className="mt-4 w-full min-h-[52px] rounded-[20px] border border-neutral-200 bg-white text-sm font-bold text-neutral-700 shadow-[0_8px_20px_rgba(15,23,42,0.03)] hover:bg-neutral-50"
            >
              더보기
            </button>
          )}
        </>
      )}
    </section>
  );
}

function PaidCardRow({ card, viewerLoggedIn }: { card: PaidCard; viewerLoggedIn: boolean }) {
  const router = useRouter();
  const isPriority = card.display_mode !== "instant_public";
  const theme = getCardVisualTheme(card.id);
  const detailHref = viewerLoggedIn ? `/dating/paid/${card.id}` : buildLoginRedirect(`/dating/paid/${card.id}`);
  const applyHref = viewerLoggedIn ? `/dating/paid/${card.id}/apply` : buildLoginRedirect(`/dating/paid/${card.id}/apply`);
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
    <div className="flex h-full flex-col overflow-hidden rounded-[28px] border border-black/5 bg-white shadow-[0_12px_30px_rgba(15,23,42,0.05)]">
      <div className={`relative min-h-[220px] overflow-hidden bg-gradient-to-br ${theme.shell} p-3`}>
        <div className={`absolute inset-0 bg-gradient-to-b ${theme.overlay}`} aria-hidden />
        <div className="absolute -left-10 bottom-[-30px] h-36 w-36 rounded-full bg-white/10" aria-hidden />
        <div className="absolute -right-10 top-[-24px] h-32 w-32 rounded-full bg-white/10" aria-hidden />
        {card.thumbUrl ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={card.thumbUrl} alt="" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover opacity-28 blur-sm" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={card.thumbUrl} alt="" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-contain px-2 py-2" />
          </>
        ) : null}

        <div className="relative z-10 flex items-start justify-between gap-3">
          <span className={`inline-flex rounded-full px-3 py-1 text-sm font-semibold ${theme.badge}`}>
            {isPriority ? "추천 등록" : "바로 공개"}
          </span>
          {card.expires_at ? (
            <span className="inline-flex rounded-full bg-black/35 px-3 py-1 text-sm font-bold text-white">
              {isPriority ? `잔여 ${formatRemainingToKorean(card.expires_at)}` : "바로 공개중"}
            </span>
          ) : null}
        </div>

        <div className="relative z-10 mt-4">
          <div className="flex items-end gap-2 text-white">
            <span className="text-[20px] font-black tracking-tight">{card.nickname}</span>
            {card.age != null ? <span className="pb-0.5 text-base font-semibold text-white/90">{card.age}</span> : null}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {card.region ? <span className={`inline-flex rounded-full border px-3 py-1 text-sm font-semibold ${theme.chip}`}>{card.region}</span> : null}
            {card.height_cm != null ? (
              <span className={`inline-flex rounded-full border px-3 py-1 text-sm font-semibold ${theme.chip}`}>키 {card.height_cm}cm</span>
            ) : null}
            {card.job ? <span className={`inline-flex rounded-full border px-3 py-1 text-sm font-semibold ${theme.chip}`}>{card.job}</span> : null}
          </div>
        </div>
      </div>

      <div className="flex flex-1 flex-col p-4">
        <div className="flex flex-wrap gap-2">
          <PhoneVerifiedBadge verified={card.is_phone_verified} />
          {card.training_years != null ? (
            <span className="rounded-full bg-neutral-100 px-3 py-1 text-xs font-semibold text-neutral-500">운동 {card.training_years}년</span>
          ) : null}
          {card.is_3lift_verified ? (
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">3대 인증 완료</span>
          ) : null}
        </div>

        {card.strengths_text ? <p className="mt-3 line-clamp-2 text-[15px] leading-7 text-neutral-700">{card.strengths_text}</p> : null}
        {card.ideal_text ? <p className="mt-2 line-clamp-2 text-sm leading-6 text-neutral-500">{card.ideal_text}</p> : null}

        <div className="mt-auto grid gap-2 pt-4">
          <Link
            href={detailHref}
            prefetch
            onMouseEnter={warmRoute}
            onClick={rememberScroll}
            onTouchStart={warmRoute}
            onTouchEnd={rememberScroll}
            className="inline-flex min-h-[46px] w-full items-center justify-center rounded-[18px] border border-neutral-200 px-3 text-sm font-bold text-neutral-700 hover:bg-neutral-50"
          >
            {viewerLoggedIn ? "상세보기" : "로그인 후 보기"}
          </Link>
          <Link
            href={applyHref}
            prefetch
            onMouseEnter={warmRoute}
            onClick={rememberScroll}
            onTouchStart={warmRoute}
            onTouchEnd={rememberScroll}
            className="inline-flex min-h-[48px] w-full items-center justify-center rounded-[18px] bg-rose-600 px-3 text-sm font-bold text-white hover:bg-rose-700"
          >
            {viewerLoggedIn ? "지원하기" : "로그인 후 지원"}
          </Link>
        </div>
      </div>
    </div>
  );
}

function CardRow({ card, viewerLoggedIn }: { card: PublicCard; viewerLoggedIn: boolean }) {
  const router = useRouter();
  const ideal = maskIdealTypeForPreview(card.ideal_type);
  const [imgFailed, setImgFailed] = useState(false);
  const theme = getCardVisualTheme(card.id);
  const detailHref = viewerLoggedIn ? `/community/dating/cards/${card.id}` : buildLoginRedirect(`/community/dating/cards/${card.id}`);
  const applyHref = viewerLoggedIn ? `/community/dating/cards/${card.id}/apply` : buildLoginRedirect(`/community/dating/cards/${card.id}/apply`);
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
    <div className="flex h-full flex-col overflow-hidden rounded-[28px] border border-black/5 bg-white shadow-[0_12px_30px_rgba(15,23,42,0.05)]">
      <div className={`relative min-h-[220px] overflow-hidden bg-gradient-to-br ${theme.shell} p-3`}>
        <div className={`absolute inset-0 bg-gradient-to-b ${theme.overlay}`} aria-hidden />
        <div className="absolute -left-10 bottom-[-30px] h-36 w-36 rounded-full bg-white/10" aria-hidden />
        <div className="absolute -right-10 top-[-24px] h-32 w-32 rounded-full bg-white/10" aria-hidden />

        {card.image_urls.length > 0 && !imgFailed ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={card.image_urls[0]}
              alt=""
              loading="lazy"
              decoding="async"
              onError={() => setImgFailed(true)}
              className={`absolute inset-0 h-full w-full object-cover ${
                card.photo_visibility === "public" ? "opacity-28 blur-sm" : "opacity-40 blur-[10px]"
              }`}
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={card.image_urls[0]}
              alt=""
              loading="lazy"
              decoding="async"
              className={`absolute inset-0 h-full w-full object-contain px-2 py-2 ${card.photo_visibility === "public" ? "" : "blur-[9px]"}`}
            />
          </>
        ) : null}

        <div className="relative z-10 flex items-start justify-between gap-3">
          <span className="inline-flex rounded-full bg-black/35 px-3 py-1 text-sm font-bold text-white">
            {card.expires_at ? `잔여 ${formatRemainingToKorean(card.expires_at)}` : "대기열"}
          </span>
          {card.is_3lift_verified ? (
            <span className={`inline-flex rounded-full px-3 py-1 text-sm font-semibold ${theme.badge}`}>3대 인증</span>
          ) : null}
        </div>

        <div className="relative z-10 mt-4">
          <div className="flex items-end gap-2 text-white">
            <span className="text-[20px] font-black tracking-tight">{card.display_nickname}</span>
            {card.age != null ? <span className="pb-0.5 text-base font-semibold text-white/90">{card.age}</span> : null}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {card.region ? <span className={`inline-flex rounded-full border px-3 py-1 text-sm font-semibold ${theme.chip}`}>{card.region}</span> : null}
            {card.job ? <span className={`inline-flex rounded-full border px-3 py-1 text-sm font-semibold ${theme.chip}`}>{card.job}</span> : null}
            {card.height_cm != null ? (
              <span className={`inline-flex rounded-full border px-3 py-1 text-sm font-semibold ${theme.chip}`}>키 {card.height_cm}cm</span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex flex-1 flex-col p-4">
        <div className="flex flex-wrap gap-2">
          <PhoneVerifiedBadge verified={card.is_phone_verified} />
          {card.training_years != null ? (
            <span className="rounded-full bg-neutral-100 px-3 py-1 text-xs font-semibold text-neutral-500">운동 {card.training_years}년</span>
          ) : null}
          {card.sex === "male" && card.total_3lift != null ? (
            <span className="rounded-full bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700">3대 {card.total_3lift}kg</span>
          ) : null}
        </div>

        {card.strengths_text ? <p className="mt-3 line-clamp-2 text-[15px] leading-7 text-neutral-700">{card.strengths_text}</p> : null}
        {ideal ? <p className="mt-2 line-clamp-2 text-sm leading-6 text-neutral-500">{ideal}</p> : null}

        <div className="mt-auto grid gap-2 pt-4">
          <Link
            href={detailHref}
            prefetch
            onMouseEnter={warmRoute}
            onClick={rememberScroll}
            onTouchStart={warmRoute}
            onTouchEnd={rememberScroll}
            className="inline-flex min-h-[46px] w-full items-center justify-center rounded-[18px] border border-neutral-200 bg-white px-3 text-sm font-bold text-neutral-700 hover:bg-neutral-50"
          >
            {viewerLoggedIn ? "상세보기" : "로그인 후 보기"}
          </Link>
          <Link
            href={applyHref}
            prefetch
            onMouseEnter={warmRoute}
            onClick={rememberScroll}
            onTouchStart={warmRoute}
            onTouchEnd={rememberScroll}
            className="inline-flex min-h-[48px] w-full items-center justify-center rounded-[18px] bg-rose-600 px-3 text-sm font-bold text-white hover:bg-rose-700"
          >
            {viewerLoggedIn ? "지원하기" : "로그인 후 지원"}
          </Link>
        </div>
      </div>
    </div>
  );
}


