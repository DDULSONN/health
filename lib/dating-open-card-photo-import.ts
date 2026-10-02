const IMAGE_EXTENSIONS: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export function ownOpenCardPhotoUrl(raw: unknown, userId: string, origin: string): string | null {
  if (typeof raw !== "string" || !userId) return null;
  try {
    const url = new URL(raw, origin);
    if (url.origin !== origin || url.username || url.password || url.hash) return null;
    const parts = url.pathname.split("/").slice(1).map(decodeURIComponent);
    if (parts.some(part => !part || part === "." || part === ".." || /[\\/%]/.test(part))) return null;
    if (parts.length < 7 || parts.slice(0, 6).join("/") !== `i/signed/dating-card-photos/cards/${userId}/raw`) return null;
    // Use the existing owner-authorized image route, never an arbitrary URL or another bucket.
    // No transform query: preserve the existing photo response rather than requesting a thumbnail.
    return url.pathname;
  } catch { return null; }
}

async function validateImage(file: File, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
  const url = URL.createObjectURL(file);
  const image = new Image();
  let abort = () => {};
  try {
    await new Promise<void>((resolve, reject) => {
      abort = () => reject(new DOMException("Cancelled", "AbortError"));
      signal.addEventListener("abort", abort, { once: true });
      image.onload = () => image.naturalWidth > 0 && image.naturalHeight > 0 && image.naturalWidth * image.naturalHeight <= 60_000_000
        ? resolve() : reject(new Error("사진 크기를 확인하지 못했어요."));
      image.onerror = () => reject(new Error("사진을 읽지 못했어요."));
      image.src = url;
    });
  } finally {
    signal.removeEventListener("abort", abort);
    image.onload = null; image.onerror = null; image.src = "";
    URL.revokeObjectURL(url);
  }
}

/** Caller owns the bounded abort timer. Files remain in memory until the normal submit/upload. */
export async function importOwnOpenCardPhoto(raw: unknown, userId: string, slot: number, maxBytes: number, signal: AbortSignal): Promise<File> {
  const url = ownOpenCardPhotoUrl(raw, userId, window.location.origin);
  if (!url) throw new Error("본인 오픈카드 사진 경로를 확인하지 못했어요.");
  const response = await fetch(url, { credentials: "same-origin", cache: "no-store", redirect: "error", signal });
  const type = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!response.ok || !IMAGE_EXTENSIONS[type] || !response.body || Number(response.headers.get("content-length")) > maxBytes) {
    throw new Error("사진을 가져오지 못했어요. 직접 선택해 주세요.");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error("사진 용량이 너무 커요. 직접 선택해 주세요.");
      chunks.push(new Uint8Array(value));
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  if (!size) throw new Error("비어 있는 사진이에요. 직접 선택해 주세요.");
  const file = new File(chunks, `open-card-${slot + 1}.${IMAGE_EXTENSIONS[type]}`, { type });
  await validateImage(file, signal);
  return file;
}
