"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { createClient } from "@/lib/supabase/client";

function LoginContent() {
  const searchParams = useSearchParams();
  const redirect = searchParams.get("redirect") ?? "/mypage";
  const urlError = searchParams.get("error");
  const [error, setError] = useState<string | null>(urlError);
  const [loading, setLoading] = useState(false);

  const handleGoogleLogin = async () => {
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const baseSiteUrl =
        process.env.NEXT_PUBLIC_SITE_URL ||
        process.env.SITE_URL ||
        window.location.origin;
      const callbackUrl = new URL("/auth/callback", baseSiteUrl);
      callbackUrl.searchParams.set("next", redirect);

      const { error: authError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: callbackUrl.toString(),
        },
      });
      if (authError) {
        setError(authError.message);
        setLoading(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "알 수 없는 오류가 발생했습니다.");
      setLoading(false);
    }
  };

  return (
    <main className="max-w-sm mx-auto px-4 py-16 flex flex-col items-center min-h-[70vh] justify-center">
      <h1 className="text-2xl font-bold text-neutral-900 mb-2">로그인</h1>
      <p className="text-sm text-neutral-500 mb-8 text-center">
        GymTools 커뮤니티에 참여하고
        <br />
        내 기록을 공유하세요.
      </p>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 rounded-xl p-3 mb-4 w-full text-center">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={handleGoogleLogin}
        disabled={loading}
        className="w-full flex items-center justify-center gap-3 min-h-[52px] rounded-xl border-2 border-neutral-200 bg-white text-neutral-800 font-medium hover:bg-neutral-50 active:scale-[0.98] transition-all disabled:opacity-50"
      >
        <svg width="20" height="20" viewBox="0 0 48 48">
          <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.9 33.5 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.7-.4-3.9z" />
          <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.5 15.2 18.9 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
          <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.3 35.2 26.7 36 24 36c-5.2 0-9.6-3.5-11.2-8.2l-6.5 5C9.5 39.6 16.2 44 24 44z" />
          <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.7-.4-3.9z" />
        </svg>
        {loading ? "로그인 중..." : "Google로 로그인"}
      </button>

      <p className="text-xs text-neutral-400 mt-6 text-center">
        로그인 시 서비스 이용약관에 동의한 것으로 간주합니다.
      </p>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<main className="max-w-sm mx-auto px-4 py-16"><p className="text-neutral-400 text-center">로딩 중...</p></main>}>
      <LoginContent />
    </Suspense>
  );
}
