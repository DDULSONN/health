"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { clearDatingDraft } from "@/lib/dating-onboarding-draft";
import { isNotificationCount, NOTIFICATION_COUNT_EVENT, NOTIFICATION_COUNT_INVALIDATED_EVENT, publishNotificationCount } from "@/lib/notification-count";

type HeaderUserMenuProps = {
  pathname: string;
  mobile?: boolean;
  onNavigate?: () => void;
};

const NOTIFICATION_POLL_INTERVAL_MS = 5 * 60_000;
const NOTIFICATION_FOCUS_REFRESH_GAP_MS = 60_000;

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
    let hasUser = false;
    let lastNotificationRefreshAt = 0;
    let notificationGeneration = 0;
    let userGeneration = 0;

    async function loadUnreadCount() {
      const generation = ++notificationGeneration;
      lastNotificationRefreshAt = Date.now();
      try {
        const response = await fetch("/api/notifications?limit=1", {
          cache: "no-store",
        });
        if (!mounted || generation !== notificationGeneration || !hasUser) return;
        if (!response.ok) {
          if (response.status === 401) setUnreadCount(0);
          return;
        }
        const body = (await response.json()) as { unread_count?: number };
        if (mounted && generation === notificationGeneration && hasUser && isNotificationCount(body?.unread_count)) {
          setUnreadCount(body.unread_count);
          publishNotificationCount(body.unread_count);
        }
      } catch {
        // Keep the last known count during temporary network failures.
      }
    }

    async function loadUser() {
      const generation = ++userGeneration;
      notificationGeneration += 1;
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!mounted || generation !== userGeneration) return;

        if (!user) {
          hasUser = false;
          setNickname(null);
          setEmail(null);
          setUnreadCount(0);
          setIsAdmin(false);
          return;
        }

        hasUser = true;
        setEmail(user.email ?? null);

        const [profileResult, notiResult, adminResult] = await Promise.allSettled([
          supabase.from("profiles").select("nickname").eq("user_id", user.id).maybeSingle(),
          loadUnreadCount(),
          fetch("/api/admin/me", { cache: "no-store" }),
        ]);

        if (!mounted || generation !== userGeneration) return;

        if (profileResult.status === "fulfilled") {
          setNickname(profileResult.value.data?.nickname ?? null);
        } else {
          setNickname(null);
        }

        if (notiResult.status === "rejected") console.error("[HeaderUserMenu] notification refresh failed");

        if (adminResult.status === "fulfilled" && adminResult.value.ok) {
          const admin = (await adminResult.value.json()) as { isAdmin?: boolean };
          if (!mounted || generation !== userGeneration) return;
          setIsAdmin(Boolean(admin.isAdmin));
        } else {
          setIsAdmin(false);
        }
      } finally {
        if (mounted && generation === userGeneration) setAuthChecked(true);
      }
    }

    void loadUser();
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") clearDatingDraft();
      void loadUser();
      router.refresh();
    });
    const refreshVisibleNotifications = () => {
      if (
        hasUser &&
        document.visibilityState === "visible" &&
        Date.now() - lastNotificationRefreshAt >= NOTIFICATION_FOCUS_REFRESH_GAP_MS
      ) {
        void loadUnreadCount();
      }
    };
    const syncNotificationCount = (event: Event) => {
      const nextCount = (event as CustomEvent<number>).detail;
      if (hasUser && isNotificationCount(nextCount)) {
        notificationGeneration += 1;
        setUnreadCount(nextCount);
      }
    };
    const invalidateCount = () => {
      notificationGeneration += 1;
      if (hasUser) void loadUnreadCount();
    };
    const intervalId = mobile
      ? null
      : window.setInterval(refreshVisibleNotifications, NOTIFICATION_POLL_INTERVAL_MS);
    if (!mobile) {
      window.addEventListener("focus", refreshVisibleNotifications);
      document.addEventListener("visibilitychange", refreshVisibleNotifications);
    }
    window.addEventListener(NOTIFICATION_COUNT_EVENT, syncNotificationCount);
    window.addEventListener(NOTIFICATION_COUNT_INVALIDATED_EVENT, invalidateCount);

    return () => {
      mounted = false;
      if (intervalId !== null) window.clearInterval(intervalId);
      if (!mobile) {
        window.removeEventListener("focus", refreshVisibleNotifications);
        document.removeEventListener("visibilitychange", refreshVisibleNotifications);
      }
      window.removeEventListener(NOTIFICATION_COUNT_EVENT, syncNotificationCount);
      window.removeEventListener(NOTIFICATION_COUNT_INVALIDATED_EVENT, invalidateCount);
      sub.subscription.unsubscribe();
    };
  }, [mobile, router, supabase]);

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
