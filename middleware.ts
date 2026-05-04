import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { isEmailConfirmed } from "@/lib/auth-confirmed";
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
  const isAdminPath = pathname.startsWith("/admin");
  const isAdminApiPath = pathname.startsWith("/api/admin");
  const isLegacyAdminApiPath =
    pathname === "/api/dating/1on1/matches/admin" ||
    pathname.startsWith("/api/dating/cards/admin/");
  const isAdminProtectedPath = isAdminPath || isAdminApiPath || isLegacyAdminApiPath;
  const isAdminUnlockPage = pathname === "/admin/unlock";
  const isAdminUnlockApi = pathname === "/api/admin/panel-unlock";
  const isAdminMeApi = pathname === "/api/admin/me";
  const isOpenCardsRoute =
    pathname === "/community/dating/cards" ||
    pathname.startsWith("/community/dating/cards/");

  if (isOpenCardsRoute) {
    return NextResponse.next({ request });
  }

  const response = NextResponse.next({ request });

  const isBodyBattlePagePath = pathname === "/bodybattle" || pathname.startsWith("/bodybattle/");
  const isBodyBattleApiPath = pathname.startsWith("/api/bodybattle") || pathname.startsWith("/api/admin/bodybattle");
  const isBodyBattlePath = isBodyBattlePagePath || isBodyBattleApiPath;
  if (isBodyBattlePath) {
    response.headers.set("Cache-Control", "no-store, max-age=0, s-maxage=0, must-revalidate");
    response.headers.set("Pragma", "no-cache");
    response.headers.set("Expires", "0");
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isAdmin = !!user?.email && getAdminEmails().includes(user.email.toLowerCase());
  const confirmed = isEmailConfirmed(user);

  const protectedPrefixes = ["/community", "/mypage", "/cert/request", "/admin", "/certify", "/dating"];
  const isProtected = protectedPrefixes.some((prefix) => pathname.startsWith(prefix));
  const isVerifyPage = pathname.startsWith("/verify-email");

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
      return NextResponse.json({ error: "Login is required." }, { status: 401 });
    }
    const url = new URL("/login", request.url);
    const original = pathname + request.nextUrl.search;
    url.searchParams.set("next", original);
    url.searchParams.set("redirect", original);
    return NextResponse.redirect(url);
  }

  if (isProtected && user && !confirmed && !isVerifyPage) {
    const url = new URL("/verify-email", request.url);
    url.searchParams.set("next", pathname + request.nextUrl.search);
    return NextResponse.redirect(url);
  }

  if (isAdminProtectedPath && !isAdmin) {
    if (isApiRoute) {
      return NextResponse.json({ error: "Admin only." }, { status: 403 });
    }
    return NextResponse.redirect(new URL("/", request.url));
  }

  if (
    isAdminProtectedPath &&
    isAdmin &&
    isAdminPanelLockEnabled() &&
    !isAdminUnlockPage &&
    !isAdminUnlockApi &&
    !isAdminMeApi
  ) {
    const unlocked = await isAdminPanelUnlocked(user.id, request.cookies.get(getAdminPanelCookieName())?.value);
    if (!unlocked) {
      if (isApiRoute) {
        return NextResponse.json(
          {
            error: "관리자 2차 확인이 필요합니다. 관리탭 상단의 '관리자 잠금 해제'를 눌러 비밀번호를 입력해주세요.",
            unlockUrl: "/admin/unlock",
          },
          { status: 423 }
        );
      }
      const url = new URL("/admin/unlock", request.url);
      url.searchParams.set("next", pathname + request.nextUrl.search);
      return NextResponse.redirect(url);
    }
  }

  if (isBodyBattlePath && !isAdmin) {
    if (isApiRoute) {
      return NextResponse.json({ ok: false, message: "Admin only." }, { status: 403 });
    }
    return NextResponse.redirect(new URL("/", request.url));
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
    "/bodybattle/:path*",
    "/api/bodybattle/:path*",
    "/api/admin/bodybattle/:path*",
    "/api/admin/:path*",
    "/api/dating/1on1/matches/admin",
    "/api/dating/cards/admin/:path*",
  ],
};
