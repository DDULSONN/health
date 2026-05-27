import { withImageTransform } from "@/lib/images";

type BodyBattleImageOptions = {
  width?: number;
  quality?: number;
};

export function toBodyBattleImageUrl(raw: string | null | undefined, options?: BodyBattleImageOptions): string | null {
  return withImageTransform(raw, {
    width: options?.width ?? 640,
    quality: options?.quality ?? 68,
  });
}
