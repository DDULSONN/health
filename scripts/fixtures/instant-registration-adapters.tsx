import { useSyncExternalStore, useMemo, type ReactNode, type MouseEvent } from "react";
export { createClient } from "./profile-ux-adapters";
const subscribe = (fn: () => void) => { window.addEventListener("popstate", fn); return () => window.removeEventListener("popstate", fn); };
const snapshot = () => window.location.search;
export const useSearchParams = () => {
  const search = useSyncExternalStore(subscribe, snapshot, () => "");
  return useMemo(() => new URLSearchParams(search), [search]);
};
const navigate = (url: string) => { window.history.pushState(null, "", url); window.dispatchEvent(new PopStateEvent("popstate")); };
export const useRouter = () => ({ push: navigate, replace: navigate, prefetch: () => {} });
export default function Adapter(props: { children?: ReactNode; href?: string; className?: string; onClick?: () => void }) {
  if (!props.href) return <>{props.children}</>;
  const click = (event: MouseEvent<HTMLAnchorElement>) => {
    props.onClick?.();
    const target = new URL(props.href!, location.href);
    if (target.origin === location.origin && target.pathname === location.pathname) { event.preventDefault(); navigate(props.href!); }
  };
  return <a href={props.href} className={props.className} onClick={click}>{props.children}</a>;
}
