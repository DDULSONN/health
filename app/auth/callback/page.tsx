"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

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
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [inAppBrowser, setInAppBrowser] = useState(false);
  const [processing, setProcessing] = useState(true);

  useEffect(() => {
    const parsed = parseStateFromLocation();
    setState(parsed);
    setInAppBrowser(isInAppBrowser(navigator.userAgent));

    const stored = window.localStorage.getItem(STORED_EMAIL_KEY) ?? "";
    if (stored) setEmail(stored);

    (async () => {
      const supabase = createClient();

      // 1) Session-first: if session exists, ignore all error params and redirect immediately.
      const {
        data: { session: initialSession },
      } = await supabase.auth.getSession();
      if (initialSession) {
        router.replace(parsed.next || "/");
        return;
      }

      // 2) token_hash + type (email verification/magic link/recovery)
      if (parsed.tokenHash && parsed.otpType) {
        const { error } = await supabase.auth.verifyOtp({
          token_hash: parsed.tokenHash,
          type: parsed.otpType as EmailOtpType,
        });

        if (!error) {
          router.replace(parsed.next || "/");
          return;
        }
      }

      // 3) code (OAuth/PKCE)
      if (parsed.code) {
        const { error } = await supabase.auth.exchangeCodeForSession(parsed.code);

        if (!error) {
          router.replace(parsed.next || "/");
          return;
        }
      }

      // 4) access_token + refresh_token
      if (parsed.accessToken && parsed.refreshToken) {
        const { error } = await supabase.auth.setSession({
          access_token: parsed.accessToken,
          refresh_token: parsed.refreshToken,
        });

        if (!error) {
          router.replace(parsed.next || "/");
          return;
        }
      }

      // Final guard: sometimes session appears after auth client processes URL.
      const {
        data: { session: finalSession },
      } = await supabase.auth.getSession();
      if (finalSession) {
        router.replace(parsed.next || "/");
        return;
      }

      setProcessing(false);
    })();
  }, [router]);

  const errorMessage = useMemo(() => {
    if (!state) return "";
    const code = state.errorCode?.toLowerCase() ?? "";

    if (code === "otp_expired") return "로그인 링크가 만료되었거나 이미 사용됐어요.";
    if (code === "access_denied") return "로그인이 거부되었거나 취소되었습니다.";
    if (code === "flow_state_missing") return "세션 정보가 사라졌습니다. 같은 브라우저에서 다시 시도해 주세요.";
    if (state.errorDescription) return state.errorDescription;
    if (state.error || state.errorCode) return "로그인 처리 중 오류가 발생했습니다.";
    return "잘못된 로그인 링크입니다.";
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

  if (!state || processing) {
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
        <p className="mt-1 text-xs text-amber-800">새 로그인 링크를 다시 보내드릴게요.</p>
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

        <div className="mt-3 grid grid-cols-1 gap-2">
          <Link
            href={`/login?next=${encodeURIComponent(state.next || "/")}`}
            className="inline-flex min-h-[42px] items-center justify-center rounded-lg bg-white text-amber-900 border border-amber-300 text-sm font-medium"
          >
            로그인 페이지로 이동
          </Link>
          {inAppBrowser && (
            <button
              type="button"
              onClick={() => window.open(window.location.href, "_blank", "noopener,noreferrer")}
              className="min-h-[42px] rounded-lg bg-amber-600 text-white text-sm font-medium"
            >
              Chrome/Safari로 열기
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
