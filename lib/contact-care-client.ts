import type { ContactCareStatus } from "@/lib/contact-care";

export type CareAttempt = { action: "apply" | "redeem" | "redeem_manual"; matchId: string; orderId?: string };

export class CareTransportError extends Error {
  constructor(public kind: "network" | "timeout" | "canceled" | "response") {
    super(kind === "timeout" ? "응답이 늦어 결과를 확인하지 못했어요." : "연결이 끊겨 결과를 확인하지 못했어요.");
    this.name = "CareTransportError";
  }
}

// Contact-care only: never retry a POST, and bound response-body reads as well as
// fetch. Racing the deadline also releases the UI if a webview ignores abort.
export async function fetchCareJson<T>(init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel = () => {};
  const interrupted = new Promise<never>((_, reject) => {
    cancel = () => { reject(new CareTransportError("canceled")); controller.abort(); };
    timer = setTimeout(() => { reject(new CareTransportError("timeout")); controller.abort(); }, timeoutMs);
  });
  if (init.signal?.aborted) cancel();
  else init.signal?.addEventListener("abort", cancel, { once: true });
  try {
    if (init.signal?.aborted) return await interrupted;
    return await Promise.race([
      (async () => {
        const response = await fetch("/api/dating/1on1/contact-care", { ...init, signal: controller.signal });
        const body = await response.json().catch(() => null) as T | null;
        return { response, body };
      })(),
      interrupted,
    ]);
  } catch (error) {
    throw error instanceof CareTransportError ? error : new CareTransportError("network");
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener("abort", cancel);
  }
}

export function careClientError(error: unknown) {
  // Preserve actionable server validation messages, never expose native English
  // fetch errors or internal diagnostics to the member.
  return error instanceof Error && /[가-힣]/.test(error.message)
    ? error.message : "연결 상태를 확인한 뒤 ‘내역 다시 확인’을 눌러 주세요.";
}

export function careAttemptRecorded(status: ContactCareStatus, attempt: CareAttempt) {
  const claim = status.claim;
  if (attempt.action === "apply") return !!claim && claim.match_id === attempt.matchId && claim.order_id === attempt.orderId
    && ["pending", "approved"].includes(claim.status);
  if (attempt.action === "redeem") return !!claim?.used_at && claim.used_match_id === attempt.matchId;
  return !!status.manual_history?.some(item => item.used_match_id === attempt.matchId && item.used_at);
}

// Take an in-memory copy while the mobile file picker still grants access. No
// conversion, storage or upload here; the server keeps all evidence validation.
export async function snapshotCareEvidence(files: File[], timeoutMs = 10000): Promise<File[]> {
  if (files.length > 3 || files.reduce((sum, file) => sum + file.size, 0) > 3_000_000
    || files.some(file => !file.size || !["image/jpeg", "image/png", "image/webp"].includes(file.type))) {
    throw Error("JPG·PNG·WebP 캡처 1~3장, 합계 3MB 이하로 선택해 주세요.");
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.all(files.map(async file => {
        const bytes = await file.arrayBuffer();
        if (bytes.byteLength !== file.size) throw Error("FILE_CHANGED");
        return new File([bytes], file.name, { type: file.type, lastModified: file.lastModified });
      })),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error("FILE_TIMEOUT")), timeoutMs); }),
    ]);
  } catch {
    throw Error("캡처 파일을 읽지 못했어요. 사진을 휴대폰에 저장한 뒤 다시 선택해 주세요. 작성한 내용은 유지돼요.");
  } finally { clearTimeout(timer); }
}
