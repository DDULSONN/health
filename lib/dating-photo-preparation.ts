// Browser-only preparation. Original JPEG/PNG/WebP files keep the existing upload path.
// HEIC is decoded locally using the OS codec; no photo is sent to an external converter.
export const DATING_PHOTO_ACCEPT = "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp,.heic,.heif";
export const HEIC_HELP = "HEIC는 지원되는 브라우저에서 JPG로 자동 변환돼요. 변환이 안 되면 사진을 캡처하거나 JPG로 선택해 주세요.";
export const PHOTO_PROCESSING_MESSAGE = "사진을 처리 중이에요. 잠시만 기다려 주세요.";
const TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp"]);

export function isHeicPhoto(file: File) {
  return /^image\/hei[cf](?:-sequence)?$/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);
}

export function datingPhotoError(file: File, maxBytes: number, allowHeic = false) {
  if (!file.size) return "비어 있는 사진이에요. 다른 사진을 선택해 주세요.";
  if (file.size > maxBytes) return `사진은 장당 ${maxBytes / 1024 / 1024}MB 이하만 선택할 수 있어요.`;
  if (isHeicPhoto(file)) return allowHeic ? "" : HEIC_HELP;
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!TYPES.has(file.type.toLowerCase()) && !EXTENSIONS.has(extension)) return "JPG, PNG, WebP 또는 HEIC 사진을 선택해 주세요.";
  return "";
}

export async function prepareDatingPhoto(file: File, maxBytes: number, signal?: AbortSignal): Promise<File> {
  const error = datingPhotoError(file, maxBytes, true);
  if (error) throw new Error(error);
  if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
  if (!isHeicPhoto(file)) return file;

  const url = URL.createObjectURL(file);
  const img = new Image();
  let canvas: HTMLCanvasElement | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort = () => {};
  try {
    // Cover both decoding and toBlob: neither may leave the form busy indefinitely.
    return await new Promise<File>((resolve, reject) => {
      let finished = false;
      const fail = (reason: Error) => { if (!finished) { finished = true; reject(reason); } };
      abort = () => fail(new DOMException("Cancelled", "AbortError"));
      signal?.addEventListener("abort", abort, { once: true });
      timer = setTimeout(() => fail(new Error(HEIC_HELP)), 15000);
      img.onerror = () => fail(new Error(HEIC_HELP));
      img.onload = () => {
        if (finished) return;
        try {
          const { naturalWidth: width, naturalHeight: height } = img;
          if (!width || !height || width * height > 60_000_000) throw new Error("사진 해상도가 너무 크거나 읽을 수 없어요. 크기를 줄이거나 캡처해서 선택해 주세요.");
          const scale = Math.min(1, 1600 / Math.max(width, height));
          canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(width * scale));
          canvas.height = Math.max(1, Math.round(height * scale));
          const context = canvas.getContext("2d");
          if (!context) throw new Error(HEIC_HELP);
          context.fillStyle = "#ffffff";
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.drawImage(img, 0, 0, canvas.width, canvas.height);
          canvas.toBlob((blob) => {
            if (finished) return;
            if (!blob || blob.type !== "image/jpeg" || !blob.size || blob.size > maxBytes) {
              fail(new Error(HEIC_HELP));
              return;
            }
            try {
              const name = file.name.replace(/\.[^.]*$/, "") || "photo";
              const result = new File([blob], `${name}.jpg`, { type: "image/jpeg", lastModified: file.lastModified });
              finished = true;
              resolve(result);
            } catch {
              fail(new Error(HEIC_HELP));
            }
          }, "image/jpeg", 0.88);
        } catch (reason) {
          fail(reason instanceof Error ? reason : new Error(HEIC_HELP));
        }
      };
      img.src = url;
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    img.onload = null;
    img.onerror = null;
    img.src = "";
    URL.revokeObjectURL(url);
    if (canvas) { canvas.width = 0; canvas.height = 0; }
  }
}
