/* eslint-disable @next/next/no-img-element -- Test-only replacement for Next Image. */
import { type ReactNode } from "react";
const listeners = new Set<(event: string, session: unknown) => void>();
const fixtureWindow = () => window as unknown as {
  fixtureUser?: string; fixtureRedirect?: string;
  fixtureSignOut?: () => void;
  fixtureRefresh?: () => void;
};
const router = { replace: (url: string) => { fixtureWindow().fixtureRedirect = url; } };
export const useRouter = () => router;
const params = new URLSearchParams(window.location.search);
export const useSearchParams = () => params;
const client = { auth: {
  getUser: async () => ({ data: { user: { id: fixtureWindow().fixtureUser || "fixture-member", user_metadata: { nickname: "테스트" } } } }),
  onAuthStateChange: (listener: (event: string, session: unknown) => void) => {
    listeners.add(listener);
    queueMicrotask(() => { if (listeners.has(listener)) listener("INITIAL_SESSION", { user: { id: fixtureWindow().fixtureUser || "fixture-member" } }); });
    fixtureWindow().fixtureSignOut = () => { for (const fn of listeners) fn("SIGNED_OUT", null); };
    fixtureWindow().fixtureRefresh = () => {
      for (const event of ["SIGNED_IN", "TOKEN_REFRESHED"]) {
        for (const fn of listeners) fn(event, { user: { id: fixtureWindow().fixtureUser || "fixture-member" } });
      }
    };
    return { data: { subscription: { unsubscribe: () => listeners.delete(listener) } } };
  },
} };
export const createClient = () => client;
export default function Adapter(props: { children?: ReactNode; href?: string; src?: string; alt?: string; className?: string; onClick?: () => void }) {
  if (props.src) return <img src={props.src} alt={props.alt || ""} style={{ width: "100%", height: "100%", objectFit: "contain" }} />;
  if (props.href) return <a href={props.href} className={props.className} onClick={props.onClick}>{props.children}</a>;
  return <>{props.children}</>;
}
