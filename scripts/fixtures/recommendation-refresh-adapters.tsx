/* eslint-disable @next/next/no-img-element -- Test-only adapters. */
import type { ReactNode } from "react";
const user = { id: "fixture-member", user_metadata: { nickname: "검증회원" } };
const router = { push: () => {}, replace: () => {} };
const params = new URLSearchParams(window.location.search);
export const useRouter = () => router;
export const useSearchParams = () => params;
export const usePathname = () => window.location.pathname;
const client = { auth: {
  getUser: async () => ({ data: { user } }),
  getSession: async () => ({ data: { session: { user } } }),
  onAuthStateChange(listener: (event: string, session: { user: typeof user }) => void) {
    let active = true;
    queueMicrotask(() => { if (active) listener("INITIAL_SESSION", { user }); });
    return { data: { subscription: { unsubscribe() { active = false; } } } };
  },
} };
export const createClient = () => client;
export default function Adapter({ children, href, src, alt, className, onClick }: {
  children?: ReactNode; href?: string; src?: string; alt?: string; className?: string; onClick?: () => void;
}) {
  if (src) return <img src={src} alt={alt || ""} className={className} onClick={onClick} />;
  if (href) return <a href={href} className={className} onClick={onClick}>{children}</a>;
  return <>{children}</>;
}
