import { createServerClient } from "@supabase/ssr";
import type { EmailOtpType } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

function safeNextPath(input: string | null): string {
  if (!input || !input.startsWith("/")) return "/mypage";
  if (input.startsWith("//")) return "/mypage";
  return input;
}

function errorResponse(message: string, details?: string) {
  const debug = details ? `${message}: ${details}` : message;
  const lower = debug.toLowerCase();
  const hint = lower.includes("invalid redirect url")
    ? "Hint: Add exact callback URL to Supabase Auth -> URL Configuration."
    : lower.includes("code verifier") || lower.includes("pkce")
    ? "Hint: This usually means PKCE flow/session cookie mismatch during callback."
    : "Hint: Check Supabase redirect URL and PKCE settings.";
  console.error("[auth/callback] OAuth callback failed:", debug);

  return new NextResponse(
    `OAuth callback failed.\n\n${debug}\n\n${hint}`,
    { status: 500, headers: { "content-type": "text/plain; charset=utf-8" } }
  );
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const otpType = url.searchParams.get("type") as EmailOtpType | null;
  const next = safeNextPath(url.searchParams.get("next"));

  const response = NextResponse.redirect(new URL(next, url.origin));

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

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      const details = `${error.name ?? "AuthApiError"}: ${error.message}`;
      return errorResponse("exchangeCodeForSession failed", details);
    }
  } else if (tokenHash && otpType) {
    const { error } = await supabase.auth.verifyOtp({
      type: otpType,
      token_hash: tokenHash,
    });
    if (error) {
      const details = `${error.name ?? "AuthApiError"}: ${error.message}`;
      return errorResponse("verifyOtp failed", details);
    }
  } else {
    return errorResponse("Missing code parameter");
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    const details = userError?.message ?? "No user in session after exchange";
    return errorResponse("Session verification failed", details);
  }

  return response;
}
