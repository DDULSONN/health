// Offline browser fixture only; production uses Next's current pathname.
export function usePathname() { return window.location.pathname; }
