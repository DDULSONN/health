"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const STORED_EMAIL_KEY = "recent_login_email";
const CANONICAL_SITE_URL = "https://helchang.com";
const IN_APP_UA_PATTERNS = ["kakaotalk", "instagram", "naver", "fban", "fbav"];
const FORWARDED_KEYS = [
  "code",
  "token_hash",
  "type",
  "access_token",
  "refresh_token",
  "error",
  "error_code",
  "error_description",
  "next",
] as const;

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

function safeNextPath(input: string | null): string {
  if (!input || !input.startsWith("/")) return "/";
  if (input.startsWith("//")) return "/";
  return input;
}

function isInAppBrowser(ua: string): boolean {
  const lowered = ua.toLowerCase();
  return IN_APP_UA_PATTERNS.some((token) => lowered.includes(token));
}

function buildCanonicalCallbackUrl(next: string): string {
  const url = new URL("/auth/callback", CANONICAL_SITE_URL);
  url.searchParams.set("next", safeNextPath(next));
  return url.toString();
}

function parseCallbackState(): CallbackState {
  const merged = new URLSearchParams(window.location.search);
  const hashRaw = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;

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

export default function AuthCallbackPage() {
  const router = useRouter();
  const [state, setState] = useState<CallbackState | null>(null);
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [inAppBrowser, setInAppBrowser] = useState(false);

  useEffect(() => {
    setInAppBrowser(isInAppBrowser(navigator.userAgent));
    const parsed = parseCallbackState();
    setState(parsed);

    const stored = window.localStorage.getItem(STORED_EMAIL_KEY) ?? "";
    if (stored) setEmail(stored);
  }, []);

  useEffect(() => {
    if (!state) return;
    const hasError = Boolean(state.error || state.errorCode);
    const shouldForward =
      Boolean(state.code) ||
      Boolean(state.tokenHash && state.otpType) ||
      Boolean(state.accessToken && state.refreshToken);

    if (hasError || !shouldForward) return;

    const target = new URL("/auth/callback/complete", window.location.origin);
    const params = new URLSearchParams(window.location.search);
    const hashRaw = window.location.hash.startsWith("#")
      ? window.location.hash.slice(1)
      : window.location.hash;
    if (hashRaw) {
      const hashParams = new URLSearchParams(hashRaw);
      for (const [key, value] of hashParams.entries()) {
        if (!params.has(key) && value) params.set(key, value);
      }
    }
    if (!params.has("next")) params.set("next", state.next);

    for (const key of FORWARDED_KEYS) {
      const value = params.get(key);
      if (value) target.searchParams.set(key, value);
    }

    router.replace(`${target.pathname}${target.search}`);
  }, [router, state]);

  const errorMessage = useMemo(() => {
    if (!state) return null;
    const code = state.errorCode?.toLowerCase() ?? "";
    if (code === "otp_expired") return "로그인 링크가 만료되었거나 이미 사용됐어요.";
    if (code === "access_denied") return "로그인이 거부되었습니다.";
    if (state.errorDescription) return state.errorDescription;
    if (state.error || state.errorCode) return "로그인 처리 중 오류가 발생했습니다.";
    return "링크가 만료됐거나 잘못되었습니다.";
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
      const { error } = await supabase.auth.signInWithOtp({
        email: normalized,
        options: {
          emailRedirectTo: buildCanonicalCallbackUrl(state?.next ?? "/"),
        },
      });

      if (error) {
        setMessage(error.message);
        return;
      }

      window.localStorage.setItem(STORED_EMAIL_KEY, normalized);
      setMessage("메일함을 확인해 로그인 링크를 클릭하세요.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "로그인 링크 재발송에 실패했습니다.");
    } finally {
      setSending(false);
    }
  };

  if (!state) {
    return (
      <main className="max-w-sm mx-auto px-4 py-20">
        <p className="text-sm text-neutral-500 text-center">로그인 처리 중입니다...</p>
      </main>
    );
  }

  const hasError = Boolean(state.error || state.errorCode);
  const hasProcessableParams =
    Boolean(state.code) ||
    Boolean(state.tokenHash && state.otpType) ||
    Boolean(state.accessToken && state.refreshToken);

  if (!hasError && !hasProcessableParams) {
    return (
      <main className="max-w-sm mx-auto px-4 py-20">
        <div className="rounded-xl border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-700">링크가 만료됐거나 잘못되었습니다.</p>
          <Link
            href={`/login?error=missing_callback_params&next=${encodeURIComponent(state.next)}`}
            className="mt-3 inline-flex min-h-[40px] items-center rounded-lg bg-red-600 px-3 text-sm font-medium text-white"
          >
            로그인 페이지로 이동
          </Link>
        </div>
      </main>
    );
  }

  if (!hasError) {
    return (
      <main className="max-w-sm mx-auto px-4 py-20">
        <p className="text-sm text-neutral-500 text-center">로그인 처리 중입니다...</p>
      </main>
    );
  }

  return (
    <main className="max-w-sm mx-auto px-4 py-16">
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
        <p className="text-sm font-medium text-amber-900">{errorMessage}</p>
        <p className="mt-1 text-xs text-amber-800">다시 링크를 보내드릴게요.</p>
        <p className="mt-1 text-xs text-amber-800">인앱 브라우저에서 실패할 수 있어 Chrome/Safari에서 열어주세요.</p>

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

        {inAppBrowser && (
          <button
            type="button"
            onClick={() => window.open(window.location.href, "_blank", "noopener,noreferrer")}
            className="mt-3 w-full min-h-[40px] rounded-lg border border-amber-400 bg-white text-amber-900 text-sm font-medium"
          >
            Chrome/Safari로 열기
          </button>
        )}
      </div>
    </main>
  );
}
