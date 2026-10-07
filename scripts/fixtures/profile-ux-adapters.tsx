/* eslint-disable @next/next/no-img-element -- Test-only replacement for Next Image. */
import { type ReactNode } from "react";
const listeners = new Set<(event: string, session: unknown) => void>();
const fixtureWindow = () => window as unknown as {
  fixtureUser?: string; fixtureRedirect?: string;
  fixtureAuthMode?: "guest" | "offline" | "server-error";
  fixtureSignOut?: () => void;
  fixtureRefresh?: () => void;
};
const router = { replace: (url: string) => { fixtureWindow().fixtureRedirect = url; } };
export const useRouter = () => router;
const params = new URLSearchParams(window.location.search);
export const useSearchParams = () => params;
const client = { auth: {
  getUser: async () => {
    const mode = fixtureWindow().fixtureAuthMode;
    if (mode === "offline") throw new Error("Fixture offline");
    if (mode === "server-error") return { data: { user: null }, error: { name: "AuthApiError", status: 503 } };
    return { data: { user: mode === "guest" ? null : { id: fixtureWindow().fixtureUser || "fixture-member", user_metadata: { nickname: "테스트" } } } };
  },
  signUp: async () => ({ data: {}, error: new Error("로컬 미리보기에서는 실제 가입을 하지 않아요.") }),
  signInWithOAuth: async () => ({ error: new Error("로컬 미리보기에서는 실제 가입을 하지 않아요.") }),
  resend: async () => ({ error: new Error("로컬 미리보기에서는 실제 메일을 보내지 않아요.") }),
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
