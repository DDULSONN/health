import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { isEmailConfirmed } from "@/lib/auth-confirmed";

function getAdminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const isDatingPublicRoute =
    pathname === "/community/dating" ||
    pathname.startsWith("/community/dating/") ||
    pathname.startsWith("/community/dating/cards/");

  if (isDatingPublicRoute) {
    return NextResponse.next({ request });
  }

  const response = NextResponse.next({ request });

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
  const isProtected =
    protectedPrefixes.some((prefix) => pathname.startsWith(prefix)) && !isDatingPublicRoute;
  const isVerifyPage = pathname.startsWith("/verify-email");

  if (isProtected && !user) {
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

  if (pathname.startsWith("/admin") && !isAdmin) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|api/og|api/share-card).*)"],
};
