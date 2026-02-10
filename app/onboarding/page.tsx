"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

function OnboardingContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/community";

  const [nickname, setNickname] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = nickname.trim();

    if (trimmed.length < 2 || trimmed.length > 12) {
      setError("닉네임은 2~12자로 입력해주세요.");
      return;
    }

    setLoading(true);
    setError("");

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.push("/login");
      return;
    }

    const { error: insertError } = await supabase.from("profiles").insert({
      user_id: user.id,
      nickname: trimmed,
    });

    if (insertError) {
      if (insertError.code === "23505") {
        setError("이미 사용 중인 닉네임입니다.");
      } else {
        setError("오류가 발생했습니다. 다시 시도해주세요.");
      }
      setLoading(false);
      return;
    }

    router.push(next);
  };

  return (
    <main className="max-w-sm mx-auto px-4 py-16 flex flex-col items-center min-h-[70vh] justify-center">
      <h1 className="text-2xl font-bold text-neutral-900 mb-2">닉네임 설정</h1>
      <p className="text-sm text-neutral-500 mb-8 text-center">
        커뮤니티에서 사용할 닉네임을 정해주세요.
      </p>

      <form onSubmit={handleSubmit} className="w-full space-y-4">
        <div>
          <label htmlFor="nickname" className="block text-sm font-medium text-neutral-700 mb-1">
            닉네임 (2~12자)
          </label>
          <input
            id="nickname"
            type="text"
            maxLength={12}
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="예: 헬린이123"
            className="w-full h-12 rounded-xl border border-neutral-300 bg-white px-3 text-neutral-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 rounded-xl p-3">{error}</p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full min-h-[52px] rounded-xl bg-emerald-600 text-white font-medium hover:bg-emerald-700 active:scale-[0.98] transition-all disabled:opacity-50"
        >
          {loading ? "설정 중..." : "시작하기"}
        </button>
      </form>
    </main>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense fallback={<main className="max-w-sm mx-auto px-4 py-16"><p className="text-neutral-400 text-center">로딩 중...</p></main>}>
      <OnboardingContent />
    </Suspense>
  );
}
