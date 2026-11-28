import type { UploadDiagnostic } from "@/lib/onboarding-funnel";

export class DatingPhotoUploadError extends Error {
  constructor(message: string, public readonly diagnostic: UploadDiagnostic) { super(message); }
}

const UPLOAD_TIMEOUT_MS = 45_000;
const RETRY_PAUSE_MS = 350;
const RETRYABLE_STATUSES = new Set([408, 425, 500, 502, 503, 504]);

function waitForRetry(signal: AbortSignal) {
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>(resolve => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener("abort", finish); resolve(); };
    const timer = setTimeout(finish, RETRY_PAUSE_MS);
    signal.addEventListener("abort", finish, { once: true });
  });
}

// Uploads only. Never retry profile writes/payments, or leave a submit pending indefinitely.
export async function uploadDatingPhoto(
  url: "/api/dating/cards/upload-card" | "/api/dating/1on1/upload",
  form: FormData,
  stage: UploadDiagnostic["stage"],
  { retryTransient = false }: { retryTransient?: boolean } = {},
): Promise<string> {
  const controller = new AbortController();
  const timedOut = () => new DatingPhotoUploadError("사진 업로드 시간이 초과됐어요. 연결 상태를 확인하고 다시 시도해 주세요.", { stage, reason: "timeout" });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { reject(timedOut()); controller.abort(); }, UPLOAD_TIMEOUT_MS);
  });
  const run = async () => {
    let response: Response | undefined;
    for (let attempt = 0; ; attempt += 1) {
      if (controller.signal.aborted) throw timedOut();
      try {
        response = await fetch(url, { method: "POST", body: form, signal: controller.signal });
      } catch (error) {
        if (controller.signal.aborted) throw timedOut();
        // Only a connection failure before a response is a retry candidate.
        const transportFailure = error instanceof TypeError || (error instanceof DOMException && error.name === "NetworkError");
        if (!retryTransient || attempt !== 0 || !transportFailure) throw error;
        await waitForRetry(controller.signal);
        continue;
      }
      if (!retryTransient || attempt !== 0 || !RETRYABLE_STATUSES.has(response.status)) break;
      await waitForRetry(controller.signal);
    }

    if (controller.signal.aborted) throw timedOut();
    if (!response.ok) {
      const reason = response.status === 413 ? "too_large" : response.status === 401 || response.status === 403 ? "auth"
        : response.status === 429 ? "rate_limited" : response.status >= 500 ? "server" : "rejected";
      const message = reason === "too_large" ? "사진 용량이 너무 커요. 사진을 다시 선택하면 용량을 줄여 업로드해요."
        : reason === "auth" ? "로그인 상태를 확인한 뒤 다시 시도해 주세요."
        : reason === "rate_limited" ? "잠시 후 다시 시도해 주세요."
        : reason === "rejected" ? "사진을 처리하지 못했어요. 다른 사진이나 캡처한 사진으로 다시 선택해 주세요."
        : "사진 저장이 지연되고 있어요. 잠시 후 다시 시도해 주세요.";
      throw new DatingPhotoUploadError(message, { stage, reason });
    }
    const body = await response.json();
    if (typeof body?.path !== "string" || !body.path.trim()) {
      throw new DatingPhotoUploadError("사진 저장 결과를 확인하지 못했어요. 다시 시도해 주세요.", { stage, reason: "invalid_response" });
    }
    return body.path as string;
  };
  try {
    // Some webviews don't settle fetch or JSON reads after abort. Race the
    // complete upload instead, under one budget shared by both attempts.
    return await Promise.race([run(), deadline]);
  } catch (error) {
    if (error instanceof DatingPhotoUploadError) throw error;
    const reason = controller.signal.aborted ? "timeout" : error instanceof SyntaxError ? "invalid_response" : "network";
    throw new DatingPhotoUploadError(reason === "timeout" ? "사진 업로드 시간이 초과됐어요. 연결 상태를 확인하고 다시 시도해 주세요."
      : "사진 업로드를 완료하지 못했어요. 연결 상태를 확인하고 다시 시도해 주세요.", { stage, reason });
  } finally { clearTimeout(timer); }
}
