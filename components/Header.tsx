"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const HeaderUserMenu = dynamic(() => import("@/components/HeaderUserMenu"), {
  ssr: false,
  loading: () => <div className="ml-2 h-10 w-24 rounded-2xl bg-neutral-100" aria-hidden />,
});

const NAV_ITEMS = [
  { href: "/community/dating/cards", label: "오픈카드" },
  { href: "/chat", label: "채팅" },
  { href: "/dating/1on1", label: "1:1" },
  { href: "/tools", label: "도구" },
];

const TOOL_PATHS = ["/tools", "/flirting-generator", "/lifts", "/1rm", "/certify"];
const DATING_REACTION_COUNT_EVENT = "dating-reaction-count";

function isActive(pathname: string, href: string) {
  if (href === "/tools") {
    return TOOL_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function Header() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [datingReactionCount, setDatingReactionCount] = useState<number | null>(null);
  const showDatingReactionBadge = pathname.startsWith("/community/dating/cards");

  useEffect(() => {
    let cancelled = false;

    if (!showDatingReactionBadge) return;

    const handleDatingReactionCount = (event: Event) => {
      const count = Number((event as CustomEvent<{ count?: number }>).detail?.count ?? NaN);
      if (Number.isFinite(count)) {
        setDatingReactionCount(Math.max(0, count));
      }
    };

    window.addEventListener(DATING_REACTION_COUNT_EVENT, handleDatingReactionCount);

    fetch("/api/dating/cards/queue-stats", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (cancelled || !body) return;
        const count = Math.max(
          0,
          Number(body.today_dating_reactions_count ?? body.recent_open_card_applications_24h_count ?? 0)
        );
        setDatingReactionCount(count);
      })
      .catch(() => {
        if (!cancelled) setDatingReactionCount(null);
      });

    return () => {
      cancelled = true;
      window.removeEventListener(DATING_REACTION_COUNT_EVENT, handleDatingReactionCount);
    };
  }, [showDatingReactionBadge]);

  if (pathname === "/" || pathname.startsWith("/landing")) return null;

  return (
    <header className="sticky top-0 z-50 border-b border-black/5 bg-white/92 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 md:h-[74px] md:px-6">
        <div className="flex min-w-0 items-center gap-2.5">
          <Link
            href="/community/dating/cards"
            className="inline-flex min-w-0 items-center gap-2.5 text-[18px] font-black tracking-tight text-neutral-950 md:text-[19px]"
          >
            <Image
              src="/icon-192x192.png"
              alt=""
              width={30}
              height={30}
              className="h-7 w-7 rounded-lg shadow-[0_5px_14px_rgba(244,63,94,0.18)] md:h-8 md:w-8"
              priority
            />
            <span>짐툴</span>
          </Link>
          {showDatingReactionBadge && datingReactionCount !== null ? (
            <span className="inline-flex max-w-[112px] items-center gap-1 rounded-full bg-rose-50 px-2.5 py-1 text-[11px] font-extrabold text-rose-600">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-rose-500" aria-hidden />
              <span className="truncate">오늘 {datingReactionCount.toLocaleString("ko-KR")}건</span>
            </span>
          ) : null}
        </div>

        <nav className="hidden items-center gap-2 md:flex">
          {NAV_ITEMS.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`inline-flex min-h-[42px] items-center rounded-full px-4 text-sm font-semibold transition ${
                  active
                    ? "bg-neutral-950 text-white shadow-[0_8px_22px_rgba(17,24,39,0.12)]"
                    : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
                }`}
              >
                {item.label}
              </Link>
            );
          })}

          <HeaderUserMenu pathname={pathname} />
        </nav>

        <button
          type="button"
          onClick={() => setMobileOpen((prev) => !prev)}
          className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-black/5 bg-white text-neutral-700 shadow-[0_6px_18px_rgba(15,23,42,0.06)] md:hidden"
          aria-label={mobileOpen ? "메뉴 닫기" : "메뉴 열기"}
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {mobileOpen ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.1} d="M6 18L18 6M6 6l12 12" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.1} d="M4 7h16M4 12h16M4 17h16" />
            )}
          </svg>
        </button>
      </div>

      {mobileOpen ? (
        <nav className="border-t border-black/5 bg-white px-5 pb-4 pt-3 md:hidden">
          <div className="grid gap-2">
            {NAV_ITEMS.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className={`inline-flex min-h-[48px] items-center rounded-2xl px-4 text-sm font-semibold transition ${
                    active
                      ? "bg-neutral-950 text-white"
                      : "border border-black/5 bg-neutral-50 text-neutral-700 hover:bg-neutral-100"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>

          <div className="mt-3 border-t border-black/5 pt-3">
            <HeaderUserMenu pathname={pathname} mobile onNavigate={() => setMobileOpen(false)} />
          </div>
        </nav>
      ) : null}
    </header>
  );
}
