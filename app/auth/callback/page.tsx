"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { isEmailConfirmed } from "@/lib/auth-confirmed";

const STORED_EMAIL_KEY = "recent_login_email";
const CANONICAL_SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://helchang.com";
const IN_APP_UA_PATTERNS = ["kakaotalk", "instagram", "naver", "fban", "fbav", "line"];

type CallbackState = {
  next: string;
  code: string | null;
  tokenHash: string | null;
  otpType: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  error: string | null;
  errorCode: string | null;
  errorDescription: string | null;
};

type ViewState =
  | { kind: "processing" }
  | { kind: "success" }
  | { kind: "failure"; detail: string };

function safeNextPath(input: string | null): string {
  if (!input || !input.startsWith("/")) return "/";
  if (input.startsWith("//")) return "/";
  return input;
}

function isInAppBrowser(ua: string): boolean {
  const lowered = ua.toLowerCase();
  return IN_APP_UA_PATTERNS.some((token) => lowered.includes(token));
}

function parseStateFromLocation(): CallbackState {
  const merged = new URLSearchParams(window.location.search);
  const hashRaw = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;

  if (hashRaw) {
    const hashParams = new URLSearchParams(hashRaw);
    for (const [key, value] of hashParams.entries()) {
      if (!merged.has(key) && value) merged.set(key, value);
    }
  }

  return {
    next: safeNextPath(merged.get("next")),
    code: merged.get("code"),
    tokenHash: merged.get("token_hash"),
    otpType: merged.get("type"),
    accessToken: merged.get("access_token"),
    refreshToken: merged.get("refresh_token"),
    error: merged.get("error"),
    errorCode: merged.get("error_code"),
    errorDescription: merged.get("error_description"),
  };
}

function buildCanonicalCallbackUrl(next: string): string {
  const url = new URL("/auth/callback", CANONICAL_SITE_URL);
  url.searchParams.set("next", safeNextPath(next));
  return url.toString();
}

