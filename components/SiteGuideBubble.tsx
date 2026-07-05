"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";

type SummaryResponse = {
  profile?: {
    phone_verified?: boolean;
    swipe_profile_visible?: boolean;
  };
};

type OpenCardItem = {
  id: string;
  status: "pending" | "public" | "expired" | "hidden";
};

type OpenCardsResponse = {
  items?: OpenCardItem[];
};

type OneOnOneStatusResponse = {
  loggedIn?: boolean;
  phoneVerified?: boolean;
  canWrite?: boolean;
  activeRequestStatus?: string | null;
};

type SiteGuideMascotResponse = {
  selected?: {
    src?: string;
  };
};

type GuideSuggestion = {
  id: string;
  title: string;
  body: string;
  href: string;
  cta: string;
};

const HIDDEN_PATH_PREFIXES = ["/payments/success", "/payments/fail", "/account-deletion", "/login", "/signup", "/auth", "/landing"];
const COLLAPSE_STORAGE_KEY = "site-guide-collapsed";
const POSITION_STORAGE_KEY = "site-guide-position";
const DEFAULT_MASCOT_SRC = "/mascot/jimnyang-guide-v2.png";

type GuidePosition = {
  x: number;
  y: number;
};

function buildSuggestions(input: {
  pathname: string;
  loggedIn: boolean | null;
  phoneVerified: boolean;
  swipeVisible: boolean;
  hasAnyOpenCard: boolean;
  hasPendingOpenCard: boolean;
  hasPublicOpenCard: boolean;
  hasOneOnOneActive: boolean;
  canApplyOneOnOne: boolean;
}) {
  const { pathname, loggedIn, phoneVerified, swipeVisible, hasAnyOpenCard, hasPendingOpenCard, hasPublicOpenCard, hasOneOnOneActive, canApplyOneOnOne } =
    input;

  if (loggedIn === false) {
    return [
      {
        id: "guest-open-card",
        title: "처음이라면 오픈카드부터 둘러보세요",
        body: "지원하거나 내 카드를 공개하는 흐름을 가장 빨리 볼 수 있어요.",
        href: "/community/dating/cards",
        cta: "오픈카드 보기",
      },
      {
        id: "guest-1on1",
        title: "1:1 소개팅은 후보를 보고 시작할 수 있어요",
        body: "마음에 드는 후보에게 신청하고, 서로 수락되면 연결돼요.",
        href: "/dating/1on1",
        cta: "1:1 보기",
      },
    ] satisfies GuideSuggestion[];
  }

  const suggestions: GuideSuggestion[] = [];

  if (!hasAnyOpenCard) {
    suggestions.push({
      id: "open-card-first",
      title: "오픈카드를 만들면 지원받고 직접 지원할 수 있어요",
      body: "사진 블러도 선택할 수 있어서 부담을 줄이고 시작하기 좋아요.",
      href: "/community/dating/cards/new",
      cta: "오픈카드 작성",
    });
  }

  if (hasPendingOpenCard) {
    suggestions.push(
      {
        id: "pending-card",
        title: "오픈카드가 준비 중이에요",
        body: "공개 상태와 들어온 반응은 마이페이지에서 가장 빨리 확인할 수 있어요.",
        href: "/mypage",
        cta: "상태 확인",
      },
      {
        id: "pending-paid",
        title: "바로 공개하고 싶다면 대기 없이 등록할 수 있어요",
        body: "지금 공개 타이밍을 놓치고 싶지 않을 때만 선택하면 돼요.",
        href: "/dating/paid",
        cta: "대기 없이 등록",
      }
    );
  }

  if (hasPublicOpenCard) {
    suggestions.push(
      {
        id: "public-card-status",
        title: "오픈카드가 공개 중이에요",
        body: "들어온 지원은 오래 두기보다 수락 또는 거절해두면 상대도 흐름을 알기 쉬워요.",
        href: "/mypage",
        cta: "지원 확인",
      },
      {
        id: "public-card-reopen",
        title: "반응이 적었다면 다시 노출도 확인해보세요",
        body: "지원이 적게 들어온 카드는 마이페이지에서 재노출 안내가 뜰 수 있어요.",
        href: "/dating/paid",
        cta: "노출 옵션 보기",
      }
    );
  }

  if (hasPublicOpenCard && !swipeVisible) {
    suggestions.push({
      id: "swipe-hidden",
      title: "빠른매칭 노출이 꺼져 있어요",
      body: "노출을 다시 켜면 더 많은 연결 기회를 받을 수 있어요. 지금 상태는 마이페이지에서 바로 바꿀 수 있어요.",
      href: "/mypage",
      cta: "노출 설정 보기",
    });
  }

  if (hasPublicOpenCard && swipeVisible) {
    suggestions.push({
      id: "swipe-plus",
      title: "빠른매칭은 오늘 후보를 더 볼 때 좋아요",
      body: "오픈카드가 공개 중이면 빠른매칭과 함께 쓰기 편해요.",
      href: "/community/dating/cards",
      cta: "빠른매칭 보기",
    });
  }

  if (!phoneVerified) {
    suggestions.push({
      id: "phone-verify",
      title: "지원 전에 휴대폰 인증을 해두면 좋아요",
      body: "오픈카드 지원과 1:1 소개팅을 더 매끄럽게 이용할 수 있어요.",
      href: "/mypage",
      cta: "인증하기",
    });
  }

  if (!hasOneOnOneActive && canApplyOneOnOne) {
    suggestions.push({
      id: "try-1on1",
      title: "1:1 소개팅은 기다림 없이 후보부터 볼 수 있어요",
      body: "마음에 드는 후보를 고르고, 서로 수락되면 연결이 진행돼요.",
      href: "/dating/1on1",
      cta: "1:1 후보 보기",
    });
  }

  if (hasOneOnOneActive) {
    suggestions.push(
      {
        id: "1on1-active",
        title: "진행 중인 1:1 소개팅이 있어요",
        body: "후보 확인, 수락, 번호 교환 상태는 마이페이지에서 바로 볼 수 있어요.",
        href: "/mypage",
        cta: "진행 상황 보기",
      },
      {
        id: "1on1-boost",
        title: "더 먼저 보이고 싶다면 1:1 우선 추천도 있어요",
        body: "필요한 기간에만 켜두는 방식이라 마이페이지에서 간단히 확인할 수 있어요.",
        href: "/mypage",
        cta: "우선 추천 보기",
      }
    );
  }

  if (pathname.startsWith("/community/bodycheck")) {
    suggestions.unshift({
      id: "route-bodycheck",
      title: "연결 기능은 오픈카드와 1:1에서 시작할 수 있어요",
      body: "커뮤니티는 가볍게 보고, 실제 매칭은 오픈카드와 1:1에서 이어가면 돼요.",
      href: "/community/dating/cards",
      cta: "오픈카드 보기",
    });
  } else if (pathname.startsWith("/community/write")) {
    suggestions.unshift({
      id: "route-community-write",
      title: "작성 후에는 오픈카드도 같이 열어두면 좋아요",
      body: "커뮤니티 반응과 매칭 흐름을 함께 만들 수 있어요.",
      href: "/community/dating/cards/new",
      cta: "오픈카드 작성",
    });
  } else if (pathname.startsWith("/community/dating/cards")) {
    suggestions.unshift(
      hasAnyOpenCard
        ? {
            id: "route-cards-live",
            title: "오픈카드 반응은 마이페이지에서 확인하면 빨라요",
            body: "여기서는 둘러보고, 들어온 지원 처리는 마이페이지에서 이어가면 돼요.",
            href: "/mypage",
            cta: "지원 확인",
          }
        : {
            id: "route-cards-start",
            title: "오픈카드를 만들면 바로 지원 흐름을 시작할 수 있어요",
            body: "사진 블러 선택도 가능해서 부담을 줄이고 공개할 수 있어요.",
            href: "/community/dating/cards/new",
            cta: "오픈카드 작성",
          }
    );
  } else if (pathname.startsWith("/dating/1on1")) {
    suggestions.unshift(
      hasOneOnOneActive
        ? {
            id: "route-1on1-active",
            title: "1:1 진행 상태는 마이페이지에서 확인하세요",
            body: "수락, 번호 교환, 우선 추천 상태까지 한 번에 볼 수 있어요.",
            href: "/mypage",
            cta: "진행 상황 보기",
          }
        : {
            id: "route-1on1-intro",
            title: "1:1은 기다림 없이 후보를 보고 시작해요",
            body: "마음에 드는 후보에게 신청하고 서로 수락되면 연결돼요.",
            href: "/dating/1on1",
            cta: "후보 보기",
          }
    );
  } else if (pathname.startsWith("/dating/more-view")) {
    suggestions.unshift({
      id: "route-more-view",
      title: "이상형 더보기는 선택지를 넓히고 싶을 때 좋아요",
      body: "더 넓게 보고, 마음에 들면 상세보기나 지원으로 바로 이어가면 돼요.",
      href: "/dating/more-view",
      cta: "계속 둘러보기",
    });
  } else if (pathname.startsWith("/dating/nearby-view")) {
    suggestions.unshift({
      id: "route-nearby-view",
      title: "가까운 이상형 보기는 실제 연결까지 생각할 때 좋아요",
      body: "생활권이 비슷한 사람부터 보면 대화도 조금 더 자연스럽게 이어질 때가 많아요.",
      href: "/dating/nearby-view",
      cta: "지역별로 보기",
    });
  } else if (pathname.startsWith("/dating/paid")) {
    suggestions.unshift({
      id: "route-paid",
      title: "필요할 때만 노출 옵션을 쓰면 돼요",
      body: "대기 없이 등록, 상단 고정, 재노출처럼 상황에 맞게 고를 수 있어요.",
      href: "/dating/paid",
      cta: "옵션 보기",
    });
  } else if (pathname.startsWith("/mypage")) {
    suggestions.unshift({
      id: "route-mypage",
      title: "지원과 1:1 진행 상태는 여기서 확인하면 돼요",
      body: "수락할 지원이 있거나 진행 중인 매칭이 있으면 먼저 확인해보세요.",
      href: "/mypage",
      cta: "상태 확인",
    });
  }

  return suggestions.slice(0, 3);
}

