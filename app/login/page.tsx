"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const IN_APP_UA_PATTERNS = ["kakaotalk", "instagram", "naver", "fban", "fbav"];

function isInAppBrowser(ua: string): boolean {
  const lowered = ua.toLowerCase();
  return IN_APP_UA_PATTERNS.some((token) => lowered.includes(token));
}

function LoginContent() {
  const searchParams = useSearchParams();
  const redirect = searchParams.get("redirect") ?? "/mypage";
  const urlError = searchParams.get("error");

  const [error, setError] = useState<string | null>(urlError);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [emailLoading, setEmailLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [emailSentMessage, setEmailSentMessage] = useState<string | null>(null);
  const [inAppBrowser, setInAppBrowser] = useState(false);

  const callbackUrl = useMemo(() => {
    const baseSiteUrl = process.env.NEXT_PUBLIC_SITE_URL || window.location.origin;
    const url = new URL("/auth/callback", baseSiteUrl);
    url.searchParams.set("next", redirect);
    return url.toString();
  }, [redirect]);

  useEffect(() => {
    setInAppBrowser(isInAppBrowser(navigator.userAgent));
  }, []);

  const handleGoogleLogin = async () => {
    setGoogleLoading(true);
    setError(null);
    setEmailSentMessage(null);

    try {
      const supabase = createClient();
      const { error: authError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: callbackUrl,
        },
      });

      if (authError) {
        setError(authError.message);
        setGoogleLoading(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Google 로그인 중 오류가 발생했습니다.");
      setGoogleLoading(false);
    }
  };

  const handleMagicLinkLogin = async () => {
    const normalized = email.trim().toLowerCase();
    if (!normalized) {
      setError("이메일을 입력해 주세요.");
      return;
    }

    setEmailLoading(true);
    setError(null);
    setEmailSentMessage(null);

    try {
      const supabase = createClient();
      const { error: authError } = await supabase.auth.signInWithOtp({
        email: normalized,
        options: {
          emailRedirectTo: callbackUrl,
        },
      });

      if (authError) {
        setError(authError.message);
        return;
      }

      setEmailSentMessage("메일함을 확인해 로그인 링크를 클릭하세요");
    } catch (e) {
      setError(e instanceof Error ? e.message : "이메일 로그인 링크 전송 중 오류가 발생했습니다.");
    } finally {
      setEmailLoading(false);
    }
  };

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setEmailSentMessage("현재 URL을 복사했습니다. 외부 브라우저에서 열어주세요.");
    } catch {
      setError("URL 복사에 실패했습니다.");
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

  return (
    <main className="max-w-sm mx-auto px-4 py-16 flex flex-col items-center min-h-[70vh] justify-center">
      <h1 className="text-2xl font-bold text-neutral-900 mb-2">로그인</h1>
      <p className="text-sm text-neutral-500 mb-8 text-center">
        커뮤니티 참여와 기록 관리를 위해 로그인하세요.
      </p>

      {error && <p className="text-sm text-red-600 bg-red-50 rounded-xl p-3 mb-4 w-full text-center">{error}</p>}

      {emailSentMessage && (
        <p className="text-sm text-emerald-700 bg-emerald-50 rounded-xl p-3 mb-4 w-full text-center">{emailSentMessage}</p>
      )}

      {inAppBrowser && (
        <div className="w-full mb-4 rounded-xl border border-amber-300 bg-amber-50 p-3">
          <p className="text-sm text-amber-900 font-medium">카카오톡(인앱)에서는 Google 로그인이 차단될 수 있어요.</p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={handleCopyUrl}
              className="flex-1 min-h-[40px] rounded-lg border border-amber-300 bg-white text-amber-900 text-sm font-medium"
            >
              URL 복사
            </button>
            <button
              type="button"
              onClick={handleOpenExternal}
              className="flex-1 min-h-[40px] rounded-lg bg-amber-600 text-white text-sm font-medium"
            >
              외부 브라우저로 열기
            </button>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={handleGoogleLogin}
        disabled={googleLoading || emailLoading}
        className="w-full flex items-center justify-center gap-3 min-h-[52px] rounded-xl border-2 border-neutral-200 bg-white text-neutral-800 font-medium hover:bg-neutral-50 active:scale-[0.98] transition-all disabled:opacity-50"
      >
        <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
          <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.9 33.5 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.7-.4-3.9z" />
          <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.5 15.2 18.9 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
          <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.3 35.2 26.7 36 24 36c-5.2 0-9.6-3.5-11.2-8.2l-6.5 5C9.5 39.6 16.2 44 24 44z" />
          <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.7-.4-3.9z" />
        </svg>
        {googleLoading ? "Google 로그인 중..." : "Google로 로그인"}
      </button>

      <div className="w-full my-5 flex items-center gap-3">
        <span className="h-px flex-1 bg-neutral-200" />
        <span className="text-xs text-neutral-400">또는 이메일로 로그인</span>
        <span className="h-px flex-1 bg-neutral-200" />
      </div>

      <div className="w-full space-y-2">
        <label htmlFor="email" className="text-sm text-neutral-700 font-medium">
          이메일
        </label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          autoComplete="email"
          className="w-full min-h-[48px] px-3 rounded-xl border border-neutral-300 text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
        <button
          type="button"
          onClick={handleMagicLinkLogin}
          disabled={emailLoading || googleLoading}
          className="w-full min-h-[48px] rounded-xl bg-emerald-600 text-white font-medium hover:bg-emerald-700 active:scale-[0.98] transition-all disabled:opacity-50"
        >
          {emailLoading ? "전송 중..." : "로그인 링크 보내기"}
        </button>
      </div>

      <p className="text-xs text-neutral-400 mt-6 text-center">로그인하면 서비스 이용약관 및 개인정보처리방침에 동의한 것으로 간주됩니다.</p>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className="max-w-sm mx-auto px-4 py-16">
          <p className="text-neutral-400 text-center">로딩 중...</p>
        </main>
      }
    >
      <LoginContent />
    </Suspense>
  );
}
