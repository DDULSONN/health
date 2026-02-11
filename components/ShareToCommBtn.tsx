"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface ShareToCommBtnProps {
  type: string;
  title: string;
  payload: Record<string, unknown>;
  className?: string;
}

export default function ShareToCommBtn({
  type,
  title,
  payload,
  className = "",
}: ShareToCommBtnProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");

  const handleShare = async () => {
    // payload 검증: 기록 타입이면 값 확인
    if (type === "lifts") {
      const { squat, bench, deadlift } = payload as Record<string, number>;
      if (!squat && !bench && !deadlift) {
        setError("기록을 먼저 입력해주세요.");
        setTimeout(() => setError(""), 3000);
        return;
      }
    }

    if (type === "1rm") {
      const { oneRmKg } = payload as Record<string, number>;
      if (!oneRmKg || oneRmKg <= 0) {
        setError("1RM 결과가 없습니다.");
        setTimeout(() => setError(""), 3000);
        return;
      }
    }

    // NaN 방지
    const cleanPayload = Object.fromEntries(
      Object.entries(payload).map(([k, v]) => [
        k,
        typeof v === "number" && isNaN(v) ? 0 : v,
      ])
    );

    // 로그인 확인
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      router.push(`/login?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`);
      return;
    }

    setLoading(true);
    setError("");

    const res = await fetch("/api/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, title, payload_json: cleanPayload }),
    });

    if (res.ok) {
      const data = await res.json();
      setToast("커뮤니티에 공유되었습니다!");
      setTimeout(() => router.push(`/community/${data.id}`), 800);
    } else {
      const data = await res.json();
      setError(data.error ?? "오류가 발생했습니다.");
      setTimeout(() => setError(""), 4000);
      setLoading(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleShare}
        disabled={loading}
        className={`w-full min-h-[48px] rounded-xl bg-neutral-800 text-white font-medium hover:bg-neutral-900 active:scale-[0.98] transition-all text-sm disabled:opacity-50 ${className}`}
      >
        {loading ? "공유 중..." : "📢 커뮤니티에 기록 공유하기"}
      </button>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 rounded-xl p-3 mt-2 text-center">{error}</p>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-neutral-900 text-white px-5 py-3 rounded-xl text-sm font-medium shadow-lg z-50">
          {toast}
        </div>
      )}
    </>
  );
}
