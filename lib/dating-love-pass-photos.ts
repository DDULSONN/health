import { extractStorageObjectPathFromBuckets } from "@/lib/images";

type PhotoCard = { owner_user_id: string; photo_visibility?: unknown; photo_paths?: unknown; blur_paths?: unknown; blur_thumb_path?: unknown };

export function getLovePassPhotoPaths(row: PhotoCard): string[] {
  const raw = row.photo_visibility === "public" && Array.isArray(row.photo_paths) ? row.photo_paths : [];
  const blur = Array.isArray(row.blur_paths) ? row.blur_paths : [];
  const resolve = (values: unknown[], kind: "raw" | "blur") => values.flatMap(value => {
    try {
      const path = extractStorageObjectPathFromBuckets(value, ["dating-card-photos", "dating-photos"]);
      if (!path) return [];
      const parts = path.split("/");
      return parts.length === 4 && parts[0] === "cards" && parts[1] === row.owner_user_id && parts[2] === kind && /^[\w.-]+\.(?:jpg|jpeg|png|webp|avif)$/i.test(parts[3]) ? [path] : [];
    } catch { return []; }
  });
  const rawPaths = resolve(raw, "raw");
  return [...new Set(rawPaths.length > 0 ? rawPaths : resolve([...blur, row.blur_thumb_path], "blur"))].slice(0, 2);
}
