"use client";

import { FormEvent, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function normalizeNextPath(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/admin";
  return value;
}

export default function AdminUnlockClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setSubmitting(true);

    try {
      const response = await fetch("/api/admin/panel-unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        setMessage(data?.message ?? "관리자 잠금 해제에 실패했습니다.");
        return;
      }

      router.replace(normalizeNextPath(searchParams.get("next")));
      router.refresh();
    } catch {
      setMessage("잠시 후 다시 시도해주세요.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-[80vh] items-center justify-center bg-neutral-50 px-4 py-12">
      <section className="w-full max-w-sm rounded-3xl border border-neutral-200 bg-white p-6 shadow-sm">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Admin Lock</p>
          <h1 className="text-2xl font-bold text-neutral-950">관리자 2차 확인</h1>
          <p className="text-sm leading-6 text-neutral-500">
            처음 쓰는 브라우저나 컴퓨터에서는 관리자 비밀번호를 한 번 더 입력해야 합니다.
          </p>
        </div>

        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <label className="block space-y-2">
            <span className="text-sm font-semibold text-neutral-800">관리자 비밀번호</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoFocus
              autoComplete="current-password"
              className="w-full rounded-2xl border border-neutral-200 px-4 py-3 text-sm outline-none transition focus:border-neutral-900"
              placeholder="비밀번호 입력"
            />
          </label>

          {message ? <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{message}</p> : null}

          <button
            type="submit"
            disabled={submitting || !password.trim()}
            className="w-full rounded-2xl bg-neutral-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-300"
          >
            {submitting ? "확인 중..." : "관리자 페이지 열기"}
          </button>
        </form>
      </section>
    </main>
  );
}
