"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Sex = "male" | "female";

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export default function CertifyPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [sex, setSex] = useState<Sex | "">("");
  const [bodyweight, setBodyweight] = useState("");
  const [squat, setSquat] = useState("");
  const [bench, setBench] = useState("");
  const [deadlift, setDeadlift] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [submitCode, setSubmitCode] = useState("");
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.replace("/login?redirect=/certify");
        return;
      }
      setAuthChecked(true);
    })();
  }, [router, supabase]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      router.push("/login?redirect=/certify");
      return;
    }

    const trimmedVideoUrl = videoUrl.trim();
    if (trimmedVideoUrl && !isHttpUrl(trimmedVideoUrl)) {
      setError("영상 링크는 http:// 또는 https:// 로 시작해야 합니다.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/cert-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sex,
          bodyweight: bodyweight ? Number(bodyweight) : null,
          squat: Number(squat),
          bench: Number(bench),
          deadlift: Number(deadlift),
          video_url: trimmedVideoUrl || null,
          note,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        request?: { submit_code: string };
      };
      if (!response.ok) {
        throw new Error(body.error ?? "인증 신청에 실패했습니다.");
      }
      setSubmitCode(body.request?.submit_code ?? "");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError));
    } finally {
      setSubmitting(false);
    }
  };

  if (submitCode) {
    const mailTitle = `[GymTools 3대 인증] 영상 제출 - ${submitCode}`;
    const mailBody = `submit_code: ${submitCode}\n영상 링크: ${videoUrl.trim() || ""}\n추가 설명: `;

    return (
      <main className="max-w-md mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold text-neutral-900 mb-3">인증 신청 완료</h1>
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-sm text-neutral-700">제출 코드</p>
          <p className="text-2xl font-extrabold text-emerald-700 mt-1">{submitCode}</p>
        </div>

        <div className="rounded-2xl border border-neutral-200 bg-white p-4 mt-4 space-y-2">
          <p className="text-sm font-semibold text-neutral-900">영상 제출 안내</p>
          <p className="text-xs text-neutral-700">영상은 링크로 제출하거나, 이메일로 보내주세요.</p>
          <p className="text-xs text-neutral-700">이메일: gymtools.kr@gmail.com</p>
          <p className="text-xs text-neutral-600 mt-2">이메일 제목 템플릿: {mailTitle}</p>
          <p className="text-xs text-neutral-600 whitespace-pre-line">본문 템플릿: {mailBody}</p>
        </div>

        <button
          type="button"
          onClick={() => router.push("/mypage")}
          className="w-full mt-4 min-h-[48px] rounded-xl bg-emerald-600 text-white font-medium hover:bg-emerald-700"
        >
          내 신청 현황 보기
        </button>
      </main>
    );
  }

  if (!authChecked) {
    return (
      <main className="max-w-md mx-auto px-4 py-8">
        <p className="text-sm text-neutral-500">로그인 확인 중...</p>
      </main>
    );
  }

  return (
    <main className="max-w-md mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-neutral-900 mb-4">공식 3대 인증 신청</h1>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <p className="text-sm font-medium text-neutral-700 mb-2">성별 (필수)</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setSex("male")}
              className={`flex-1 h-11 rounded-xl border text-sm font-medium ${
                sex === "male" ? "bg-emerald-600 text-white border-emerald-600" : "bg-white border-neutral-300 text-neutral-700"
              }`}
            >
              남자
            </button>
            <button
              type="button"
              onClick={() => setSex("female")}
              className={`flex-1 h-11 rounded-xl border text-sm font-medium ${
                sex === "female" ? "bg-emerald-600 text-white border-emerald-600" : "bg-white border-neutral-300 text-neutral-700"
              }`}
            >
              여자
            </button>
          </div>
        </div>

        {[
          { id: "bodyweight", label: "체중 (kg, 선택)", value: bodyweight, setter: setBodyweight, required: false },
          { id: "squat", label: "스쿼트 (kg)", value: squat, setter: setSquat, required: true },
          { id: "bench", label: "벤치프레스 (kg)", value: bench, setter: setBench, required: true },
          { id: "deadlift", label: "데드리프트 (kg)", value: deadlift, setter: setDeadlift, required: true },
        ].map((field) => (
          <div key={field.id}>
            <label htmlFor={field.id} className="block text-sm font-medium text-neutral-700 mb-1">
              {field.label}
            </label>
            <input
              id={field.id}
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              value={field.value}
              required={field.required}
              onChange={(event) => field.setter(event.target.value)}
              className="w-full h-12 rounded-xl border border-neutral-300 bg-white px-3"
            />
          </div>
        ))}

        <div>
          <label htmlFor="video_url" className="block text-sm font-medium text-neutral-700 mb-1">
            영상 링크 (선택)
          </label>
          <input
            id="video_url"
            type="url"
            inputMode="url"
            value={videoUrl}
            onChange={(event) => setVideoUrl(event.target.value)}
            placeholder="https://..."
            className="w-full h-12 rounded-xl border border-neutral-300 bg-white px-3"
          />
        </div>

        <div>
          <label htmlFor="note" className="block text-sm font-medium text-neutral-700 mb-1">
            메모 (선택)
          </label>
          <textarea
            id="note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={3}
            className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-2"
            placeholder="촬영 환경, 장비 정보 등"
          />
        </div>

        <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2">
          <p className="text-xs text-neutral-700">영상은 링크로 제출하거나, 이메일로 보내주세요.</p>
          <p className="text-xs text-neutral-700">이메일: gymtools.kr@gmail.com</p>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={submitting || !sex}
          className="w-full min-h-[48px] rounded-xl bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-50"
        >
          {submitting ? "신청 중..." : "인증 신청하기"}
        </button>
      </form>
    </main>
  );
}

