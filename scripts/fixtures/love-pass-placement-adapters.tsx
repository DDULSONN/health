import type { ComponentProps } from "react";
import Adapter from "./recommendation-refresh-adapters";

export { createClient, usePathname, useRouter, useSearchParams } from "./recommendation-refresh-adapters";

// Preserve accessible names on the links rendered by the real Home component.
export default function LovePassPlacementAdapter({ href, children, className, onClick, src, alt, "aria-label": label }:
  ComponentProps<typeof Adapter> & { "aria-label"?: string }) {
  if (href) return <a href={href} className={className} onClick={onClick} aria-label={label}>{children}</a>;
  return <Adapter className={className} onClick={onClick} src={src} alt={alt}>{children}</Adapter>;
}
