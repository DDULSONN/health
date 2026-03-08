type BodyBattleImageOptions = {
  width?: number;
  quality?: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function toBodyBattleImageUrl(raw: string | null | undefined, options?: BodyBattleImageOptions): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!value) return null;

  const width = clamp(Math.round(options?.width ?? 640), 80, 1600);
  const quality = clamp(Math.round(options?.quality ?? 68), 45, 85);
  const isAbsolute = /^https?:\/\//i.test(value);

  try {
    const url = new URL(value, "http://local");

    if (url.pathname.includes("/storage/v1/object/public/")) {
      url.pathname = url.pathname.replace("/storage/v1/object/public/", "/storage/v1/render/image/public/");
    }

    const canAttachTransform =
      url.pathname.includes("/storage/v1/render/image/public/") || url.pathname.startsWith("/i/signed/");
    if (canAttachTransform) {
      if (!url.searchParams.has("w")) url.searchParams.set("w", String(width));
      if (!url.searchParams.has("q")) url.searchParams.set("q", String(quality));
    }

    if (isAbsolute) return url.toString();
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return value;
  }
}

