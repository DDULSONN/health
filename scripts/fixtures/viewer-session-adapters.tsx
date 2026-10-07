/* eslint-disable @next/next/no-img-element -- Local browser test fixture. */
import type { ReactNode } from "react";
type FixtureSession = { user: { id: string } } | null;
declare global {
  interface Window {
    authProbe: { reads: number; recovered: boolean; emit: (event: string, id: string | null) => void };
  }
}
const params = new URLSearchParams(window.location.search);
const scenario = params.get("scenario");
const savedIdentity = sessionStorage.getItem("fixture-identity");
let identity = savedIdentity ?? (scenario === "guest" ? "guest" : "a");
const listeners = new Set<(event: string, session: FixtureSession) => void>();
const session = () => identity === "guest" ? null : { user: { id: identity } };
window.authProbe = { reads: 0, recovered: false, emit(event, id) {
  identity = id ?? "guest";
  sessionStorage.setItem("fixture-identity", identity);
  for (const listener of listeners) listener(event, session());
} };
const client = { auth: {
  getUser: async () => {
    window.authProbe.reads++;
    if (!window.authProbe.recovered && (scenario === "persistent" || (scenario === "automatic" && window.authProbe.reads === 1))) {
      return { data: { user: null }, error: { status: 503, name: "AuthRetryableFetchError" } };
    }
    return { data: { user: session()?.user ?? null }, error: null };
  },
  getSession: async () => ({ data: { session: session() }, error: null }),
  onAuthStateChange(listener: (event: string, session: FixtureSession) => void) {
    listeners.add(listener);
    queueMicrotask(() => { if (listeners.has(listener)) listener("INITIAL_SESSION", session()); });
    return { data: { subscription: { unsubscribe() { listeners.delete(listener); } } } };
  },
} };
const router = { push() {}, replace() {} };
export const createClient = () => client;
export const useRouter = () => router;
export const useSearchParams = () => params;
export const usePathname = () => location.pathname;
export default function Adapter({ children, href, src, alt, className, onClick }: {
  children?: ReactNode; href?: string; src?: string; alt?: string; className?: string; onClick?: () => void;
}) {
  if (src) return <img src={src} alt={alt || ""} className={className} />;
  if (href) return <a href={href} className={className} onClick={onClick}>{children}</a>;
  return <>{children}</>;
}
