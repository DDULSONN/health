"use client";

import Image from "next/image";
import { useCallback, useEffect, useState } from "react";

import {
  APP_TEST_FEEDBACK_CATEGORIES,
  APP_TEST_FEEDBACK_CATEGORY_LABELS,
  APP_TEST_STATUS_LABELS,
  type AppTestFeedbackCategory,
  type AppTestStatus,
} from "@/lib/app-testing";

type AppTestApplication = {
  id: string;
  play_email: string;
  status: AppTestStatus;
  created_at: string;
};

type AppTestFeedback = {
  id: string;
  category: AppTestFeedbackCategory;
  message: string;
  device_model: string | null;
  app_version: string | null;
  created_at: string;
};

type AppTestPayload = {
  application?: AppTestApplication | null;
  feedback?: AppTestFeedback[] | AppTestFeedback;
  error?: string;
};

async function readPayload(response: Response) {
  return (await response.json().catch(() => ({}))) as AppTestPayload;
}

export default function AppTestProgramPanel() {
  const [application, setApplication] = useState<AppTestApplication | null>(null);
  const [feedback, setFeedback] = useState<AppTestFeedback[]>([]);
  const [loading, setLoading] = useState(true);
  const [available, setAvailable] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [playEmail, setPlayEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [category, setCategory] = useState<AppTestFeedbackCategory>("general");
  const [message, setMessage] = useState("");
  const [deviceModel, setDeviceModel] = useState("");
  const [appVersion, setAppVersion] = useState("");

  const loadStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/mypage/app-testing", { cache: "no-store" });
      const payload = await readPayload(response);
      if (!response.ok) {
        if (response.status === 503) setAvailable(false);
        return;
      }
      setApplication(payload.application ?? null);
      setFeedback(Array.isArray(payload.feedback) ? payload.feedback : []);
      if (payload.application?.play_email) setPlayEmail(payload.application.play_email);
    } catch {
      // Keep the rest of My Page usable when the optional test program is unavailable.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const openModal = () => {
    setError("");
    setSuccess("");
    setModalOpen(true);
  };

  const closeModal = () => {
    if (submitting) return;
    setModalOpen(false);
  };

  const submitApplication = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError("");
    setSuccess("");
    try {
      const response = await fetch("/api/mypage/app-testing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "apply", play_email: playEmail, consent }),
      });
      const payload = await readPayload(response);
      if (!response.ok || !payload.application) {
        throw new Error(payload.error ?? "테스트 신청을 완료하지 못했습니다.");
      }
      setApplication(payload.application);
      setSuccess("신청이 완료되었습니다. 초대 준비가 되면 입력한 이메일로 안내드릴게요.");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "테스트 신청을 완료하지 못했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  const submitFeedback = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError("");
    setSuccess("");
    try {
      const response = await fetch("/api/mypage/app-testing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "feedback",
          category,
          message,
          device_model: deviceModel,
          app_version: appVersion,
        }),
      });
      const payload = await readPayload(response);
      if (!response.ok || !payload.feedback || Array.isArray(payload.feedback)) {
        throw new Error(payload.error ?? "피드백을 보내지 못했습니다.");
      }
      setFeedback((current) => [payload.feedback as AppTestFeedback, ...current]);
      setMessage("");
      setSuccess("피드백을 보냈습니다. 확인 후 앱 개선에 반영하겠습니다.");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "피드백을 보내지 못했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!available) return null;

  return (
    <>
      <section className="mb-5 flex min-h-[76px] items-center gap-3 border-y border-neutral-200 bg-white px-3 py-3 sm:px-4">
        <Image
          src="/icon-96x96.png"
          alt="짐툴 앱 아이콘"
          width={44}
          height={44}
          className="h-11 w-11 shrink-0 rounded-lg border border-neutral-100 object-cover"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="text-sm font-semibold text-neutral-900">
              {application ? "앱 테스트 참여 중" : "갤럭시 앱 미리 써보기"}
            </p>
            {application ? (
              <span className="text-[11px] font-medium text-emerald-700">
                {APP_TEST_STATUS_LABELS[application.status] ?? "신청 완료"}
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 truncate text-[11px] text-neutral-500">
            Google Play 비공개 테스트 · 아이폰은 추후 지원
          </p>
        </div>
        <button
          type="button"
          onClick={openModal}
          disabled={loading}
          className="min-h-[44px] shrink-0 rounded-md border border-neutral-300 bg-white px-3 text-xs font-semibold text-neutral-800 transition active:scale-[0.98] disabled:opacity-50"
        >
          {loading ? "확인 중" : application ? "피드백 보내기" : "테스트 신청"}
        </button>
      </section>

      {modalOpen ? (
        <div
          className="fixed inset-0 z-[90] flex items-end justify-center bg-black/45 p-0 sm:items-center sm:p-5"
          role="dialog"
          aria-modal="true"
          aria-label={application ? "앱 테스트 피드백" : "앱 테스트 신청"}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeModal();
          }}
        >
          <div className="max-h-[88dvh] w-full max-w-md overflow-y-auto rounded-t-xl bg-white p-5 shadow-xl sm:rounded-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-base font-bold text-neutral-950">
                  {application ? "앱 사용 의견 보내기" : "갤럭시 앱 테스트 신청"}
                </p>
                <p className="mt-1 text-xs leading-5 text-neutral-500">
                  {application
                    ? "불편한 점이나 개선 의견을 남겨주세요. 여러 번 보내도 괜찮아요."
                    : "Google Play 비공개 테스트에 사용할 이메일을 입력해주세요."}
                </p>
              </div>
              <button
                type="button"
                onClick={closeModal}
                aria-label="닫기"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-xl text-neutral-500 hover:bg-neutral-100"
              >
                ×
              </button>
            </div>

            {application ? (
              <div className="mt-4 space-y-3">
                <label className="block text-xs font-semibold text-neutral-700">
                  의견 종류
                  <select
                    value={category}
                    onChange={(event) => setCategory(event.target.value as AppTestFeedbackCategory)}
                    className="mt-1 min-h-[44px] w-full rounded-md border border-neutral-300 bg-white px-3 text-sm outline-none focus:border-neutral-700"
                  >
                    {APP_TEST_FEEDBACK_CATEGORIES.map((item) => (
                      <option key={item} value={item}>
                        {APP_TEST_FEEDBACK_CATEGORY_LABELS[item]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs font-semibold text-neutral-700">
                  피드백
                  <textarea
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    maxLength={2000}
                    rows={5}
                    placeholder="어떤 화면에서 무엇이 불편했는지 적어주세요."
                    className="mt-1 w-full resize-y rounded-md border border-neutral-300 px-3 py-3 text-sm leading-6 outline-none focus:border-neutral-700"
                  />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block text-xs font-semibold text-neutral-700">
                    기기 모델 (선택)
                    <input
                      value={deviceModel}
                      onChange={(event) => setDeviceModel(event.target.value)}
                      maxLength={100}
                      placeholder="예: Galaxy S24"
                      className="mt-1 min-h-[44px] w-full rounded-md border border-neutral-300 px-3 text-sm outline-none focus:border-neutral-700"
                    />
                  </label>
                  <label className="block text-xs font-semibold text-neutral-700">
                    앱 버전 (선택)
                    <input
                      value={appVersion}
                      onChange={(event) => setAppVersion(event.target.value)}
                      maxLength={50}
                      placeholder="예: 1.0.2"
                      className="mt-1 min-h-[44px] w-full rounded-md border border-neutral-300 px-3 text-sm outline-none focus:border-neutral-700"
                    />
                  </label>
                </div>
                {feedback.length > 0 ? (
                  <p className="text-[11px] text-neutral-500">지금까지 보낸 피드백 {feedback.length}건</p>
                ) : null}
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                <label className="block text-xs font-semibold text-neutral-700">
                  Google Play 이메일
                  <input
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    value={playEmail}
                    onChange={(event) => setPlayEmail(event.target.value)}
                    maxLength={254}
                    placeholder="example@gmail.com"
                    className="mt-1 min-h-[46px] w-full rounded-md border border-neutral-300 px-3 text-sm outline-none focus:border-neutral-700"
                  />
                </label>
                <label className="flex cursor-pointer items-start gap-3 border-t border-neutral-100 pt-3 text-xs leading-5 text-neutral-600">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(event) => setConsent(event.target.checked)}
                    className="mt-1 h-4 w-4 shrink-0 accent-neutral-900"
                  />
                  <span>
                    비공개 테스트 초대와 참여 관리를 위한 이메일 수집에 동의합니다. 테스트 종료 또는 신청 철회 시
                    파기하며, 운영 분석을 위해 종료 후 최대 3개월 보관할 수 있습니다.
                  </span>
                </label>
              </div>
            )}

            {error ? <p className="mt-3 text-xs font-medium text-rose-600">{error}</p> : null}
            {success ? <p className="mt-3 text-xs font-medium text-emerald-700">{success}</p> : null}

            <button
              type="button"
              onClick={() => void (application ? submitFeedback() : submitApplication())}
              disabled={submitting || (application ? message.trim().length < 5 : !playEmail.trim() || !consent)}
              className="mt-5 min-h-[48px] w-full rounded-md bg-neutral-950 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              {submitting ? "보내는 중..." : application ? "피드백 보내기" : "테스트 신청하기"}
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
