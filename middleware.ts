import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { isEmailConfirmed } from "@/lib/auth-confirmed";
import { filterMalformedSessionCookies } from "@/lib/supabase/session-cookies";
import { readOnboardingUser } from "@/lib/onboarding-user";
import type { User } from "@supabase/supabase-js";
import {
  getAdminPanelCookieName,
  isAdminPanelLockEnabled,
  isAdminPanelUnlocked,
} from "@/lib/admin-panel-lock";

function getAdminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const isApiRoute = pathname.startsWith("/api/");
  const isBodyBattlePagePath = pathname === "/bodybattle" || pathname.startsWith("/bodybattle/");
  const isBodyBattleApiPath = pathname.startsWith("/api/bodybattle") || pathname.startsWith("/api/admin/bodybattle");
  const isBodyBattleCronPath = pathname === "/api/cron/bodybattle-season";
  const isBodyBattlePath = isBodyBattlePagePath || isBodyBattleApiPath || isBodyBattleCronPath;

  if (isBodyBattlePath) {
    if (isApiRoute) {
      return NextResponse.json({ ok: false, message: "BodyBattle is no longer available." }, { status: 410 });
    }
    return NextResponse.redirect(new URL("/", request.url));
  }

  const isAdminPath = pathname.startsWith("/admin");
  const isAdminApiPath = pathname.startsWith("/api/admin");
  const isLegacyAdminApiPath =
    pathname === "/api/dating/1on1/matches/admin" ||
    pathname.startsWith("/api/dating/cards/admin/");
  const isDatingOnboarding = pathname === "/onboarding/dating";
  const isAdminProtectedPath = isAdminPath || isAdminApiPath || isLegacyAdminApiPath;
  const isAdminUnlockPage = pathname === "/admin/unlock";
  const isAdminUnlockApi = pathname === "/api/admin/panel-unlock";
  const isAdminMeApi = pathname === "/api/admin/me";
  const isOpenCardsRoute =
    pathname === "/community/dating/cards" ||
    pathname.startsWith("/community/dating/cards/");
  const isLocalOneOnOnePreview =
    process.env.NODE_ENV === "development" &&
    pathname === "/dating/1on1" &&
    request.nextUrl.searchParams.get("preview") === "1";

  if (isLocalOneOnOnePreview) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const withSessionCookies = (nextResponse: NextResponse) => {
    // Auth redirects must not outlive the session that produced them.
    nextResponse.headers.set("Cache-Control", "private, no-store, max-age=0");
    response.cookies.getAll().forEach((cookie) => {
      nextResponse.cookies.set(cookie);
    });
    return nextResponse;
  };

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    {
      cookies: {
        getAll() {
          return filterMalformedSessionCookies(request.cookies.getAll(), process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
        },
        setAll(cookiesToSet) {
          // The refreshed session must be visible to Server Components and route
          // handlers during this same request, not only on the browser's next request.
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  let user: User | null = null;
  let authUnavailable = false;
  try {
    user = await readOnboardingUser(supabase.auth, { signal: request.signal, timeoutMs: 4000, retryDelayMs: 150 });
  } catch {
    // A timeout, 429 or upstream failure is not proof of logout. Never authorize
    // from an unverified cookie, and never clear it or redirect to login here.
    authUnavailable = true;
    console.warn("[middleware] auth verification unavailable", { path: pathname });
  }

  const isAdmin = !!user?.email && getAdminEmails().includes(user.email.toLowerCase());
  const confirmed = isEmailConfirmed(user);

  const protectedPrefixes = ["/community", "/mypage", "/cert/request", "/admin", "/certify", "/dating"];
  const isProtected =
    (protectedPrefixes.some((prefix) => pathname.startsWith(prefix)) && !isOpenCardsRoute) || isDatingOnboarding;
  const isVerifyPage = pathname.startsWith("/verify-email");
  const isBanProtectedPage =
    pathname.startsWith("/community") ||
    pathname.startsWith("/dating") ||
    pathname.startsWith("/chat") ||
    pathname.startsWith("/notifications") ||
    pathname.startsWith("/tools") ||
    pathname.startsWith("/certify") ||
    isDatingOnboarding;
  const isBanProtectedApi =
    pathname.startsWith("/api/dating/") ||
    pathname.startsWith("/api/community/") ||
    pathname.startsWith("/api/posts") ||
    pathname.startsWith("/api/comments") ||
    pathname.startsWith("/api/notifications");

  if (authUnavailable && (isProtected || isAdminProtectedPath || isBanProtectedApi)) {
    const headers = { "Cache-Control": "private, no-store, max-age=0", "Retry-After": "3", "X-Robots-Tag": "noindex" };
    if (isApiRoute) {
      return NextResponse.json({ error: "로그인 상태 확인이 지연되고 있어요. 잠시 후 다시 확인해 주세요.", code: "AUTH_TEMPORARILY_UNAVAILABLE" }, { status: 503, headers });
    }
    return new NextResponse(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>로그인 상태 확인 | 짐툴</title></head><body style="margin:0;background:#fafafa;font-family:system-ui,sans-serif;color:#262626"><main style="max-width:400px;margin:18vh auto;padding:24px;line-height:1.7"><h1 style="font-size:20px">잠시 연결이 지연되고 있어요</h1><p>로그인 상태를 확인하지 못했어요.<br>프로필이나 매칭 정보는 변경되지 않았어요.</p><a href="" style="display:inline-block;padding:12px 20px;border-radius:12px;background:#e11d48;color:white;text-decoration:none">다시 확인</a><p><a href="/mypage" style="color:#525252">마이페이지로</a></p></main></body></html>`, { status: 503, headers: { ...headers, "Content-Type": "text/html; charset=utf-8" } });
  }

  if (user && !isAdmin && (isBanProtectedPage || isBanProtectedApi)) {
    const { data: accountState, error: accountStateError } = await supabase
      .from("profiles")
      .select("is_banned,banned_reason")
      .eq("user_id", user.id)
      .maybeSingle();

    if (accountStateError) {
      console.error("[middleware] failed to check banned account", accountStateError);
    } else if (accountState?.is_banned) {
      if (isApiRoute) {
        return withSessionCookies(NextResponse.json(
          {
            error: accountState.banned_reason?.trim() || "이 계정은 관리자에 의해 이용이 제한되었습니다.",
            error_code: "user_banned",
          },
          { status: 403 }
        ));
      }
      const restrictedUrl = new URL("/mypage", request.url);
      restrictedUrl.searchParams.set("account", "restricted");
      return withSessionCookies(NextResponse.redirect(restrictedUrl));
    }
  }

  if (isBodyBattlePath && !user) {
    if (isApiRoute) {
      return NextResponse.json({ ok: false, message: "Login is required." }, { status: 401 });
    }
    const url = new URL("/login", request.url);
    const original = pathname + request.nextUrl.search;
    url.searchParams.set("next", original);
    url.searchParams.set("redirect", original);
    return NextResponse.redirect(url);
  }

  if ((isAdminProtectedPath || isProtected) && !user) {
    if (isAdminApiPath || isLegacyAdminApiPath) {
      return withSessionCookies(NextResponse.json({ error: "Login is required." }, { status: 401 }));
    }
    const url = new URL("/login", request.url);
    const original = pathname + request.nextUrl.search;
    url.searchParams.set("next", original);
    url.searchParams.set("redirect", original);
    return withSessionCookies(NextResponse.redirect(url));
  }

  if (isProtected && user && !confirmed && !isVerifyPage) {
    const url = new URL("/verify-email", request.url);
    url.searchParams.set("next", pathname + request.nextUrl.search);
    return withSessionCookies(NextResponse.redirect(url));
  }

  if (isAdminProtectedPath && !isAdmin) {
    if (isApiRoute) {
      return withSessionCookies(NextResponse.json({ error: "Admin only." }, { status: 403 }));
    }
    return withSessionCookies(NextResponse.redirect(new URL("/", request.url)));
  }

  if (
    isAdminProtectedPath &&
    isAdmin &&
    user &&
    isAdminPanelLockEnabled() &&
    !isAdminUnlockPage &&
    !isAdminUnlockApi &&
    !isAdminMeApi
  ) {
    const unlocked = await isAdminPanelUnlocked(user.id, request.cookies.get(getAdminPanelCookieName())?.value);
    if (!unlocked) {
      if (isApiRoute) {
        return withSessionCookies(NextResponse.json(
          {
            error: "관리자 2차 확인이 필요합니다. 관리탭 상단의 '관리자 잠금 해제'를 눌러 비밀번호를 입력해주세요.",
            unlockUrl: "/admin/unlock",
          },
          { status: 423 }
        ));
      }
      const url = new URL("/admin/unlock", request.url);
      url.searchParams.set("next", pathname + request.nextUrl.search);
      return withSessionCookies(NextResponse.redirect(url));
    }
  }

  if (isBodyBattlePath && !isAdmin) {
    if (isApiRoute) {
      return withSessionCookies(NextResponse.json({ ok: false, message: "Admin only." }, { status: 403 }));
    }
    return withSessionCookies(NextResponse.redirect(new URL("/", request.url)));
  }

  return response;
}

export const config = {
  matcher: [
    "/mypage/:path*",
    "/cert/request/:path*",
    "/admin/:path*",
    "/certify/:path*",
    "/dating/:path*",
    "/community/:path*",
    "/chat/:path*",
    "/notifications/:path*",
    "/tools/:path*",
    "/bodybattle/:path*",
    "/api/dating/:path*",
    "/api/community/:path*",
    "/api/posts/:path*",
    "/api/comments/:path*",
    "/api/notifications/:path*",
    "/api/bodybattle/:path*",
    "/api/admin/bodybattle/:path*",
    "/api/cron/bodybattle-season",
    "/api/admin/:path*",
    "/api/dating/1on1/matches/admin",
    "/api/dating/cards/admin/:path*",
    "/onboarding/dating",
  ],
};
