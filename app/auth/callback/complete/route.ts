import { createServerClient } from "@supabase/ssr";
import type { EmailOtpType } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

function safeNextPath(input: string | null): string {
  if (!input || !input.startsWith("/")) return "/mypage";
  if (input.startsWith("//")) return "/mypage";
  return input;
}

function buildLoginRedirect(
  requestUrl: URL,
  next: string,
  opts: {
    error: string;
    errorCode?: string | null;
    errorDescription?: string | null;
  }
) {
  const loginUrl = new URL("/login", requestUrl.origin);
  loginUrl.searchParams.set("next", next);
  loginUrl.searchParams.set("redirect", next);
  loginUrl.searchParams.set("error", opts.error);
  if (opts.errorCode) loginUrl.searchParams.set("error_code", opts.errorCode);
  if (opts.errorDescription) loginUrl.searchParams.set("error_description", opts.errorDescription);
  return NextResponse.redirect(loginUrl);
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const otpType = url.searchParams.get("type") as EmailOtpType | null;
  const accessToken = url.searchParams.get("access_token");
  const refreshToken = url.searchParams.get("refresh_token");
  const callbackError = url.searchParams.get("error");
  const callbackErrorCode = url.searchParams.get("error_code");
  const callbackErrorDescription = url.searchParams.get("error_description");
  const next = safeNextPath(url.searchParams.get("next"));

  const logContext = {
    path: url.pathname,
    next,
    type: otpType,
    hasCode: Boolean(code),
    hasTokenHash: Boolean(tokenHash),
    hasAccessToken: Boolean(accessToken),
    hasRefreshToken: Boolean(refreshToken),
    hasError: Boolean(callbackError),
    hasErrorCode: Boolean(callbackErrorCode),
    queryKeys: [...new Set(Array.from(url.searchParams.keys()))],
  };
  console.info("[auth/callback/complete] incoming", logContext);

  if (callbackError || callbackErrorCode) {
    const reason = `${callbackError ?? "callback_error"}/${callbackErrorCode ?? ""}`;
    console.error("[auth/callback/complete] callback provider error", {
      ...logContext,
      reason,
    });
    return buildLoginRedirect(url, next, {
      error: callbackError ?? "access_denied",
      errorCode: callbackErrorCode,
      errorDescription: callbackErrorDescription,
    });
  }

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
      console.error("[auth/callback/complete] exchangeCodeForSession failed", {
        ...logContext,
        reason: error.message,
      });
      return buildLoginRedirect(url, next, {
        error: "exchange_failed",
        errorCode: "oauth_code_exchange_failed",
        errorDescription: error.message,
      });
    }
  } else if (tokenHash && otpType) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: otpType,
    });
    if (error) {
      console.error("[auth/callback/complete] verifyOtp failed", {
        ...logContext,
        reason: error.message,
      });
      return buildLoginRedirect(url, next, {
        error: "verify_otp_failed",
        errorCode: "otp_verify_failed",
        errorDescription: error.message,
      });
    }
  } else if (accessToken) {
    const { error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken ?? "",
    });
    if (error) {
      console.error("[auth/callback/complete] setSession failed", {
        ...logContext,
        reason: error.message,
      });
      return buildLoginRedirect(url, next, {
        error: "set_session_failed",
        errorCode: "set_session_failed",
        errorDescription: error.message,
      });
    }
  } else {
    console.error("[auth/callback/complete] missing callback params", {
      ...logContext,
      reason: "No supported auth params",
    });
    return buildLoginRedirect(url, next, {
      error: "missing_callback_params",
      errorCode: "missing_callback_params",
      errorDescription: "링크가 만료됐거나 잘못되었습니다.",
    });
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    const reason = userError?.message ?? "no_user_after_session";
    console.error("[auth/callback/complete] session verification failed", {
      ...logContext,
      reason,
    });
    return buildLoginRedirect(url, next, {
      error: "session_verification_failed",
      errorCode: "session_verification_failed",
      errorDescription: reason,
    });
  }

  console.info("[auth/callback/complete] success", {
    ...logContext,
    userId: user.id,
  });

  return response;
}
