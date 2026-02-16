"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const NAV_ITEMS = [
  { href: "/1rm", label: "1RM 계산기" },
  { href: "/lifts", label: "3대 합계" },
  { href: "/certify", label: "3대 인증" },
  { href: "/helltest", label: "헬창 판독기" },
  { href: "/snacks", label: "다이어트 간식" },
  { href: "/community/bodycheck", label: "사진 몸평" },
  { href: "/community", label: "커뮤니티" },
  { href: "/dating/apply", label: "소개팅" },
];

export default function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [mobileOpen, setMobileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [nickname, setNickname] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function loadUser() {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!mounted) return;

        if (!user) {
          setNickname(null);
          setEmail(null);
          setUnreadCount(0);
          setIsAdmin(false);
          return;
        }

        setEmail(user.email ?? null);
        const { data: profile } = await supabase
          .from("profiles")
          .select("nickname")
          .eq("user_id", user.id)
          .maybeSingle();
        if (!mounted) return;
        setNickname(profile?.nickname ?? null);

        try {
          const [notiRes, adminRes] = await Promise.all([
            fetch("/api/notifications?limit=1", { cache: "no-store" }),
            fetch("/api/admin/me", { cache: "no-store" }),
          ]);

          if (notiRes.ok) {
            const noti = (await notiRes.json()) as { unread_count?: number };
            setUnreadCount(Number(noti.unread_count ?? 0));
          }

          if (adminRes.ok) {
            const admin = (await adminRes.json()) as { isAdmin?: boolean };
            setIsAdmin(Boolean(admin.isAdmin));
          } else {
            setIsAdmin(false);
          }
        } catch {
          setUnreadCount(0);
          setIsAdmin(false);
        }
      } finally {
        if (mounted) setAuthChecked(true);
      }
    }

    loadUser();
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      loadUser();
      router.refresh();
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [router, supabase]);

  const userLabel = nickname ?? email?.split("@")[0] ?? null;

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await supabase.auth.signOut();
      setMenuOpen(false);
      setMobileOpen(false);
      router.push("/");
      router.refresh();
    } finally {
      setLoggingOut(false);
    }
  };

  return (
    <header className="sticky top-0 z-50 bg-white/85 backdrop-blur-md border-b border-neutral-200">
      <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
        <Link href="/" className="text-lg font-bold text-emerald-600 hover:text-emerald-700">
          짐툴
        </Link>

        <nav className="hidden md:flex items-center gap-1">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                  active ? "bg-emerald-100 text-emerald-700" : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
                }`}
              >
                {item.label}
              </Link>
            );
          })}

          {authChecked && isAdmin && (
            <Link
              href="/admin/cert-requests"
              className="ml-1 px-3 py-1.5 rounded-lg text-sm font-medium bg-neutral-900 text-white hover:bg-black"
            >
              인증 심사
            </Link>
          )}

          {authChecked && userLabel && (
            <Link href="/notifications" className="relative px-2 py-1 text-neutral-600 hover:text-neutral-900" aria-label="알림">
              <span className="text-lg">🔔</span>
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] leading-[18px] text-center font-bold">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </Link>
          )}

          {authChecked &&
            (userLabel ? (
              <div className="relative ml-1">
                <button
                  type="button"
                  onClick={() => setMenuOpen((prev) => !prev)}
                  className="px-3 py-1.5 rounded-lg text-sm font-medium text-neutral-700 hover:bg-neutral-100"
                >
                  {userLabel} ▼
                </button>
                {menuOpen && (
                  <div className="absolute right-0 mt-1 w-44 rounded-xl border border-neutral-200 bg-white shadow-lg overflow-hidden">
                    <Link href="/mypage" onClick={() => setMenuOpen(false)} className="block px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50">
                      마이페이지
                    </Link>
                    <Link href="/hall-of-fame" onClick={() => setMenuOpen(false)} className="block px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50">
                      명예의 전당
                    </Link>
                    <button
                      type="button"
                      onClick={handleLogout}
                      disabled={loggingOut}
                      className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-60"
                    >
                      로그아웃
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <Link
                href={`/login?redirect=${encodeURIComponent(pathname)}`}
                className="ml-2 px-3 py-1.5 rounded-lg text-sm font-medium text-emerald-600 hover:bg-emerald-50"
              >
                로그인
              </Link>
            ))}
        </nav>

        <button
          type="button"
          onClick={() => setMobileOpen((prev) => !prev)}
          className="md:hidden p-2 rounded-lg hover:bg-neutral-100"
          aria-label={mobileOpen ? "메뉴 닫기" : "메뉴 열기"}
        >
          <svg className="w-5 h-5 text-neutral-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {mobileOpen ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            )}
          </svg>
        </button>
      </div>

      {mobileOpen && (
        <nav className="md:hidden border-t border-neutral-100 bg-white px-4 pb-3 pt-2">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className={`block py-2.5 px-3 rounded-lg text-sm font-medium ${
                  active ? "bg-emerald-50 text-emerald-700" : "text-neutral-600 hover:bg-neutral-50"
                }`}
              >
                {item.label}
              </Link>
            );
          })}

          {authChecked && isAdmin && (
            <Link
              href="/admin/cert-requests"
              onClick={() => setMobileOpen(false)}
              className="block mt-1 py-2.5 px-3 rounded-lg text-sm font-medium bg-neutral-900 text-white"
            >
              인증 심사
            </Link>
          )}

          {authChecked &&
            (userLabel ? (
              <div className="mt-2 border-t border-neutral-100 pt-2 space-y-1">
                <p className="px-3 text-sm font-medium text-neutral-700">{userLabel}</p>
                <Link href="/notifications" onClick={() => setMobileOpen(false)} className="block py-2.5 px-3 rounded-lg text-sm text-neutral-600 hover:bg-neutral-50">
                  알림 {unreadCount > 0 ? `(${unreadCount})` : ""}
                </Link>
                <Link href="/mypage" onClick={() => setMobileOpen(false)} className="block py-2.5 px-3 rounded-lg text-sm text-neutral-600 hover:bg-neutral-50">
                  마이페이지
                </Link>
                <Link href="/hall-of-fame" onClick={() => setMobileOpen(false)} className="block py-2.5 px-3 rounded-lg text-sm text-neutral-600 hover:bg-neutral-50">
                  명예의 전당
                </Link>
                <button
                  type="button"
                  onClick={handleLogout}
                  disabled={loggingOut}
                  className="w-full text-left py-2.5 px-3 rounded-lg text-sm text-red-600 hover:bg-red-50 disabled:opacity-60"
                >
                  로그아웃
                </button>
              </div>
            ) : (
              <Link
                href={`/login?redirect=${encodeURIComponent(pathname)}`}
                onClick={() => setMobileOpen(false)}
                className="block mt-2 py-2.5 px-3 rounded-lg text-sm font-medium text-emerald-600 hover:bg-emerald-50"
              >
                로그인
              </Link>
            ))}
        </nav>
      )}
    </header>
  );
}

