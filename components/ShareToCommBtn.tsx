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

  const handleShare = async () => {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.push(`/login?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`);
      return;
    }

    setLoading(true);
    const res = await fetch("/api/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, title, payload_json: payload }),
    });

    if (res.ok) {
      const data = await res.json();
      router.push(`/community/${data.id}`);
    } else {
      const data = await res.json();
      alert(data.error ?? "오류가 발생했습니다.");
    }
    setLoading(false);
  };

  return (
    <button
      type="button"
      onClick={handleShare}
      disabled={loading}
      className={`w-full min-h-[48px] rounded-xl bg-neutral-800 text-white font-medium hover:bg-neutral-900 active:scale-[0.98] transition-all text-sm disabled:opacity-50 ${className}`}
    >
      {loading ? "공유 중..." : "📢 커뮤니티에 기록 공유하기"}
    </button>
  );
}
