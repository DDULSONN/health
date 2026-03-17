"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type HeaderUserMenuProps = {
  pathname: string;
  mobile?: boolean;
  onNavigate?: () => void;
};

export default function HeaderUserMenu({
  pathname,
  mobile = false,
  onNavigate,
}: HeaderUserMenuProps) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

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

        const [profileResult, notiResult, adminResult] = await Promise.allSettled([
          supabase.from("profiles").select("nickname").eq("user_id", user.id).maybeSingle(),
          fetch("/api/notifications?limit=1", { cache: "no-store" }),
          fetch("/api/admin/me", { cache: "no-store" }),
        ]);

        if (!mounted) return;

        if (profileResult.status === "fulfilled") {
          setNickname(profileResult.value.data?.nickname ?? null);
        } else {
          setNickname(null);
        }

        if (notiResult.status === "fulfilled" && notiResult.value.ok) {
          const noti = (await notiResult.value.json()) as { unread_count?: number };
          if (!mounted) return;
          setUnreadCount(Number(noti.unread_count ?? 0));
        } else {
          setUnreadCount(0);
        }

        if (adminResult.status === "fulfilled" && adminResult.value.ok) {
          const admin = (await adminResult.value.json()) as { isAdmin?: boolean };
          if (!mounted) return;
          setIsAdmin(Boolean(admin.isAdmin));
        } else {
          setIsAdmin(false);
        }
      } finally {
        if (mounted) setAuthChecked(true);
      }
    }

    void loadUser();
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      void loadUser();
      router.refresh();
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [router, supabase]);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  const userLabel = nickname ?? email?.split("@")[0] ?? null;

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await supabase.auth.signOut();
      setMenuOpen(false);
      onNavigate?.();
      router.push("/");
      router.refresh();
    } finally {
      setLoggingOut(false);
    }
  };

  if (!authChecked) {
    return mobile ? <div className="mt-2 h-10 rounded-lg bg-neutral-50" aria-hidden /> : null;
  }

  if (mobile) {
    return (
      <>
        {isAdmin && (
          <Link
            href="/dating/1on1"
            onClick={onNavigate}
            className={`block rounded-lg px-3 py-2.5 text-sm font-medium ${
              pathname === "/dating/1on1" || pathname.startsWith("/dating/1on1/")
                ? "bg-emerald-50 text-emerald-700"
                : "text-neutral-600 hover:bg-neutral-50"
            }`}
          >
            1:1 소개팅
          </Link>
        )}

        {isAdmin && (
          <Link
            href="/admin/cert-requests"
            onClick={onNavigate}
            className="mt-1 block rounded-lg bg-neutral-900 px-3 py-2.5 text-sm font-medium text-white"
          >
            인증 심사
          </Link>
        )}

        {userLabel ? (
          <div className="mt-2 space-y-1 border-t border-neutral-100 pt-2">
            <p className="px-3 text-sm font-medium text-neutral-700">{userLabel}</p>
            <Link
              href="/notifications"
              onClick={onNavigate}
              className="block rounded-lg px-3 py-2.5 text-sm text-neutral-600 hover:bg-neutral-50"
            >
              알림 {unreadCount > 0 ? `(${unreadCount})` : ""}
            </Link>
            <Link
              href="/mypage"
              onClick={onNavigate}
              className="block rounded-lg px-3 py-2.5 text-sm text-neutral-600 hover:bg-neutral-50"
            >
              마이페이지
            </Link>
            <Link
              href="/hall-of-fame"
              onClick={onNavigate}
              className="block rounded-lg px-3 py-2.5 text-sm text-neutral-600 hover:bg-neutral-50"
            >
              명예의 전당
            </Link>
            <button
              type="button"
              onClick={() => void handleLogout()}
              disabled={loggingOut}
              className="w-full rounded-lg px-3 py-2.5 text-left text-sm text-red-600 hover:bg-red-50 disabled:opacity-60"
            >
              로그아웃
            </button>
          </div>
        ) : (
          <Link
            href={`/login?redirect=${encodeURIComponent(pathname)}`}
            onClick={onNavigate}
            className="mt-2 block rounded-lg px-3 py-2.5 text-sm font-medium text-emerald-600 hover:bg-emerald-50"
          >
            로그인
          </Link>
        )}
      </>
    );
  }

  return (
    <>
      {isAdmin && (
        <Link
          href="/dating/1on1"
          className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
            pathname === "/dating/1on1" || pathname.startsWith("/dating/1on1/")
              ? "bg-emerald-100 text-emerald-700"
              : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
          }`}
        >
          1:1 소개팅
        </Link>
      )}

      {isAdmin && (
        <Link
          href="/admin/cert-requests"
          className="ml-1 rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-black"
        >
          인증 심사
        </Link>
      )}

      {userLabel && (
        <Link
          href="/notifications"
          className="relative px-2 py-1 text-neutral-600 hover:text-neutral-900"
          aria-label="알림"
        >
          <span className="text-lg">🔔</span>
          {unreadCount > 0 && (
            <span className="absolute -right-1 -top-1 h-[18px] min-w-[18px] rounded-full bg-red-500 px-1 text-center text-[10px] font-bold leading-[18px] text-white">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </Link>
      )}

      {userLabel ? (
        <div className="relative ml-1">
          <button
            type="button"
            onClick={() => setMenuOpen((prev) => !prev)}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-100"
          >
            {userLabel} 님
          </button>
          {menuOpen && (
            <div className="absolute right-0 mt-1 w-44 overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-lg">
              <Link
                href="/mypage"
                onClick={() => setMenuOpen(false)}
                className="block px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50"
              >
                마이페이지
              </Link>
              <Link
                href="/hall-of-fame"
                onClick={() => setMenuOpen(false)}
                className="block px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50"
              >
                명예의 전당
              </Link>
              <button
                type="button"
                onClick={() => void handleLogout()}
                disabled={loggingOut}
                className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 disabled:opacity-60"
              >
                로그아웃
              </button>
            </div>
          )}
        </div>
      ) : (
        <Link
          href={`/login?redirect=${encodeURIComponent(pathname)}`}
          className="ml-2 rounded-lg px-3 py-1.5 text-sm font-medium text-emerald-600 hover:bg-emerald-50"
        >
          로그인
        </Link>
      )}
    </>
  );
}
