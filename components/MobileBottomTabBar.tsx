"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

type TabItem = {
  href: string;
  label: string;
  icon: React.ReactNode;
};

type ChatBadgeState = {
  unreadCount: number;
  availableCount: number;
};

const TABS: TabItem[] = [
  {
    href: "/community/dating/cards",
    label: "홈",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className="h-5 w-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-9.5Z" />
      </svg>
    ),
  },
  {
    href: "/chat",
    label: "채팅",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className="h-5 w-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M7 10h10M7 14h6M6 20l-2 1V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8l-2 2Z" />
      </svg>
    ),
  },
  {
    href: "/dating/1on1",
    label: "1:1",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className="h-5 w-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM3 20a5 5 0 0 1 10 0M11 20a5 5 0 0 1 10 0" />
      </svg>
    ),
  },
  {
    href: "/community",
    label: "커뮤니티",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className="h-5 w-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M4 12h10M4 17h7" />
      </svg>
    ),
  },
  {
    href: "/mypage",
    label: "마이",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className="h-5 w-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M20 21v-1.5A4.5 4.5 0 0 0 15.5 15h-7A4.5 4.5 0 0 0 4 19.5V21M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" />
      </svg>
    ),
  },
];

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function MobileBottomTabBar() {
  const pathname = usePathname();
  const [chatBadge, setChatBadge] = useState<ChatBadgeState>({ unreadCount: 0, availableCount: 0 });

  const loadChatBadge = useCallback(async () => {
    try {
      const [inboxRes, availableRes] = await Promise.all([
        fetch("/api/dating/chat/inbox", { cache: "no-store" }),
        fetch("/api/dating/chat/available", { cache: "no-store" }),
      ]);

      if (inboxRes.status === 401 || availableRes.status === 401) {
        setChatBadge({ unreadCount: 0, availableCount: 0 });
        return;
      }

      const inboxBody = (await inboxRes.json().catch(() => ({}))) as { unreadCount?: number };
      const availableBody = (await availableRes.json().catch(() => ({}))) as {
        items?: Array<{ thread_id?: string | null }>;
      };

      const unreadCount = Math.max(0, Number(inboxBody.unreadCount ?? 0));
      const availableCount = Array.isArray(availableBody.items)
        ? availableBody.items.filter((item) => !item.thread_id).length
        : 0;

      setChatBadge({ unreadCount, availableCount });
    } catch {
      setChatBadge({ unreadCount: 0, availableCount: 0 });
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadChatBadge();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadChatBadge, pathname]);

  useEffect(() => {
    const onFocus = () => {
      void loadChatBadge();
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [loadChatBadge]);

  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-black/5 bg-white/95 shadow-[0_-10px_30px_rgba(15,23,42,0.06)] backdrop-blur-md md:hidden">
      <div className="grid h-[76px] grid-cols-5 px-2 pb-[max(10px,env(safe-area-inset-bottom))] pt-1.5">
        {TABS.map((tab) => {
          const active = isActive(pathname, tab.href);
          const chatBadgeCount =
            tab.href === "/chat" ? chatBadge.unreadCount + chatBadge.availableCount : 0;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`relative flex flex-col items-center justify-center gap-1 rounded-2xl text-[11px] font-semibold transition ${
                active ? "text-rose-600" : "text-neutral-400 hover:text-neutral-700"
              }`}
            >
              {active ? <span className="absolute inset-x-4 top-0 h-1 rounded-full bg-rose-500" aria-hidden /> : null}
              <span
                className={`inline-flex h-9 w-9 items-center justify-center rounded-2xl transition ${
                  active ? "bg-rose-50 text-rose-600" : "bg-transparent"
                }`}
              >
                {chatBadgeCount > 0 ? (
                  <span className="absolute right-3 top-2 inline-flex min-w-[18px] items-center justify-center rounded-full bg-rose-600 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white shadow-sm">
                    {chatBadgeCount > 99 ? "99+" : chatBadgeCount}
                  </span>
                ) : null}
                {tab.icon}
              </span>
              <span>{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