export default function SiteGuideBubble() {
  const pathname = usePathname();
  const isMyPage = pathname?.startsWith("/mypage") ?? false;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [guidePosition, setGuidePosition] = useState<GuidePosition | null>(null);
  const [index, setIndex] = useState(0);
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [openCards, setOpenCards] = useState<OpenCardItem[]>([]);
  const [oneOnOne, setOneOnOne] = useState<OneOnOneStatusResponse | null>(null);
  const [mascotSrc, setMascotSrc] = useState(DEFAULT_MASCOT_SRC);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(COLLAPSE_STORAGE_KEY);
      if (saved === "1") setCollapsed(true);
      const savedPosition = window.localStorage.getItem(POSITION_STORAGE_KEY);
      if (savedPosition) {
        const parsed = JSON.parse(savedPosition) as Partial<GuidePosition>;
        if (typeof parsed.x === "number" && typeof parsed.y === "number") {
          setGuidePosition({ x: parsed.x, y: parsed.y });
        }
      }
    } catch {}
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(COLLAPSE_STORAGE_KEY, collapsed ? "1" : "0");
    } catch {}
  }, [collapsed]);

  useEffect(() => {
    if (!guidePosition) return;
    try {
      window.localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(guidePosition));
    } catch {}
  }, [guidePosition]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const [summaryRes, cardsRes, oneOnOneRes] = await Promise.all([
          fetch("/api/mypage/summary", { cache: "no-store" }),
          fetch("/api/dating/cards/my", { cache: "no-store" }),
          fetch("/api/dating/1on1/write-status", { cache: "no-store" }),
        ]);

        if (cancelled) return;

        if (summaryRes.status === 401 || oneOnOneRes.status === 401) {
          setLoggedIn(false);
          setSummary(null);
          setOpenCards([]);
          setOneOnOne(null);
          return;
        }

        const [summaryBody, cardsBody, oneOnOneBody] = await Promise.all([
          summaryRes.json().catch(() => ({})),
          cardsRes.json().catch(() => ({})),
          oneOnOneRes.json().catch(() => ({})),
        ]);

        if (cancelled) return;

        setLoggedIn(true);
        setSummary((summaryBody ?? {}) as SummaryResponse);
        setOpenCards(Array.isArray((cardsBody as OpenCardsResponse).items) ? ((cardsBody as OpenCardsResponse).items ?? []) : []);
        setOneOnOne((oneOnOneBody ?? {}) as OneOnOneStatusResponse);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  useEffect(() => {
    let cancelled = false;

    async function loadMascot() {
      try {
        const res = await fetch("/api/site-guide/mascot", { cache: "no-store" });
        const body = (await res.json().catch(() => ({}))) as SiteGuideMascotResponse;
        const nextSrc = body.selected?.src;
        if (!cancelled && res.ok && typeof nextSrc === "string" && nextSrc.startsWith("/mascot/")) {
          setMascotSrc(nextSrc);
        }
      } catch {
        if (!cancelled) setMascotSrc(DEFAULT_MASCOT_SRC);
      }
    }

    void loadMascot();
    return () => {
      cancelled = true;
    };
  }, []);

  const suggestions = useMemo(() => {
    const safePathname = pathname ?? "";
    return buildSuggestions({
      pathname: safePathname,
      loggedIn,
      phoneVerified: summary?.profile?.phone_verified === true || oneOnOne?.phoneVerified === true,
      swipeVisible: summary?.profile?.swipe_profile_visible !== false,
      hasAnyOpenCard: openCards.length > 0,
      hasPendingOpenCard: openCards.some((card) => card.status === "pending"),
      hasPublicOpenCard: openCards.some((card) => card.status === "public"),
      hasOneOnOneActive: Boolean(oneOnOne?.activeRequestStatus),
      canApplyOneOnOne: oneOnOne?.canWrite === true,
    });
  }, [loggedIn, oneOnOne, openCards, pathname, summary]);

  useEffect(() => {
    setIndex(0);
  }, [pathname, suggestions.length]);

  useEffect(() => {
    if (collapsed || suggestions.length <= 1) return;
    const timer = window.setInterval(() => {
      setIndex((prev) => (prev + 1) % suggestions.length);
    }, 6200);
    return () => window.clearInterval(timer);
  }, [collapsed, suggestions.length]);

  if (pathname === "/" || HIDDEN_PATH_PREFIXES.some((prefix) => pathname?.startsWith(prefix))) {
    return null;
  }

  const activeSuggestion = suggestions[index] ?? null;
  if (!activeSuggestion && !loading) return null;

  const boundPosition = (x: number, y: number): GuidePosition => {
    if (typeof window === "undefined") return { x, y };
    const width = rootRef.current?.offsetWidth ?? 320;
    const height = rootRef.current?.offsetHeight ?? 260;
    return {
      x: Math.min(Math.max(4, x), Math.max(4, window.innerWidth - width - 4)),
      y: Math.min(Math.max(64, y), Math.max(64, window.innerHeight - height - 8)),
    };
  };

  const handleMascotPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: rect.left,
      originY: rect.top,
      moved: false,
    };
  };

  const handleMascotPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const nextX = drag.originX + event.clientX - drag.startX;
    const nextY = drag.originY + event.clientY - drag.startY;
    if (Math.abs(event.clientX - drag.startX) > 4 || Math.abs(event.clientY - drag.startY) > 4) {
      drag.moved = true;
    }
    setGuidePosition(boundPosition(nextX, nextY));
  };

  const handleMascotPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const shouldToggle = !drag.moved;
    dragRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {}
    if (shouldToggle) {
      setCollapsed((prev) => !prev);
    }
  };

  const handleMascotKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    setCollapsed((prev) => !prev);
  };

  return (
    <div
      ref={rootRef}
      className={`pointer-events-none fixed z-40 w-[min(320px,calc(100vw-8px))] ${
        guidePosition ? "" : `right-2 md:right-4 ${isMyPage ? "top-[132px] md:top-[124px]" : "top-[84px] md:top-[92px]"}`
      }`}
      style={guidePosition ? { left: guidePosition.x, top: guidePosition.y } : undefined}
    >
      <div className="relative flex flex-col items-end">
        {!collapsed ? (
          <div className="pointer-events-auto relative mb-[-6px] mr-5 w-[min(196px,calc(100vw-112px))] rounded-[20px] border border-amber-200/80 bg-white/95 px-3 py-2.5 shadow-[0_12px_26px_rgba(15,23,42,0.12)] backdrop-blur-sm">
            <p className="text-[12px] font-extrabold leading-[18px] text-neutral-950">
              {loading ? "짐냥이가 지금 상황에 맞는 안내를 고르는 중이에요." : activeSuggestion?.title}
            </p>

            <p className="mt-1.5 text-[11px] font-medium leading-[18px] text-neutral-600">
              {loading
                ? "오픈카드와 1:1 소개팅 중에서 지금 가장 자연스러운 다음 행동을 골라드릴게요."
                : activeSuggestion?.body}
            </p>

            <div className="mt-2.5 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                {suggestions.slice(0, 16).map((item, tipIndex) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setIndex(tipIndex)}
                    className={`h-2 rounded-full transition ${tipIndex === index ? "w-5 bg-emerald-500" : "w-2 bg-neutral-200"}`}
                    aria-label={`${tipIndex + 1}번 안내 보기`}
                  />
                ))}
              </div>
              {activeSuggestion ? (
                <Link
                  href={activeSuggestion.href}
                  className="inline-flex min-h-[32px] items-center rounded-full bg-neutral-950 px-3 text-[11px] font-extrabold text-white hover:bg-neutral-800"
                >
                  {activeSuggestion.cta}
                </Link>
              ) : null}
            </div>

            <div className="absolute bottom-[-7px] right-11 h-3.5 w-3.5 rotate-45 rounded-[4px] border-b border-r border-amber-200/80 bg-white/95" />
          </div>
        ) : null}

        <div
          onPointerDown={handleMascotPointerDown}
          onPointerMove={handleMascotPointerMove}
          onPointerUp={handleMascotPointerUp}
          onPointerCancel={handleMascotPointerUp}
          onKeyDown={handleMascotKeyDown}
          role="button"
          tabIndex={0}
          aria-label={collapsed ? "짐냥이 안내 열기" : "짐냥이 안내 접기"}
          className={`pointer-events-auto relative z-10 shrink-0 touch-none select-none outline-none transition-all duration-300 focus-visible:ring-4 focus-visible:ring-amber-200/80 ${
            collapsed
              ? "origin-top-right translate-y-0 scale-[0.64] cursor-pointer hover:-translate-y-1 active:translate-y-0 active:scale-[0.59]"
              : "-translate-y-1 scale-100 cursor-grab active:cursor-grabbing active:scale-[0.97]"
          }`}
          title={collapsed ? "짐냥이를 누르면 안내가 열려요." : "짐냥이를 누르면 안내가 접혀요. 꾹 누르면 위치를 옮길 수 있어요."}
        >
          <div className={`relative transition-all duration-300 ${collapsed ? "h-[120px] w-[108px]" : "h-[158px] w-[142px]"}`}>
            <div className="absolute inset-x-6 bottom-1 h-4 rounded-full bg-black/10 blur-md" />
            {collapsed ? <div className="absolute inset-3 rounded-[28px] bg-amber-200/30 blur-xl transition-transform duration-200 group-active:scale-90" /> : null}
            <div className="absolute inset-0 overflow-hidden rounded-[32px] shadow-[0_10px_24px_rgba(15,23,42,0.12)] transition-transform duration-150 active:scale-95">
              <Image
                src={mascotSrc}
                alt="짐냥이"
                fill
                className="object-cover object-center"
                sizes="170px"
                priority={false}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

