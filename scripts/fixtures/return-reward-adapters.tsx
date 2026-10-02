import React, { useEffect, useState } from "react";
let userId: string | null = "return-member";
type Callback = (event: string, session: { user: { id: string } } | null) => void;
const callbacks = new Set<Callback>();
const pathCallbacks = new Set<(path: string) => void>();
export function fixtureAuth(id: string | null) {
  userId = id;
  callbacks.forEach(callback => callback(id ? "SIGNED_IN" : "SIGNED_OUT", id ? { user: { id } } : null));
}
export function fixturePath(path: string) {
  window.history.pushState(null, "", path);
  pathCallbacks.forEach(callback => callback(path));
}
export function createClient() {
  return { auth: { onAuthStateChange(callback: Callback) {
    callbacks.add(callback);
    queueMicrotask(() => callbacks.has(callback) && callback("INITIAL_SESSION", userId ? { user: { id: userId } } : null));
    return { data: { subscription: { unsubscribe() { callbacks.delete(callback); } } } };
  } } };
}
export function usePathname() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => { pathCallbacks.add(setPath); return () => { pathCallbacks.delete(setPath); }; }, []);
  return path;
}
export default function Link(props: React.AnchorHTMLAttributes<HTMLAnchorElement>) { return <a {...props} />; }
