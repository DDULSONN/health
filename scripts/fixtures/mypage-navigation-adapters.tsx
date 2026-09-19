/* eslint-disable @next/next/no-img-element -- Local-only UI fixture. */
import type { ReactNode } from "react";

const router = {
  replace: (href: string) => { window.location.href = href; },
  push: (href: string) => { window.location.href = href; },
};
export const useRouter = () => router;
const client = { auth: {
  onAuthStateChange(listener: (event: string, session: { user: { id: string } }) => void) {
    let active = true;
    queueMicrotask(() => { if (active) listener("INITIAL_SESSION", { user: { id: "fixture-member" } }); });
    return { data: { subscription: { unsubscribe() { active = false; } } } };
  },
} };
export const createClient = () => client;
export default function Adapter({ children, href, src, alt, className, onClick }: {
  children?: ReactNode; href?: string; src?: string; alt?: string; className?: string;
  onClick?: () => void;
}) {
  if (src) return <img src={src} alt={alt || ""} className={className} onClick={onClick} />;
  if (href) return <a href={href} className={className} onClick={onClick}>{children}</a>;
  return <>{children}</>;
}
