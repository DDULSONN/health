import type { ComponentProps } from "react";
import Adapter, { createClient as createMemberClient } from "./recommendation-refresh-adapters";

export { usePathname, useRouter, useSearchParams } from "./recommendation-refresh-adapters";

const guestClient = {
  auth: {
    getUser: async () => ({ data: { user: null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
    onAuthStateChange(listener: (event: string, session: null) => void) {
      let active = true;
      queueMicrotask(() => { if (active) listener("INITIAL_SESSION", null); });
      return { data: { subscription: { unsubscribe() { active = false; } } } };
    },
  },
};

export function createClient() {
  return new URLSearchParams(window.location.search).get("fixture_auth") === "guest" ? guestClient : createMemberClient();
}

// Preserve accessible names on the links rendered by the real Home component.
export default function LovePassPlacementAdapter({ href, children, className, onClick, src, alt, "aria-label": label }:
  ComponentProps<typeof Adapter> & { "aria-label"?: string }) {
  if (href) return <a href={href} className={className} onClick={onClick} aria-label={label}>{children}</a>;
  return <Adapter className={className} onClick={onClick} src={src} alt={alt}>{children}</Adapter>;
}
