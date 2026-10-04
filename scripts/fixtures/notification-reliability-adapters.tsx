import type { MouseEvent, ReactNode } from "react";
const navigate = (url: string) => { window.history.pushState(null, "", url); window.dispatchEvent(new PopStateEvent("popstate")); };
const router = { push: navigate, replace: navigate, refresh() {} };
export const useRouter = () => router;
const client = {
  auth: {
    getUser: async () => ({ data: { user: { id: "fixture-member", email: "fixture@example.invalid" } } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signOut: async () => {},
  },
  from: () => ({ select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: { nickname: "검증 회원" } }) }),
};
export const createClient = () => client;
export default function Link({ href, children, className, onClick, ...rest }: {
  href: string; children: ReactNode; className?: string; onClick?: () => void; "aria-label"?: string;
}) {
  return <a {...rest} href={href} className={className} onClick={(event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault(); onClick?.(); navigate(href);
  }}>{children}</a>;
}
