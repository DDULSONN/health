"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [sending, setSending] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasRecoverySession, setHasRecoverySession] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      setHasRecoverySession(Boolean(session));
    })();
  }, []);

  const handleSendReset = async (e: FormEvent) => {
    e.preventDefault();
    const normalized = email.trim().toLowerCase();
    if (!normalized) {
      setError("이메일을 입력해 주세요.");
      return;
    }

    setSending(true);
    setError(null);
    setMessage(null);
    try {
      const supabase = createClient();
      const { error: sendError } = await supabase.auth.resetPasswordForEmail(normalized, {
        redirectTo: "https://helchang.com/auth/reset-password",
      });
      if (sendError) {
        setError(sendError.message);
        return;
      }
      setMessage("비밀번호 재설정 메일을 보냈습니다. 메일함을 확인해 주세요.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "재설정 메일 전송에 실패했습니다.");
    } finally {
      setSending(false);
    }
  };

  const handleUpdatePassword = async (e: FormEvent) => {
    e.preventDefault();
    if (!password || password.length < 8) {
      setError("비밀번호는 8자 이상이어야 합니다.");
      return;
    }
    if (password !== confirm) {
      setError("비밀번호 확인이 일치하지 않습니다.");
      return;
    }

    setUpdating(true);
    setError(null);
    setMessage(null);
    try {
      const supabase = createClient();
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError(updateError.message);
        return;
      }
      setMessage("비밀번호가 변경되었습니다. 로그인 페이지로 이동합니다.");
      setTimeout(() => router.replace("/login?next=/"), 900);
    } catch (e) {
      setError(e instanceof Error ? e.message : "비밀번호 변경에 실패했습니다.");
    } finally {
      setUpdating(false);
    }
  };

  return (
    <main className="max-w-sm mx-auto px-4 py-16">
      <h1 className="text-2xl font-bold text-neutral-900 mb-2">비밀번호 재설정</h1>
      <p className="text-sm text-neutral-500 mb-6">이메일로 링크를 받거나, 복구 세션에서 새 비밀번호를 설정하세요.</p>

      {error && <p className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-600">{error}</p>}
      {message && <p className="mb-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">{message}</p>}

      {!hasRecoverySession ? (
        <form onSubmit={handleSendReset} className="space-y-2">
          <label htmlFor="reset-email" className="text-sm font-medium text-neutral-700">
            이메일
          </label>
          <input
            id="reset-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full min-h-[48px] rounded-xl border border-neutral-300 px-3 text-neutral-900"
          />
          <button
            type="submit"
            disabled={sending}
            className="w-full min-h-[48px] rounded-xl bg-emerald-600 text-white font-medium disabled:opacity-50"
          >
            {sending ? "전송 중..." : "재설정 링크 보내기"}
          </button>
        </form>
      ) : (
        <form onSubmit={handleUpdatePassword} className="space-y-2">
          <label htmlFor="new-password" className="text-sm font-medium text-neutral-700">
            새 비밀번호
          </label>
          <input
            id="new-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="8자 이상"
            className="w-full min-h-[48px] rounded-xl border border-neutral-300 px-3 text-neutral-900"
          />
          <label htmlFor="new-password-confirm" className="text-sm font-medium text-neutral-700">
            새 비밀번호 확인
          </label>
          <input
            id="new-password-confirm"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="비밀번호 확인"
            className="w-full min-h-[48px] rounded-xl border border-neutral-300 px-3 text-neutral-900"
          />
          <button
            type="submit"
            disabled={updating}
            className="w-full min-h-[48px] rounded-xl bg-emerald-600 text-white font-medium disabled:opacity-50"
          >
            {updating ? "변경 중..." : "비밀번호 변경"}
          </button>
        </form>
      )}
    </main>
  );
}
