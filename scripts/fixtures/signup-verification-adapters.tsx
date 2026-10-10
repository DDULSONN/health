/* eslint-disable @next/next/no-img-element -- Isolated test replacement. */
import type { ReactNode } from "react";
const state = window as unknown as { fixtureRedirect?: string; fixtureAuthEvent?: (event: string, session?: unknown) => void };
const listeners = new Set<(event: string, session: unknown) => void>();
let inCallback = false;
state.fixtureAuthEvent = (event, session = null) => {
  inCallback = true;
  try { listeners.forEach(listener => listener(event, session)); } finally { inCallback = false; }
};
const call = async (action: string, options?: unknown) => {
  if (inCallback) throw Error("Auth calls inside the SDK callback can deadlock");
  return (await fetch(`/__fixture/auth/${action}`, {
    method: action === "user" ? "GET" : "POST",
    ...(options ? { body: JSON.stringify(options), headers: { "Content-Type": "application/json" } } : {}),
  })).json();
};
const client = { auth: {
  getUser: () => call("user"), signUp: (options: unknown) => call("signup", options),
  resend: (options: unknown) => call("resend", options), signInWithOAuth: (options: unknown) => call("oauth", options),
  onAuthStateChange: (listener: (event: string, session: unknown) => void) => {
    listeners.add(listener);
    return { data: { subscription: { unsubscribe: () => listeners.delete(listener) } } };
  },
} };
export const createClient = () => client;
const router = { replace: (href: string) => { state.fixtureRedirect = href; } };
export const useRouter = () => router;
export default function Adapter({ children, href, src, alt, ...props }: {
  children?: ReactNode; href?: string; src?: string; alt?: string; className?: string;
}) {
  if (src) return <img src={src} alt={alt ?? ""} {...props} />;
  return href ? <a href={href} {...props}>{children}</a> : <>{children}</>;
}