export default function AuthCallbackPage() {
  const router = useRouter();
  const [state, setState] = useState<CallbackState | null>(null);
  const [viewState, setViewState] = useState<ViewState>({ kind: "processing" });
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [inAppBrowser, setInAppBrowser] = useState(false);

  useEffect(() => {
    const parsed = parseStateFromLocation();
    setState(parsed);
    setInAppBrowser(isInAppBrowser(navigator.userAgent));

    const stored = window.localStorage.getItem(STORED_EMAIL_KEY) ?? "";
    if (stored) setEmail(stored);

    (async () => {
      const supabase = createClient();
      const next = parsed.next || "/";

      const finalizeSuccess = async () => {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (session && next !== "/") {
          router.replace(next);
          return;
        }

        setViewState({ kind: "success" });
      };

      const hasConfirmedUser = async () => {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        return Boolean(user && isEmailConfirmed(user));
      };

      // (B) Session-first
      const {
        data: { session: initialSession },
      } = await supabase.auth.getSession();
      if (initialSession) {
        await finalizeSuccess();
        return;
      }

      // (C) If already confirmed, treat as success even if callback error params exist.
      if (await hasConfirmedUser()) {
        setViewState({ kind: "success" });
        return;
      }

      // (D) code
      if (parsed.code) {
        await supabase.auth.exchangeCodeForSession(parsed.code);
        const {
          data: { session: afterCodeSession },
        } = await supabase.auth.getSession();
        if (afterCodeSession || (await hasConfirmedUser())) {
          await finalizeSuccess();
          return;
        }
      }

      // (D) token_hash + type
      if (parsed.tokenHash && parsed.otpType) {
        await supabase.auth.verifyOtp({
          token_hash: parsed.tokenHash,
          type: parsed.otpType as EmailOtpType,
        });
        const {
          data: { session: afterOtpSession },
        } = await supabase.auth.getSession();
        if (afterOtpSession || (await hasConfirmedUser())) {
          await finalizeSuccess();
          return;
        }
      }

      // (D) access_token + refresh_token
      if (parsed.accessToken && parsed.refreshToken) {
        await supabase.auth.setSession({
          access_token: parsed.accessToken,
          refresh_token: parsed.refreshToken,
        });
        const {
          data: { session: afterTokenSession },
        } = await supabase.auth.getSession();
        if (afterTokenSession || (await hasConfirmedUser())) {
          await finalizeSuccess();
          return;
        }
      }

      // Final guard for delayed hydration.
      const {
        data: { session: finalSession },
      } = await supabase.auth.getSession();
      if (finalSession || (await hasConfirmedUser())) {
        await finalizeSuccess();
        return;
      }

      // (E) True failure only.
      setViewState({
        kind: "failure",
        detail: parsed.errorCode?.toLowerCase() ?? parsed.error?.toLowerCase() ?? "",
      });
    })();
  }, [router]);

  const errorMessage = useMemo(() => {
    if (!state) return "";
    const code = state.errorCode?.toLowerCase() ?? state.error?.toLowerCase() ?? "";

    if (code === "otp_expired") return "링크 유효시간이 지나 다시 인증이 필요합니다.";
    if (code === "access_denied") return "링크를 확인할 수 없었습니다. 다시 인증 메일을 보내드릴게요.";
    if (code === "flow_state_missing") return "세션 정보가 사라졌습니다. 같은 브라우저에서 다시 시도해 주세요.";
    if (state.errorDescription) return state.errorDescription;
    if (state.error || state.errorCode) return "로그인 처리 중 오류가 발생했습니다.";
    return "인증 링크를 확인할 수 없습니다.";
  }, [state]);

  const handleResend = async () => {
    const normalized = email.trim().toLowerCase();
    if (!normalized) {
      setMessage("이메일을 입력해 주세요.");
      return;
    }

    setSending(true);
    setMessage(null);

    try {
      const supabase = createClient();
      const callbackUrl = buildCanonicalCallbackUrl(state?.next ?? "/");
      const isSignupLink = state?.otpType === "signup";
      const { error } = isSignupLink
        ? await supabase.auth.resend({
            type: "signup",
            email: normalized,
            options: {
              emailRedirectTo: callbackUrl,
            },
          })
        : await supabase.auth.signInWithOtp({
            email: normalized,
            options: {
              emailRedirectTo: callbackUrl,
            },
          });

      if (error) {
        setMessage(error.message);
        return;
      }

      window.localStorage.setItem(STORED_EMAIL_KEY, normalized);
      setMessage(isSignupLink ? "인증 메일을 다시 보냈습니다. 메일함을 확인해 주세요." : "메일함을 확인해 로그인 링크를 클릭하세요.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "로그인 링크 재발송에 실패했습니다.");
    } finally {
      setSending(false);
    }
  };

  const handleOpenExternal = () => {
    const href = window.location.href;
    const ua = navigator.userAgent.toLowerCase();

    if (ua.includes("android")) {
      const withoutProtocol = href.replace(/^https?:\/\//, "");
      window.location.href = `intent://${withoutProtocol}#Intent;scheme=https;package=com.android.chrome;end`;
      return;
    }

    window.open(href, "_blank", "noopener,noreferrer");
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setMessage("현재 링크를 복사했습니다.");
    } catch {
      setMessage("링크 복사에 실패했습니다. 주소창에서 직접 복사해 주세요.");
    }
  };

  if (!state || viewState.kind === "processing") {
    return (
      <main className="max-w-sm mx-auto px-4 py-20">
        <p className="text-sm text-neutral-500 text-center">로그인 처리 중입니다...</p>
      </main>
    );
  }

  if (viewState.kind === "success") {
    return (
      <main className="max-w-sm mx-auto px-4 py-16">
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-4">
          <h1 className="text-base font-semibold text-emerald-900">이메일 인증 완료!</h1>
          <p className="mt-1 text-sm text-emerald-800">이제 로그인해서 계속 진행해 주세요.</p>

          <div className="mt-4 grid grid-cols-1 gap-2">
            <Link
              href={`/login?next=${encodeURIComponent(state.next || "/")}`}
              className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-emerald-600 text-white text-sm font-medium"
            >
              로그인하러 가기
            </Link>
            <Link
              href="/"
              className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-emerald-300 bg-white text-emerald-900 text-sm font-medium"
            >
              홈으로
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const isExpired = viewState.detail === "otp_expired";

  return (
    <main className="max-w-sm mx-auto px-4 py-16">
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
        <h1 className="text-base font-semibold text-amber-900">인증 링크가 만료되었어요</h1>
        <p className="mt-1 text-sm text-amber-800">{isExpired ? "다시 링크를 보내드릴게요." : errorMessage}</p>
        {inAppBrowser && (
          <p className="mt-1 text-xs text-amber-800">인앱 브라우저에서는 실패할 수 있어요. Safari/Chrome으로 열어주세요.</p>
        )}

        <div className="mt-3 space-y-2">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            className="w-full min-h-[44px] rounded-lg border border-amber-300 bg-white px-3 text-sm"
          />
          <button
            type="button"
            onClick={handleResend}
            disabled={sending}
            className="w-full min-h-[44px] rounded-lg bg-amber-600 text-white text-sm font-medium disabled:opacity-50"
          >
            {sending ? "재전송 중..." : "다시 링크 보내기"}
          </button>
          {message && <p className="text-xs text-amber-900">{message}</p>}
        </div>

        <div className="mt-3 grid grid-cols-1 gap-2">
          <Link
            href={`/login?next=${encodeURIComponent(state.next || "/")}`}
            className="inline-flex min-h-[42px] items-center justify-center rounded-lg bg-white text-amber-900 border border-amber-300 text-sm font-medium"
          >
            로그인하러 가기
          </Link>
          {inAppBrowser && (
            <>
              <button
                type="button"
                onClick={handleOpenExternal}
                className="min-h-[42px] rounded-lg bg-amber-600 text-white text-sm font-medium"
              >
                Chrome/Safari로 열기
              </button>
              <button
                type="button"
                onClick={handleCopyLink}
                className="min-h-[42px] rounded-lg border border-amber-300 bg-white text-amber-900 text-sm font-medium"
              >
                링크 복사
              </button>
            </>
          )}
          <Link
            href="/"
            className="inline-flex min-h-[42px] items-center justify-center rounded-lg border border-amber-300 bg-white text-amber-900 text-sm font-medium"
          >
            홈으로
          </Link>
        </div>
      </div>
    </main>
  );
}
