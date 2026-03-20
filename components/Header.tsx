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
  { href: "/1rm", label: "1RM 계산기" },
  { href: "/lifts", label: "3대 합계" },
  { href: "/community/dating", label: "소개팅" },
  { href: "/community", label: "커뮤니티" },
  { href: "/certify", label: "3대 인증" },
  { href: "/ad-inquiry", label: "광고 문의" },
];

export default function Header() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-neutral-200 bg-white/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
        <Link href="/" className="text-lg font-bold text-emerald-600 hover:text-emerald-700">
          짐툴
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                  active
                    ? "bg-emerald-100 text-emerald-700"
                    : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
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

      {mobileOpen && (
        <nav className="border-t border-neutral-100 bg-white px-4 pb-3 pt-2 md:hidden">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className={`block rounded-lg px-3 py-2.5 text-sm font-medium ${
                  active ? "bg-emerald-50 text-emerald-700" : "text-neutral-600 hover:bg-neutral-50"
                }`}
              >
                {item.label}
              </Link>
            );
          })}

          <HeaderUserMenu pathname={pathname} mobile onNavigate={() => setMobileOpen(false)} />
        </nav>
      )}
    </header>
  );
}
