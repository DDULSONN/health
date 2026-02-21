const FORBIDDEN_IMAGE_URL_PATTERN = /(supabase\.co|\/storage\/v1\/|\/render\/image\/)/i;

function encodePath(path: string): string {
  return path
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/");
}

export function assertSafeObjectPath(objectPath: string): string {
  const normalized = (objectPath ?? "").trim().replace(/^\/+/, "");
  if (!normalized) return "";
  if (FORBIDDEN_IMAGE_URL_PATTERN.test(normalized)) {
    if (process.env.NODE_ENV !== "production") {
      throw new Error(`[images] invalid object path: ${normalized}`);
    }
    console.error("[images] invalid object path blocked");
    return "";
  }
  return normalized;
}

function extractFromToken(raw: string, token: string): string | null {
  const idx = raw.indexOf(token);
  if (idx < 0) return null;
  const tail = raw.slice(idx + token.length).split("?")[0] ?? "";
  return tail || null;
}

export function extractStorageObjectPath(raw: unknown, bucket: string): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value) return null;

  const normalizedBucket = bucket.replace(/^\/+|\/+$/g, "");
  const proxyPublicToken = `/i/public-lite/${normalizedBucket}/`;
  const proxySignedToken = `/i/signed/${normalizedBucket}/`;
  const proxyPublicExtracted = extractFromToken(value, proxyPublicToken);
  if (proxyPublicExtracted) return decodeURIComponent(proxyPublicExtracted);
  const proxySignedExtracted = extractFromToken(value, proxySignedToken);
  if (proxySignedExtracted) return decodeURIComponent(proxySignedExtracted);

  const tokens = [
    `/storage/v1/object/public/${normalizedBucket}/`,
    `/storage/v1/object/sign/${normalizedBucket}/`,
    `/storage/v1/render/image/public/${normalizedBucket}/`,
    `/storage/v1/render/image/sign/${normalizedBucket}/`,
  ];

  for (const token of tokens) {
    const extracted = extractFromToken(value, token);
    if (extracted) return decodeURIComponent(extracted);
  }

  if (value.startsWith(`/${normalizedBucket}/`)) return value.slice(normalizedBucket.length + 2);
  if (value.startsWith(`${normalizedBucket}/`)) return value.slice(normalizedBucket.length + 1);
  if (value.startsWith("/")) return value.slice(1);
  if (!value.startsWith("http://") && !value.startsWith("https://")) return value;
  return null;
}

export function buildPublicLiteImageUrl(bucket: string, objectPath: string): string {
  const safeBucket = assertSafeObjectPath(bucket);
  const safePath = assertSafeObjectPath(objectPath);
  if (!safeBucket || !safePath) return "";
  return `/i/public-lite/${encodePath(safeBucket)}/${encodePath(safePath)}`;
}

export function buildSignedImageUrl(bucket: string, objectPath: string): string {
  const safeBucket = assertSafeObjectPath(bucket);
  const safePath = assertSafeObjectPath(objectPath);
  if (!safeBucket || !safePath) return "";
  return `/i/signed/${encodePath(safeBucket)}/${encodePath(safePath)}`;
}
