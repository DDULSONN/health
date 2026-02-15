"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

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

export default function AuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    const merged = new URLSearchParams(window.location.search);

    const hash = window.location.hash.startsWith("#")
      ? window.location.hash.slice(1)
      : window.location.hash;

    if (hash) {
      const hashParams = new URLSearchParams(hash);
      for (const [key, value] of hashParams.entries()) {
        if (!merged.has(key) && value) {
          merged.set(key, value);
        }
      }
    }

    if (!merged.has("next")) {
      merged.set("next", "/");
    }

    const target = new URL("/auth/callback/complete", window.location.origin);
    for (const key of FORWARDED_KEYS) {
      const value = merged.get(key);
      if (value) target.searchParams.set(key, value);
    }

    router.replace(`${target.pathname}${target.search}`);
  }, [router]);

  return (
    <main className="max-w-sm mx-auto px-4 py-20">
      <p className="text-sm text-neutral-500 text-center">로그인 처리 중입니다...</p>
    </main>
  );
}
