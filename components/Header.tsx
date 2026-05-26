"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const HeaderUserMenu = dynamic(() => import("@/components/HeaderUserMenu"), {
  ssr: false,
  loading: () => <div className="ml-2 h-10 w-24 rounded-2xl bg-neutral-100" aria-hidden />,
});

const NAV_ITEMS = [
  { href: "/community/dating/cards", label: "오픈카드" },
  { href: "/chat", label: "채팅" },
  { href: "/dating/1on1", label: "1:1" },
  { href: "/community", label: "커뮤니티" },
];

const TOOL_ITEMS = [
  { href: "/lifts", label: "3대 합계 계산기" },
  { href: "/1rm", label: "1RM 계산기" },
];

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function isToolActive(pathname: string) {
  return TOOL_ITEMS.some((item) => isActive(pathname, item.href));
}

export default function Header() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-black/5 bg-white/92 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 md:h-[74px] md:px-6">
        <Link
          href="/community/dating/cards"
          className="inline-flex items-center gap-2.5 text-[18px] font-black tracking-tight text-neutral-950 md:text-[19px]"
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

          <div className="group relative">
            <Link
              href="/lifts"
              className={`inline-flex min-h-[42px] items-center rounded-full px-4 text-sm font-semibold transition ${
                isToolActive(pathname)
                  ? "bg-neutral-950 text-white shadow-[0_8px_22px_rgba(17,24,39,0.12)]"
                  : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
              }`}
            >
              도구
            </Link>
            <div className="invisible absolute left-1/2 top-full z-50 mt-2 w-48 -translate-x-1/2 rounded-2xl border border-black/5 bg-white p-2 opacity-0 shadow-[0_16px_38px_rgba(15,23,42,0.14)] transition group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
              {TOOL_ITEMS.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`block rounded-xl px-3 py-2 text-sm font-semibold transition ${
                    isActive(pathname, item.href)
                      ? "bg-neutral-950 text-white"
                      : "text-neutral-700 hover:bg-neutral-100"
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </div>

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

            <div className="rounded-2xl border border-black/5 bg-neutral-50 p-2">
              <div className="px-2 pb-2 text-xs font-black text-neutral-400">도구</div>
              <div className="grid gap-2">
                {TOOL_ITEMS.map((item) => {
                  const active = isActive(pathname, item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMobileOpen(false)}
                      className={`inline-flex min-h-[44px] items-center rounded-xl px-3 text-sm font-semibold transition ${
                        active ? "bg-neutral-950 text-white" : "bg-white text-neutral-700 hover:bg-neutral-100"
                      }`}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="mt-3 border-t border-black/5 pt-3">
            <HeaderUserMenu pathname={pathname} mobile onNavigate={() => setMobileOpen(false)} />
          </div>
        </nav>
      ) : null}
    </header>
  );
}

