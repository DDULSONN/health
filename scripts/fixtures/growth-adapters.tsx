import { lazy, Suspense, type ComponentType } from "react";
export { default } from "./profile-ux-adapters";
export const usePathname = () => location.pathname;
export const useRouter = () => ({ replace() {} });
const listeners = new Set<(event: string, session: unknown) => void>();
type FixtureUser = { id: string; created_at?: string; email_confirmed_at?: string | null };
const win = () => window as unknown as { fixtureUser?: FixtureUser | null; fixtureSignIn?: (user: unknown) => void; fixtureAuthUnavailable?: boolean };
const client = { auth: {
  onAuthStateChange(fn: (event: string, session: unknown) => void) {
    listeners.add(fn);
    queueMicrotask(() => { if (listeners.has(fn)) fn("INITIAL_SESSION", win().fixtureUser ? { user: win().fixtureUser } : null); });
    win().fixtureSignIn = user => { win().fixtureUser = user as FixtureUser | null; for (const f of listeners) f(user ? "SIGNED_IN" : "SIGNED_OUT", user ? { user } : null); };
    return { data: { subscription: { unsubscribe: () => listeners.delete(fn) } } };
  },
  async signUp() { return { data: { user: { id: "new-email", created_at: new Date().toISOString(), email_confirmed_at: null, identities: [{}] }, session: null }, error: null }; },
  async signInWithOAuth() { return { error: null }; },
} };
export const createClient = () => {
  if (win().fixtureAuthUnavailable) throw new Error("optional auth client unavailable");
  return client;
};
export function dynamic(loader: () => Promise<{ default: ComponentType<Record<string, unknown>> }>) {
  const Component = lazy(loader);
  return function Deferred(props: Record<string, unknown>) { return <Suspense fallback={null}><Component {...props} /></Suspense>; };
}
