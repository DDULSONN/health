/* eslint-disable @next/next/no-img-element -- Test-only adapters. */
import type { ReactNode } from "react";
const user = { id: "fixture-member", user_metadata: { nickname: "검증회원" } };
const currentUser = () => ({ ...user, id: sessionStorage.getItem("gymtools-fixture-viewer") ?? user.id });
const router = { push: () => {}, replace: () => {} };
const params = new URLSearchParams(window.location.search);
export const useRouter = () => router;
export const useSearchParams = () => params;
export const usePathname = () => window.location.pathname;
const client = { auth: {
  getUser: async () => ({ data: { user: currentUser() } }),
  getSession: async () => ({ data: { session: { user: currentUser() } } }),
  onAuthStateChange(listener: (event: string, session: { user: typeof user }) => void) {
    let active = true;
    const onSwitch = () => { if (active) listener("SIGNED_IN", { user: currentUser() }); };
    window.addEventListener("gymtools-fixture-viewer-changed", onSwitch);
    queueMicrotask(() => { if (active) listener("INITIAL_SESSION", { user: currentUser() }); });
    return { data: { subscription: { unsubscribe() { active = false; window.removeEventListener("gymtools-fixture-viewer-changed", onSwitch); } } } };
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
