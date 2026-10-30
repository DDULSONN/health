/* eslint-disable @next/next/no-img-element -- Test-only Next Image adapter. */
import type { CSSProperties, ReactNode } from "react";
export { createClient, useRouter, useSearchParams } from "./profile-ux-adapters";
export default function Adapter(props: {
  children?: ReactNode; href?: string; src?: string; alt?: string;
  className?: string; width?: number; height?: number; style?: CSSProperties;
  onClick?: () => void;
}) {
  if (props.src) return <img src={props.src} alt={props.alt || ""} className={props.className}
    width={props.width} height={props.height} style={props.style} />;
  if (props.href) return <a href={props.href} className={props.className} onClick={props.onClick}>{props.children}</a>;
  return <>{props.children}</>;
}
// No live records or credentials. The landing deliberately renders its decorative fallback.
export function createAdminClient() {
  const query = { select: () => query, eq: () => query, gt: () => query, order: () => query,
    limit: async () => ({ data: [], error: null }) };
  return { from: () => query };
}
export const extractStorageObjectPathFromBuckets = () => null;
export const buildSignedImageUrl = () => "";
