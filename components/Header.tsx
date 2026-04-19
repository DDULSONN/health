"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useState } from "react";
import { usePathname } from "next/navigation";

const HeaderUserMenu = dynamic(() => import("@/components/HeaderUserMenu"), {
  ssr: false,
  loading: () => <div className="ml-2 h-9 w-24 rounded-lg bg-neutral-100" aria-hidden />,
});

const NAV_ITEMS = [
  { href: "/community/dating/cards", label: "홈" },
  { href: "/dating/1on1", label: "1:1 소개팅" },
  { href: "/community", label: "커뮤니티" },
  { href: "/lifts", label: "도구" },
];

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function Header() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-rose-100 bg-white/95 backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 md:px-6">
        <Link href="/community/dating/cards" className="inline-flex items-center gap-2 text-[17px] font-black tracking-tight text-neutral-900 hover:text-neutral-700">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-pink-500" aria-hidden />
          <span>GymTools</span>
        </Link>

        <nav className="hidden items-center gap-1.5 md:flex">
          {NAV_ITEMS.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  active ? "bg-rose-50 text-rose-700 ring-1 ring-rose-200" : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
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
          className="rounded-lg p-2 hover:bg-neutral-100 md:hidden"
          aria-label={mobileOpen ? "메뉴 닫기" : "메뉴 열기"}
        >
          <svg className="h-5 w-5 text-neutral-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {mobileOpen ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            )}
          </svg>
        </button>
      </div>

      {mobileOpen ? (
        <nav className="border-t border-neutral-100 bg-white px-4 pb-3 pt-2 md:hidden">
          {NAV_ITEMS.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className={`block rounded-xl px-3 py-2.5 text-sm font-medium ${
                  active ? "bg-rose-50 text-rose-700" : "text-neutral-600 hover:bg-neutral-50"
                }`}
              >
                {item.label}
              </Link>
            );
          })}

          <HeaderUserMenu pathname={pathname} mobile onNavigate={() => setMobileOpen(false)} />
        </nav>
      ) : null}
    </header>
  );
}
