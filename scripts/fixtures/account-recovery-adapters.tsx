import { type ReactNode } from "react";
type Fixture = { calls: { action: string; input?: unknown }[]; signedIn: boolean; readFails: boolean; emailLinkConsumed: boolean; redirect?: string };
const win = () => window as unknown as { recoveryFixture: Fixture };
const scenario = new URLSearchParams(window.location.search).get("scenario") || "guest";
win().recoveryFixture = { calls: [], signedIn: /session|update/.test(scenario), readFails: scenario === "read-error", emailLinkConsumed: false };
const record = (action: string, input?: unknown) => win().recoveryFixture.calls.push({ action, input });
const member = { id: "fixture-member", email: "fixture@example.invalid", email_confirmed_at: "2026-01-01", user_metadata: {} };
const session = () => win().recoveryFixture.signedIn ? { user: member } : null;
const client = { auth: {
  getSession: async () => {
    if (win().recoveryFixture.readFails) throw Error("Fixture offline");
    if (scenario === "code-auto-session" && new URL(location.href).searchParams.has("code")) {
      const url = new URL(location.href); url.searchParams.delete("code"); history.replaceState({}, "", url);
      win().recoveryFixture.emailLinkConsumed = true;
    }
    if (scenario === "implicit-auto-session" && location.hash.includes("access_token")) {
      const url = new URL(location.href); url.hash = ""; history.replaceState({}, "", url);
      win().recoveryFixture.emailLinkConsumed = true;
    }
    return { data: { session: session() }, error: null };
  },
  getUser: async () => ({ data: { user: session()?.user || null }, error: null }),
  signOut: async (input: unknown) => { record("signOut", input); win().recoveryFixture.signedIn = false; return { error: null }; },
  signInWithPassword: async (input: unknown) => { record("password", input); win().recoveryFixture.signedIn = true; return { error: null }; },
  signInWithOtp: async (input: unknown) => { record("otp", input); return { error: null }; },
  signInWithOAuth: async (input: unknown) => { record("oauth", input); return { error: new Error("Fixture: no external sign-in") }; },
  resend: async (input: unknown) => { record("resend", input); return { error: null }; },
  resetPasswordForEmail: async (...input: unknown[]) => { record("reset", input); return { error: null }; },
  updateUser: async (input: unknown) => { record("update", input); return { error: null }; },
  exchangeCodeForSession: async () => { record("exchangeCode"); return { error: Object.assign(new Error("Token has expired"), { code: "otp_expired" }) }; },
  verifyOtp: async () => {
    record("verifyOtp");
    if (scenario.includes("token-success") && !win().recoveryFixture.emailLinkConsumed) {
      win().recoveryFixture.signedIn = true; win().recoveryFixture.emailLinkConsumed = true;
      return { error: null };
    }
    return { error: Object.assign(new Error("Token has expired"), { code: "otp_expired" }) };
  },
  setSession: async () => { record("setSession"); return { error: Object.assign(new Error("Token has expired"), { code: "otp_expired" }) }; },
  onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
} };
export const createClient = () => client;
const router = { replace: (url: string) => { win().recoveryFixture.redirect = url; } };
export const useRouter = () => router;
const params = new URLSearchParams(window.location.search);
export const useSearchParams = () => params;
export default function Link({ children, href, ...props }: { children?: ReactNode; href: string; className?: string }) {
  return <a href={href} {...props}>{children}</a>;
}
