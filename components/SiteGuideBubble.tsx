"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

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

type GuideSuggestion = {
  id: string;
  title: string;
  body: string;
  href: string;
  cta: string;
};

const HIDDEN_PATH_PREFIXES = ["/payments/success", "/payments/fail", "/account-deletion", "/login", "/signup", "/auth"];
const COLLAPSE_STORAGE_KEY = "site-guide-collapsed";

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
  const {
    pathname,
    loggedIn,
    phoneVerified,
    swipeVisible,
    hasAnyOpenCard,
    hasPendingOpenCard,
    hasPublicOpenCard,
    hasOneOnOneActive,
    canApplyOneOnOne,
  } = input;

  if (loggedIn === false) {
    return [
      {
        id: "guest-open-card",
        title: "처음 오셨다면 오픈카드부터 열어보세요",
        body: "짐냥이가 보기엔 여기서 시작하는 게 제일 편해요. 먼저 둘러보면 전체 흐름이 금방 잡혀요.",
        href: "/community/dating/cards",
        cta: "오픈카드 보기",
      },
      {
        id: "guest-browse",
        title: "가볍게 둘러보다가 마음에 들면 시작해도 늦지 않아요",
        body: "빠른매칭, 1:1 소개팅, 이상형 더보기까지 어떤 느낌인지 먼저 보고 감을 잡아보세요.",
        href: "/community/dating/cards",
        cta: "먼저 둘러보기",
      },
      {
        id: "guest-bodycheck",
        title: "커뮤니티 몸평 설문도 한 번 참여해보세요",
        body: "운동하는 사람들 분위기를 가볍게 느끼고 싶다면 몸평 피드부터 보는 것도 꽤 재밌어요.",
        href: "/community/bodycheck",
        cta: "몸평 보러가기",
      },
    ] satisfies GuideSuggestion[];
  }

  const suggestions: GuideSuggestion[] = [];

  if (!hasAnyOpenCard) {
    suggestions.push(
      {
        id: "open-card-first",
        title: "오픈카드부터 열어두면 시작이 훨씬 쉬워져요",
        body: "카드를 먼저 만들어두면 먼저 지원을 받을 수도 있고, 직접 둘러보며 연결을 시작하기도 편해져요.",
        href: "/community/dating/cards/new",
        cta: "오픈카드 작성",
      },
      {
        id: "open-card-benefit",
        title: "처음 시작은 오픈카드가 제일 무난해요",
        body: "오픈카드를 등록·유지하면 매주 원하는 지역 1곳을 무료로 열어볼 수 있어서 가까운 이상형 보기에도 좋아요.",
        href: "/community/dating/cards/new",
        cta: "지금 등록하기",
      },
      {
        id: "open-card-romance",
        title: "운동이라는 공통점으로 시작하면 대화가 더 자연스러워요",
        body: "가볍게 연결을 열어두고 싶다면 오픈카드가 가장 부담 없는 시작점이 될 수 있어요.",
        href: "/community/dating/cards/new",
        cta: "가볍게 시작하기",
      }
    );
  }

  if (hasPendingOpenCard) {
    suggestions.push(
      {
        id: "pending-card",
        title: "오픈카드가 준비 중이에요",
        body: "공개 전까지 조금만 기다려주세요. 그 사이 빠른매칭이나 1:1 소개팅을 같이 둘러보면 더 감이 빨리 와요.",
        href: "/community/dating/cards",
        cta: "빠른매칭 보기",
      },
      {
        id: "pending-mypage",
        title: "지금 상태는 마이페이지에서 가장 빨리 보여요",
        body: "대기 중인 카드와 들어온 반응은 마이페이지에서 한 번에 볼 수 있어요. 흐름 정리할 때 제일 편해요.",
        href: "/mypage",
        cta: "마이페이지 가기",
      },
      {
        id: "pending-paid-fast",
        title: "짐냥이가 보기엔 빨리 공개하고 싶다면 대기 없이 등록이 잘 맞아요",
        body: "심사 대기 없이 바로 공개하고 싶을 때는 유료 카드 쪽이 훨씬 시원하게 이어져요.",
        href: "/dating/paid",
        cta: "대기 없이 등록 보기",
      },
      {
        id: "pending-paid-top",
        title: "기다리는 동안 고민된다면 상단 고정도 같이 볼 만해요",
        body: "그냥 기다리기보다 더 잘 보이게 올리는 쪽이 지금 타이밍엔 더 잘 맞을 수도 있어요.",
        href: "/dating/paid",
        cta: "유료 카드 보기",
      }
    );
  }

  if (hasPublicOpenCard) {
    suggestions.push(
      {
        id: "public-card-status",
        title: "지금 카드가 공개 중이에요",
        body: "들어온 지원이 있는지 먼저 확인해보세요. 기다리기만 하지 말고 직접 둘러보는 것도 꽤 좋아요.",
        href: "/mypage",
        cta: "지원 확인하기",
      },
      {
        id: "public-card-fastmatch",
        title: "이제 빠른매칭도 같이 보는 타이밍이에요",
        body: "오픈카드가 열려 있다면 빠른매칭을 함께 쓰는 게 연결 기회를 넓히는 데 도움이 돼요.",
        href: "/community/dating/cards",
        cta: "빠른매칭 보기",
      },
      {
        id: "public-card-more-view",
        title: "더 넓게 보고 싶다면 이상형 더보기도 괜찮아요",
        body: "지금 보이는 카드가 조금 아쉽다면 더 넓게 둘러보면서 마음에 드는 사람을 찾기 쉬워져요.",
        href: "/dating/more-view",
        cta: "이상형 더보기",
      },
      {
        id: "public-card-nearby",
        title: "가까운 지역부터 보면 실제 연결까지 이어지기 더 편해요",
        body: "생활권이 비슷한 사람부터 보는 게 의외로 잘 맞을 때가 많아요. 가까운 이상형도 함께 열어보세요.",
        href: "/dating/nearby-view",
        cta: "가까운 이상형 보기",
      },
      {
        id: "public-card-paid",
        title: "노출을 더 강하게 올리고 싶다면 유료 카드도 있어요",
        body: "대기 없이 등록하거나 상단 고정으로 올리면 일반 카드보다 눈에 띄기 쉬워요.",
        href: "/dating/paid",
        cta: "유료 카드 보기",
      },
      {
        id: "public-card-credits",
        title: "마음에 드는 사람에게 더 자주 지원하고 싶다면 지원권도 챙겨보세요",
        body: "기본 지원 횟수 외에 조금 더 적극적으로 보고 싶을 때 꽤 유용해요.",
        href: "/dating/apply-credits",
        cta: "지원권 보기",
      },
      {
        id: "public-card-bodycheck",
        title: "커뮤니티 몸평 설문도 가끔 들러보세요",
        body: "운동하는 사람들 분위기를 익히고 싶거나 가볍게 참여하고 싶다면 몸평 피드가 생각보다 재밌어요.",
        href: "/community/bodycheck",
        cta: "몸평 보러가기",
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
    suggestions.push(
      {
        id: "swipe-plus",
        title: "오늘 더 넉넉하게 보고 싶다면 빠른매칭 플러스도 있어요",
        body: "기본보다 더 많이 보고 싶을 때 선택지만 넓혀주는 느낌이라, 필요한 날에만 열어도 충분해요.",
        href: "/community/dating/cards",
        cta: "플러스 보기",
      },
      {
        id: "swipe-bodycheck",
        title: "빠른매칭만 보지 말고 몸평 설문도 한 번 참여해보세요",
        body: "분위기 환기용으로 가볍게 보기 좋고, 커뮤니티 쪽 온도도 같이 느껴볼 수 있어요.",
        href: "/community/bodycheck",
        cta: "설문 참여하기",
      }
    );
  }

  if (!phoneVerified) {
    suggestions.push({
      id: "phone-verify",
      title: "휴대폰 인증은 미리 해두면 편해요",
      body: "1:1 소개팅이나 다른 연결 기능을 쓸 때 훨씬 자연스럽게 이어져요. 필요할 때 급하게 하지 않아도 돼요.",
      href: "/mypage",
      cta: "인증하러 가기",
    });
  }

  if (hasPublicOpenCard && !hasOneOnOneActive && canApplyOneOnOne) {
    suggestions.push(
      {
        id: "try-1on1",
        title: "조금 더 진지하게 보고 싶다면 1:1 소개팅도 잘 맞아요",
        body: "후보를 보고 신청한 뒤 서로 수락되면 연결이 이어져요. 오픈카드와는 다른 흐름이라 같이 쓰는 분들도 많아요.",
        href: "/dating/1on1",
        cta: "1:1 소개팅 보기",
      },
      {
        id: "try-1on1-flow",
        title: "차분하게 보고 결정하고 싶을 땐 1:1이 편해요",
        body: "후보를 보고 판단하는 쪽이 더 맞다면 이 방식이 마음에 들 수 있어요.",
        href: "/dating/1on1",
        cta: "후보 흐름 보기",
      }
    );
  }

  if (hasOneOnOneActive) {
    suggestions.push(
      {
        id: "1on1-active",
        title: "진행 중인 1:1 소개팅이 있어요",
        body: "후보 확인, 수락, 번호 교환 상태는 마이페이지에서 가장 빨리 확인할 수 있어요.",
        href: "/mypage",
        cta: "진행 상황 보기",
      },
      {
        id: "1on1-payment",
        title: "좋은 분위기라면 즉시 번호 교환으로 이어질 수도 있어요",
        body: "쌍방 매칭이 되면 필요한 순간 바로 교환 흐름으로 넘어갈 수 있어요.",
        href: "/mypage",
        cta: "번호 교환 확인",
      }
    );
  }

  if (pathname.startsWith("/community/bodycheck")) {
    suggestions.unshift({
      id: "route-bodycheck",
      title: "몸평 피드는 가볍게 참여하기 좋은 커뮤니티예요",
      body: "사진 보고 바로 투표하거나, 마음에 들면 직접 글도 올려보세요. 분위기 파악용으로도 좋아요.",
      href: "/community/bodycheck/write",
      cta: "몸평글 쓰기",
    });
  } else if (pathname.startsWith("/community/write")) {
    suggestions.unshift({
      id: "route-community-write",
      title: "몸평글을 올리면 더 많은 반응을 받을 수 있어요",
      body: "가볍게 참여해도 좋고, 몸평 설문에 꾸준히 보이는 사람은 커뮤니티에서 존재감이 생겨요.",
      href: "/community/bodycheck",
      cta: "몸평 피드 보기",
    });
  } else if (pathname.startsWith("/community/dating/cards")) {
    suggestions.unshift(
      hasAnyOpenCard
        ? {
            id: "route-cards-live",
            title: "여기는 카드 둘러보기와 빠른매칭을 같이 보기 좋은 곳이에요",
            body: "내 카드 관리나 지원 확인은 마이페이지에서, 새 연결 찾기는 여기서 이어보면 흐름이 편해요.",
            href: "/mypage",
            cta: "내 상태 확인",
          }
        : {
            id: "route-cards-start",
            title: "여기서 오픈카드부터 시작하면 가장 편해요",
            body: "카드를 먼저 열어두면 다른 기능도 이어붙이기 쉬워요. 짐냥이는 이 순서를 제일 추천할게요.",
            href: "/community/dating/cards/new",
            cta: "카드 만들기",
          }
    );
  } else if (pathname.startsWith("/dating/1on1")) {
    suggestions.unshift(
      hasOneOnOneActive
        ? {
            id: "route-1on1-active",
            title: "1:1 진행 상태는 마이페이지에서 보는 게 제일 빨라요",
            body: "여기서는 흐름을 보고, 실제 수락이나 번호 교환 상태는 마이페이지에서 확인하면 편해요.",
            href: "/mypage",
            cta: "마이페이지로 가기",
          }
        : {
            id: "route-1on1-intro",
            title: "1:1은 후보를 보고 천천히 결정하는 방식이에요",
            body: "서로 수락되면 연결이 이어져요. 생각보다 복잡하지 않아서 천천히 보기 좋아요.",
            href: "/dating/1on1",
            cta: "안내 더 보기",
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
      title: "유료 카드는 노출을 더 강하게 올리고 싶을 때 쓰면 돼요",
      body: "상단 고정이나 대기 없이 등록처럼 눈에 띄는 방식이 필요할 때 꽤 확실해요.",
      href: "/dating/paid",
      cta: "유료 카드 보기",
    });
  } else if (pathname.startsWith("/mypage")) {
    suggestions.unshift({
      id: "route-mypage",
      title: "지금 필요한 건 마이페이지에 모여 있어요",
      body: "지원, 매칭, 결제 내역까지 여기서 가장 빠르게 확인할 수 있어요.",
      href: "/mypage",
      cta: "여기서 확인하기",
    });
  }

  return suggestions.slice(0, 16);
}

export default function SiteGuideBubble() {
  const pathname = usePathname();
  const isMyPage = pathname?.startsWith("/mypage") ?? false;
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [index, setIndex] = useState(0);
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [openCards, setOpenCards] = useState<OpenCardItem[]>([]);
  const [oneOnOne, setOneOnOne] = useState<OneOnOneStatusResponse | null>(null);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(COLLAPSE_STORAGE_KEY);
      if (saved === "1") setCollapsed(true);
    } catch {}
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(COLLAPSE_STORAGE_KEY, collapsed ? "1" : "0");
    } catch {}
  }, [collapsed]);

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

  if (HIDDEN_PATH_PREFIXES.some((prefix) => pathname?.startsWith(prefix))) {
    return null;
  }

  const activeSuggestion = suggestions[index] ?? null;
  if (!activeSuggestion && !loading) return null;

  return (
    <div
      className={`pointer-events-none fixed right-2 z-40 w-[min(320px,calc(100vw-8px))] md:right-4 ${
        isMyPage ? "top-[132px] md:top-[124px]" : "top-[84px] md:top-[92px]"
      }`}
    >
      <div className="relative flex flex-col items-end">
        {!collapsed ? (
          <div className="pointer-events-auto relative mb-[-8px] mr-6 w-[min(210px,calc(100vw-118px))] rounded-[22px] border border-amber-200/80 bg-white/95 px-3 py-3 shadow-[0_14px_30px_rgba(15,23,42,0.14)] backdrop-blur-sm">
            <button
              type="button"
              onClick={() => setCollapsed(true)}
              className="absolute right-2 top-2 inline-flex h-7 min-w-[42px] items-center justify-center rounded-full bg-neutral-100 px-2 text-[11px] font-semibold text-neutral-600 hover:bg-neutral-200 hover:text-neutral-900"
              aria-label="짐냥이 접기"
            >
              접기
            </button>

            <p className="pr-11 text-[13px] font-bold leading-5 text-neutral-950">
              {loading ? "짐냥이가 지금 상황에 맞는 안내를 고르는 중이에요." : activeSuggestion?.title}
            </p>

            <p className="mt-2 text-[12px] leading-5 text-neutral-700">
              {loading
                ? "오픈카드, 빠른매칭, 1:1 소개팅, 커뮤니티 중에서 지금 가장 잘 맞는 다음 행동을 골라드릴게요."
                : activeSuggestion?.body}
            </p>

            <div className="mt-3 flex items-center justify-between gap-2">
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
                  className="inline-flex min-h-[34px] items-center rounded-full bg-neutral-950 px-3 text-[12px] font-bold text-white hover:bg-neutral-800"
                >
                  {activeSuggestion.cta}
                </Link>
              ) : null}
            </div>

            <div className="absolute bottom-[-8px] right-12 h-4 w-4 rotate-45 rounded-[4px] border-b border-r border-amber-200/80 bg-white/95" />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            className="pointer-events-auto mb-1 mr-6 inline-flex items-center rounded-full border border-amber-200 bg-white/95 px-3 py-1.5 text-[11px] font-semibold text-neutral-700 shadow-sm hover:bg-amber-50"
            aria-label="짐냥이 펼치기"
          >
            짐냥이 열기
          </button>
        )}

        <div
          className={`pointer-events-auto relative z-10 shrink-0 transition-all duration-300 ${
            collapsed ? "translate-y-0 scale-[0.72] origin-top-right" : "-translate-y-1 scale-100"
          }`}
        >
          <div className={`relative transition-all duration-300 ${collapsed ? "h-[132px] w-[118px]" : "h-[190px] w-[170px]"}`}>
            <div className="absolute inset-x-6 bottom-1 h-5 rounded-full bg-black/10 blur-md" />
            <div className="absolute inset-0 overflow-hidden rounded-[32px]">
              <Image
                src="/mascot/jimnyang-guide-v2.png"
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

