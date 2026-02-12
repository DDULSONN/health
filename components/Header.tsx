"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const NAV_ITEMS = [
  { href: "/1rm", label: "1RM 계산기" },
  { href: "/lifts", label: "3대 합계" },
  { href: "/helltest", label: "헬스성향테스트" },
  { href: "/snacks", label: "다이어트 간식" },
  { href: "/community/bodycheck", label: "사진 몸평" },
  { href: "/community", label: "커뮤니티" },
];

export default function Header() {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const [nickname, setNickname] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (user) {
          const { data: profile } = await supabase
            .from("profiles")
            .select("nickname")
            .eq("user_id", user.id)
            .single();
          setNickname(profile?.nickname ?? null);
        }
      } catch {
        // ignore
      }
      setAuthChecked(true);
    })();
  }, []);

  return (
    <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-neutral-200">
      <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between">
        <Link
          href="/"
          className="text-lg font-bold text-emerald-600 hover:text-emerald-700 transition-colors"
        >
          GymTools
        </Link>

        <nav className="hidden md:flex items-center gap-1">
          {NAV_ITEMS.map((item) => {
            const isActive =
              pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-emerald-100 text-emerald-700"
                    : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
          {authChecked &&
            (nickname ? (
              <span className="ml-2 px-3 py-1.5 text-sm font-medium text-neutral-700">
                {nickname}
              </span>
            ) : (
              <Link
                href={`/login?redirect=${encodeURIComponent(pathname)}`}
                className="ml-2 px-3 py-1.5 rounded-lg text-sm font-medium text-emerald-600 hover:bg-emerald-50 transition-colors"
              >
                로그인
              </Link>
            ))}
        </nav>

        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="md:hidden p-2 rounded-lg hover:bg-neutral-100 transition-colors"
          aria-label={isOpen ? "메뉴 닫기" : "메뉴 열기"}
        >
          <svg
            className="w-5 h-5 text-neutral-700"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            {isOpen ? (
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            ) : (
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 6h16M4 12h16M4 18h16"
              />
            )}
          </svg>
        </button>
      </div>

      {isOpen && (
        <nav className="md:hidden border-t border-neutral-100 bg-white px-4 pb-3 pt-1">
          {NAV_ITEMS.map((item) => {
            const isActive =
              pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setIsOpen(false)}
                className={`block py-2.5 px-3 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-emerald-50 text-emerald-700"
                    : "text-neutral-600 hover:bg-neutral-50"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
          {authChecked &&
            (nickname ? (
              <span className="block py-2.5 px-3 text-sm font-medium text-neutral-700">
                {nickname}
              </span>
            ) : (
              <Link
                href={`/login?redirect=${encodeURIComponent(pathname)}`}
                onClick={() => setIsOpen(false)}
                className="block py-2.5 px-3 rounded-lg text-sm font-medium text-emerald-600 hover:bg-emerald-50"
              >
                로그인
              </Link>
            ))}
        </nav>
      )}
    </header>
  );
}
